/**
 * Bulk ledger engine for demo / staging data (spec 62–65, 127).
 *
 * Posting a million movements one by one through `postMovement` would take hours, so this engine
 * reproduces EXACTLY what `postMovement` / `transferStock` write - same WAC arithmetic (domain/costing),
 * same storage rounding, same balance-after fields, same cost-ledger mirror rows - in memory, and writes
 * them with bulk inserts. `tests/integration/demo-engine.test.ts` posts one scenario through the real
 * services and through this engine and requires identical rows.
 *
 * Only weighted-average products are supported (the generator creates WAC products; FIFO stays covered
 * by the service tests). Never imported by request handlers.
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, StockTxType } from "@prisma/client";
import { D, Decimal, ZERO, toStorage } from "@/domain/money";
import { wacIssue, wacReceive, type Position } from "@/domain/costing";

const COST_KIND: Partial<Record<StockTxType, string>> = {
  CONSUMPTION: "CONSUMPTION",
  WASTE: "WASTE",
  STAFF_MEAL: "STAFF_MEAL",
  COMPLIMENTARY: "COMPLIMENTARY",
  COUNT_ADJUSTMENT: "COUNT_VARIANCE",
  ADJUSTMENT: "ADJUSTMENT",
};
const INBOUND_REQUIRES_COST: StockTxType[] = ["PURCHASE", "OPENING", "PRODUCTION_IN"];

export interface EngineProduct {
  id: string;
  categoryId: string;
  group: string;
  standardCost?: Decimal | null;
}

export interface EngineMovement {
  warehouseId: string;
  productId: string;
  type: StockTxType;
  /** signed, stock unit */
  quantity: Decimal | number | string;
  unitCost?: Decimal | number | string | null;
  exactTotal?: Decimal | number | string;
  txDate: Date;
  /** undefined → the warehouse's department (as postMovement) */
  departmentId?: string | null;
  sourceType: string;
  sourceId?: string | null;
  reason?: string | null;
  transferGroup?: string | null;
  allowNegative?: boolean;
  idempotencyKey?: string | null;
  id?: string;
}

export class EngineError extends Error {}

export class BulkLedger {
  readonly stock: Prisma.StockTransactionCreateManyInput[] = [];
  readonly cost: Prisma.CostTransactionCreateManyInput[] = [];
  private readonly pos = new Map<string, Position & { lastTxAt: Date | null }>();
  /** hotel-wide Σqty / Σvalue per product: what `costTableAsOf` reads */
  private readonly hotelQty = new Map<string, Decimal>();
  private readonly hotelVal = new Map<string, Decimal>();
  private readonly lastAvg = new Map<string, Decimal>();
  private readonly lastPrice = new Map<string, Decimal>();
  private seq = 0;
  private readonly base = Date.now();

  constructor(
    readonly hotelId: string,
    readonly userId: string,
    private readonly products: Map<string, EngineProduct>,
    private readonly warehouseDept: Map<string, string | null>,
    private readonly periodOf: (d: Date) => string,
  ) {}

  position(warehouseId: string, productId: string): Position {
    return this.pos.get(`${warehouseId}|${productId}`) ?? { quantity: ZERO, value: ZERO, avgCost: ZERO };
  }

  /** Records a supplier purchase price (fallback cost source, as SupplierPrice is for the services). */
  notePrice(productId: string, unitPrice: Decimal) {
    this.lastPrice.set(productId, unitPrice);
  }

  /** Cost per stock unit the way `costTableAsOf` resolves it at this point in the simulation. */
  costNow(productId: string): Decimal | null {
    const q = this.hotelQty.get(productId) ?? ZERO;
    if (q.gt(0)) return (this.hotelVal.get(productId) ?? ZERO).div(q);
    const a = this.lastAvg.get(productId);
    if (a && a.gt(0)) return a;
    return this.lastPrice.get(productId) ?? this.products.get(productId)?.standardCost ?? null;
  }

  post(m: EngineMovement): { id: string; totalCost: Decimal; unitCost: Decimal; quantity: Decimal } {
    const product = this.products.get(m.productId);
    if (!product) throw new EngineError(`unknown product ${m.productId}`);
    if (!this.warehouseDept.has(m.warehouseId)) throw new EngineError(`unknown warehouse ${m.warehouseId}`);
    const qty = D(m.quantity);
    if (qty.isZero()) throw new EngineError("Quantity cannot be zero");
    const key = `${m.warehouseId}|${m.productId}`;
    const pos = this.pos.get(key) ?? { quantity: ZERO, value: ZERO, avgCost: ZERO, lastTxAt: null };

    let total: Decimal;
    let unitCost: Decimal;
    if (qty.gt(0)) {
      if (m.exactTotal !== undefined) {
        total = toStorage(D(m.exactTotal));
        unitCost = total.div(qty);
      } else {
        let c: Decimal | null = m.unitCost === null || m.unitCost === undefined ? null : D(m.unitCost);
        if (c === null) {
          if (INBOUND_REQUIRES_COST.includes(m.type)) throw new EngineError(`Unit cost is required for ${m.type}`);
          c = pos.quantity.gt(0) ? pos.value.div(pos.quantity) : pos.avgCost.gt(0) ? pos.avgCost : (this.lastPrice.get(m.productId) ?? product.standardCost ?? null);
          if (c === null) throw new EngineError(`No cost available for ${m.productId}`);
        }
        unitCost = c;
        total = toStorage(qty.times(c));
      }
    } else {
      const outQty = qty.neg();
      if (!m.allowNegative && outQty.gt(pos.quantity)) throw new EngineError(`Insufficient stock: available ${pos.quantity.toString()}, requested ${outQty.toString()} (${m.productId} @ ${m.warehouseId})`);
      if (m.exactTotal !== undefined) {
        total = toStorage(D(m.exactTotal));
        if (pos.quantity.minus(outQty).isZero()) total = pos.value.neg();
        unitCost = total.neg().div(outQty);
      } else {
        const r = wacIssue(pos, outQty, { allowNegative: m.allowNegative });
        total = pos.quantity.minus(outQty).isZero() ? pos.value.neg() : toStorage(r.totalCost).neg();
        unitCost = total.neg().div(outQty);
      }
    }

    const newQty = pos.quantity.plus(qty);
    let newValue = pos.value.plus(total);
    let newAvg: Decimal;
    if (qty.gt(0) && m.exactTotal === undefined) {
      const next = wacReceive(pos, qty, unitCost);
      newAvg = next.avgCost;
      if (pos.quantity.lt(0)) {
        newValue = toStorage(next.value);
        total = newValue.minus(pos.value);
      }
    } else {
      newAvg = newQty.gt(0) ? newValue.div(newQty) : qty.gt(0) ? unitCost : pos.avgCost;
    }

    const departmentId = m.departmentId === undefined ? (this.warehouseDept.get(m.warehouseId) ?? null) : m.departmentId;
    const id = m.id ?? randomUUID();
    const periodId = this.periodOf(m.txDate);
    const createdAt = new Date(this.base + this.seq++);
    const stored = { quantity: toStorage(newQty), value: toStorage(newValue), avgCost: toStorage(newAvg) };
    this.stock.push({
      id,
      hotelId: this.hotelId,
      periodId,
      warehouseId: m.warehouseId,
      departmentId,
      productId: m.productId,
      type: m.type,
      txDate: m.txDate,
      quantity: toStorage(qty).toString(),
      unitCost: toStorage(unitCost).toString(),
      totalCost: toStorage(total).toString(),
      balanceQtyAfter: stored.quantity.toString(),
      balanceValueAfter: stored.value.toString(),
      avgCostAfter: stored.avgCost.toString(),
      sourceType: m.sourceType,
      sourceId: m.sourceId ?? null,
      transferGroup: m.transferGroup ?? null,
      userId: this.userId,
      reason: m.reason ?? null,
      origin: "ACTUAL",
      idempotencyKey: m.idempotencyKey ?? null,
      createdAt,
    });
    this.pos.set(key, { ...stored, lastTxAt: m.txDate });
    this.hotelQty.set(m.productId, (this.hotelQty.get(m.productId) ?? ZERO).plus(toStorage(qty)));
    this.hotelVal.set(m.productId, (this.hotelVal.get(m.productId) ?? ZERO).plus(toStorage(total)));
    if (stored.avgCost.gt(0)) this.lastAvg.set(m.productId, stored.avgCost);

    const kind = COST_KIND[m.type];
    if (kind) {
      this.cost.push({
        hotelId: this.hotelId,
        periodId,
        txDate: m.txDate,
        departmentId,
        categoryGroup: product.group,
        categoryId: product.categoryId,
        costType: "VARIABLE",
        nature: "DIRECT",
        kind,
        amount: toStorage(total.neg()).toString(),
        quantity: toStorage(qty.neg()).toString(),
        productId: m.productId,
        stockTxId: id,
        sourceType: m.sourceType,
        sourceId: m.sourceId ?? null,
        userId: this.userId,
        origin: "ACTUAL",
        createdAt,
      });
    }
    return { id, totalCost: toStorage(total), unitCost: toStorage(unitCost), quantity: toStorage(qty) };
  }

  /** Same legs as `transferStock`: TRANSFER_OUT at average, TRANSFER_IN at exactly that value. */
  transfer(fromWarehouseId: string, toWarehouseId: string, productId: string, quantity: Decimal | number | string, txDate: Date, reason?: string) {
    const q = D(quantity);
    if (q.lte(0)) throw new EngineError("Transfer quantity must be positive");
    const group = randomUUID();
    const out = this.post({ warehouseId: fromWarehouseId, productId, type: "TRANSFER_OUT", quantity: q.neg(), txDate, sourceType: "TRANSFER", sourceId: group, transferGroup: group, reason });
    const inn = this.post({ warehouseId: toWarehouseId, productId, type: "TRANSFER_IN", quantity: q, exactTotal: out.totalCost.neg(), txDate, sourceType: "TRANSFER", sourceId: group, transferGroup: group, reason });
    return { out, in: inn };
  }

  balances(): Prisma.StockBalanceCreateManyInput[] {
    return [...this.pos].map(([k, p]) => {
      const [warehouseId, productId] = k.split("|") as [string, string];
      return { hotelId: this.hotelId, warehouseId, productId, quantity: p.quantity.toString(), value: p.value.toString(), avgCost: p.avgCost.toString(), lastTxAt: p.lastTxAt, version: 1 };
    });
  }

  /** Writes the ledger (stock rows first: the cost ledger references them) and the balances. */
  async flush(db: PrismaClient, chunk = 5000) {
    for (let i = 0; i < this.stock.length; i += chunk) await db.stockTransaction.createMany({ data: this.stock.slice(i, i + chunk) });
    for (let i = 0; i < this.cost.length; i += chunk) await db.costTransaction.createMany({ data: this.cost.slice(i, i + chunk) });
    const bal = this.balances();
    for (let i = 0; i < bal.length; i += chunk) await db.stockBalance.createMany({ data: bal.slice(i, i + chunk) });
    const n = { stock: this.stock.length, cost: this.cost.length, balances: bal.length };
    this.stock.length = 0;
    this.cost.length = 0;
    return n;
  }
}
