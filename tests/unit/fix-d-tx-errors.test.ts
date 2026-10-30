import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { inTx, isNumberCollision, isTransientTxError, TX_ATTEMPTS, type Db } from "@/server/db";
import { errorResponse } from "@/server/http/handler";

const known = (code: string, meta?: Record<string, unknown>) => new Prisma.PrismaClientKnownRequestError(`failed ${code}`, { code, clientVersion: "test", meta });
const deadlock = () => known("P2010", { code: "40P01", message: "ERROR: deadlock detected" });
// what an ORM query reports for a deadlock (Prisma 6): an unknown request error carrying the SQLSTATE in its message
const ormDeadlock = () => new Prisma.PrismaClientUnknownRequestError('Error occurred during query execution: ConnectorError(PostgresError { code: "40P01", message: "deadlock detected" })', { clientVersion: "test" });
const serialization = () => known("P2034");

/** A stand-in client: $transaction runs fn, which fails as scripted on each attempt. */
function fakeDb(failures: Array<() => unknown>) {
  let calls = 0;
  const db = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const f = failures[calls++];
      if (f) throw f();
      return fn({});
    },
  };
  return { db: db as unknown as Db, calls: () => calls };
}

describe("transient transaction errors", () => {
  it("recognises deadlocks and serialization failures however Prisma reports them", () => {
    expect(isTransientTxError(deadlock())).toBe(true);
    expect(isTransientTxError(ormDeadlock())).toBe(true);
    expect(isTransientTxError(serialization())).toBe(true);
    expect(isTransientTxError(known("P2010", { code: "40001" }))).toBe(true);
    expect(isTransientTxError(known("P2002", { target: ["hotelId", "number"] }))).toBe(false);
    expect(isTransientTxError(new Error("deadlock detected"))).toBe(false); // only database errors
  });

  it("a document-number collision is recognised, other unique violations are not", () => {
    expect(isNumberCollision(known("P2002", { modelName: "PurchaseOrder", target: ["hotelId", "number"] }))).toBe(true);
    expect(isNumberCollision(known("P2002", { modelName: "CostPeriod", target: ["hotelId", "code"] }))).toBe(true);
    expect(isNumberCollision(known("P2002", { modelName: "Room", target: ["hotelId", "number"] }))).toBe(false);
    expect(isNumberCollision(known("P2002", { modelName: "Supplier", target: ["hotelId", "code"] }))).toBe(false);
  });
});

describe("inTx retries", () => {
  it("runs a deadlocked transaction again and returns its result", async () => {
    const f = fakeDb([deadlock, ormDeadlock]);
    await expect(inTx(f.db, async () => "done")).resolves.toBe("done");
    expect(f.calls()).toBe(3);
  });

  it("gives up after TX_ATTEMPTS and rethrows the deadlock", async () => {
    const f = fakeDb(Array.from({ length: TX_ATTEMPTS + 2 }, () => deadlock));
    await expect(inTx(f.db, async () => "never")).rejects.toMatchObject({ code: "P2010" });
    expect(f.calls()).toBe(TX_ATTEMPTS);
  });

  it("retries a document-number collision once only", async () => {
    const collide = () => known("P2002", { modelName: "GoodsReceipt", target: ["hotelId", "number"] });
    const once = fakeDb([collide]);
    await expect(inTx(once.db, async () => 1)).resolves.toBe(1);
    expect(once.calls()).toBe(2);
    const twice = fakeDb([collide, collide]);
    await expect(inTx(twice.db, async () => 1)).rejects.toMatchObject({ code: "P2002" });
    expect(twice.calls()).toBe(2);
  });

  it("never retries other errors, and never inside the caller's transaction", async () => {
    const other = fakeDb([() => known("P2002", { modelName: "Supplier", target: ["hotelId", "code"] })]);
    await expect(inTx(other.db, async () => 1)).rejects.toMatchObject({ code: "P2002" });
    expect(other.calls()).toBe(1);
    // a transaction client (no $transaction): fn runs once and its error goes to the outer inTx
    let runs = 0;
    await expect(inTx({} as Db, async () => { runs++; throw deadlock(); })).rejects.toMatchObject({ code: "P2010" });
    expect(runs).toBe(1);
  });
});

describe("API error mapping", () => {
  it("a deadlock that outlived the retries is 503 'busy', translated, with Retry-After", async () => {
    const res = errorResponse(ormDeadlock(), "en", { requestId: "req-12345678" });
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("2");
    const body = await res.json();
    expect(body.error).toMatchObject({ code: "BUSY", requestId: "req-12345678" });
    expect(body.error.message).toMatch(/busy/);
    const tr = await errorResponse(known("P2034"), "tr").json();
    expect(tr.error.message).toBe("Sistem şu anda başka değişikliklerle meşgul: hiçbir şey kaydedilmedi, lütfen tekrar deneyin");
  });

  it("a unique violation stays 409 and an unknown error stays 500", async () => {
    expect(errorResponse(known("P2002", { target: ["hotelId", "number"] }), "en").status).toBe(409);
    expect(errorResponse(new Error("boom"), "en").status).toBe(500);
  });
});
