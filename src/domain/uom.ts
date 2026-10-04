/**
 * Unit-of-measure engine (spec §9–§10).
 *
 * Standard units carry a factor to their dimension base (g, ml, piece, m, h).
 * Packaging units (case, box, pack, bottle …) have no universal size and must be
 * defined per product through explicit conversions (e.g. 1 case = 10 kg chicken).
 * Every conversion returns the path it used so the result is auditable.
 */
import { D, Decimal, type Numeric } from "./money";
import { DomainError } from "./errors";

export type Dimension = "MASS" | "VOLUME" | "COUNT" | "LENGTH" | "TIME";

export interface UnitDef {
  code: string;
  dimension: Dimension;
  /** factor to base unit of the dimension; null for product-dependent packaging units */
  toBase: Numeric | null;
}

export interface ProductConversion {
  fromUnit: string;
  toUnit: string;
  /** 1 fromUnit = factor toUnit */
  factor: Numeric;
}

export interface ConversionStep {
  from: string;
  to: string;
  factor: string;
  source: "standard" | "product";
}

export interface ConversionResult {
  quantity: Decimal;
  factor: Decimal;
  path: ConversionStep[];
}

export const STANDARD_UNITS: UnitDef[] = [
  { code: "mg", dimension: "MASS", toBase: "0.001" },
  { code: "g", dimension: "MASS", toBase: "1" },
  { code: "kg", dimension: "MASS", toBase: "1000" },
  { code: "ton", dimension: "MASS", toBase: "1000000" },
  { code: "ml", dimension: "VOLUME", toBase: "1" },
  { code: "cl", dimension: "VOLUME", toBase: "10" },
  { code: "l", dimension: "VOLUME", toBase: "1000" },
  { code: "shot", dimension: "VOLUME", toBase: "40" },
  { code: "pc", dimension: "COUNT", toBase: "1" },
  { code: "dozen", dimension: "COUNT", toBase: "12" },
  { code: "portion", dimension: "COUNT", toBase: null },
  { code: "serving", dimension: "COUNT", toBase: null },
  { code: "pack", dimension: "COUNT", toBase: null },
  { code: "box", dimension: "COUNT", toBase: null },
  { code: "case", dimension: "COUNT", toBase: null },
  { code: "bottle", dimension: "COUNT", toBase: null },
  { code: "can", dimension: "COUNT", toBase: null },
  { code: "tray", dimension: "COUNT", toBase: null },
  { code: "bag", dimension: "COUNT", toBase: null },
  { code: "m", dimension: "LENGTH", toBase: "1" },
  { code: "cm", dimension: "LENGTH", toBase: "0.01" },
  { code: "h", dimension: "TIME", toBase: "1" },
  { code: "min", dimension: "TIME", toBase: "0.0166666666666666666667" },
];

export class UnitConverter {
  private readonly units: Map<string, UnitDef>;

  constructor(units: UnitDef[] = STANDARD_UNITS) {
    this.units = new Map(units.map((u) => [u.code, u]));
  }

  has(code: string): boolean {
    return this.units.has(code);
  }

  get(code: string): UnitDef | undefined {
    return this.units.get(code);
  }

  private edges(unit: string, conversions: ProductConversion[]): Array<{ to: string; factor: Decimal; source: ConversionStep["source"] }> {
    const out: Array<{ to: string; factor: Decimal; source: ConversionStep["source"] }> = [];
    const def = this.units.get(unit);
    if (def && def.toBase !== null) {
      for (const other of this.units.values()) {
        if (other.code !== unit && other.dimension === def.dimension && other.toBase !== null) {
          out.push({ to: other.code, factor: D(def.toBase).div(D(other.toBase)), source: "standard" });
        }
      }
    }
    for (const c of conversions) {
      const f = D(c.factor);
      if (f.lte(0)) continue;
      if (c.fromUnit === unit) out.push({ to: c.toUnit, factor: f, source: "product" });
      if (c.toUnit === unit) out.push({ to: c.fromUnit, factor: new Decimal(1).div(f), source: "product" });
    }
    return out;
  }

  /** Conversion factor such that qty[from] × factor = qty[to]. */
  factor(from: string, to: string, conversions: ProductConversion[] = []): { factor: Decimal; path: ConversionStep[] } {
    if (!this.units.has(from)) throw new DomainError("UOM_CONVERSION", `Unknown unit '${from}'`);
    if (!this.units.has(to)) throw new DomainError("UOM_CONVERSION", `Unknown unit '${to}'`);
    if (from === to) return { factor: new Decimal(1), path: [] };

    // BFS: shortest explicit path (fewest hops) for auditability.
    const prev = new Map<string, { node: string; factor: Decimal; source: ConversionStep["source"] }>();
    const queue: string[] = [from];
    const seen = new Set([from]);
    while (queue.length) {
      const node = queue.shift()!;
      if (node === to) break;
      for (const e of this.edges(node, conversions)) {
        if (seen.has(e.to)) continue;
        seen.add(e.to);
        prev.set(e.to, { node, factor: e.factor, source: e.source });
        queue.push(e.to);
      }
    }
    if (!prev.has(to)) {
      throw new DomainError("UOM_CONVERSION", `No conversion defined from '${from}' to '${to}'`, { from, to });
    }
    const path: ConversionStep[] = [];
    let factor = new Decimal(1);
    let cur = to;
    while (cur !== from) {
      const p = prev.get(cur)!;
      path.unshift({ from: p.node, to: cur, factor: p.factor.toString(), source: p.source });
      factor = factor.times(p.factor);
      cur = p.node;
    }
    return { factor, path };
  }

  convert(qty: Numeric, from: string, to: string, conversions: ProductConversion[] = []): ConversionResult {
    const { factor, path } = this.factor(from, to, conversions);
    return { quantity: D(qty).times(factor), factor, path };
  }

  canConvert(from: string, to: string, conversions: ProductConversion[] = []): boolean {
    try {
      this.factor(from, to, conversions);
      return true;
    } catch {
      return false;
    }
  }
}

export const defaultConverter = new UnitConverter();
