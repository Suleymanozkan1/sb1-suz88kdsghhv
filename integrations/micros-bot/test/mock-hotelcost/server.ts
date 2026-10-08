/**
 * Fake HotelCost integration API that records every request.
 *   POST /api/integrations/ingest   validates the bearer key and the body, dedupes like the real server
 *   POST /api/integrations/runs     records run status reports
 *   GET  /api/integrations/runs/next  hands out queued "run now" requests one by one
 * Bodies are validated with HotelCost's real zod contract (../../../../src/server/integrations/contract.ts) when the
 * bot lives inside the HotelCost repo — that catches drift between the bot's copy and the server — and with the
 * bot's own copy otherwise.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AddressInfo } from "node:net";
import type { ZodTypeAny } from "zod";
import * as local from "../../src/contract";

export interface RecordedRequest { method: string; path: string; auth: string | undefined; body: unknown; status?: number }
export interface MockHotelCostState {
  apiKey: string;
  requests: RecordedRequest[];
  /** answer the next N ingest calls with 503 (retry test) */
  failNextIngest: number;
  queue: Array<{ id: string; source: string; businessDay: string | null }>;
  /** what HotelCost answers as the hotel's settings (Admin → business day ends at) */
  settings?: { businessDayCutoff: string; timezone: string };
  seen: Set<string>;
}
export interface MockHotelCost {
  url: string;
  state: MockHotelCostState;
  /** which contract validated the bodies */
  contract: "hotelcost-repo" | "bot-copy";
  ingests(kind?: string): Array<{ kind: string; source: string; businessDay: string; runId: string; items: any[] }>;
  runs(): Array<{ runId: string; source: string; status: string; businessDay?: string; message?: string; requestId?: string }>;
  close(): Promise<void>;
}

async function loadContract(): Promise<{ ingest: ZodTypeAny; run: ZodTypeAny; from: MockHotelCost["contract"] }> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoContract = path.resolve(here, "../../../../src/server/integrations/contract.ts");
  if (fs.existsSync(repoContract)) {
    try {
      const m = (await import(pathToFileURL(repoContract).href)) as { ingestSchema: ZodTypeAny; runStatusSchema: ZodTypeAny };
      if (m.ingestSchema && m.runStatusSchema) return { ingest: m.ingestSchema, run: m.runStatusSchema, from: "hotelcost-repo" };
    } catch {
      /* fall back to the bot's copy */
    }
  }
  const { z } = await import("zod");
  const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
  const kinds = Object.keys(local.ITEM_SCHEMAS) as Array<keyof typeof local.ITEM_SCHEMAS>;
  const ingest = z.union(kinds.map((k) => z.object({ kind: z.literal(k), source: z.string(), businessDay: day, runId: z.string().max(64).optional(), items: z.array(local.ITEM_SCHEMAS[k]) })) as unknown as [ZodTypeAny, ZodTypeAny]);
  const run = z.object({ runId: z.string().min(1).max(64), source: z.enum(["MICROS", "OPERA", "OTHER"]), status: z.enum(["STARTED", "SUCCEEDED", "FAILED"]), businessDay: day.optional(), message: z.string().max(2000).optional(), requestId: z.string().optional() });
  return { ingest, run, from: "bot-copy" };
}

function keyOf(kind: string, day: string, item: any): string {
  switch (kind) {
    case "checks": return `c|${day}|${item.checkNo}`;
    case "invoices": return `i|${String(item.supplierName).toLowerCase()}|${item.invoiceNo}`;
    case "minibar": return `m|${item.reference}`;
    case "covers": return `v|${day}|${item.outlet}|${item.meal}`;
    default: return `o|${day}`;
  }
}

export async function startMockHotelCost(apiKey = "hc_test_key_123456"): Promise<MockHotelCost> {
  const contract = await loadContract();
  const state: MockHotelCostState = { apiKey, requests: [], failNextIngest: 0, queue: [], seen: new Set() };

  const server = http.createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://mock");
      let body: unknown = undefined;
      try {
        body = data ? JSON.parse(data) : undefined;
      } catch {
        body = data;
      }
      const record: RecordedRequest = { method: req.method ?? "", path: url.pathname, auth: req.headers.authorization, body };
      state.requests.push(record);
      const json = (status: number, obj: unknown) => {
        record.status = status;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      if (req.headers.authorization !== `Bearer ${state.apiKey}`) return json(401, { error: "Invalid integration key" });

      if (req.method === "POST" && url.pathname === "/api/integrations/ingest") {
        if (state.failNextIngest > 0) {
          state.failNextIngest--;
          return json(503, { error: "temporarily unavailable" });
        }
        const parsed = contract.ingest.safeParse(body);
        if (!parsed.success) return json(400, { error: "Invalid body", issues: parsed.error.issues.slice(0, 5) });
        const b = parsed.data as { kind: string; businessDay: string; runId?: string; items: any[] };
        let accepted = 0;
        let duplicates = 0;
        for (const item of b.items) {
          const k = keyOf(b.kind, b.businessDay, item);
          if (state.seen.has(k) && (b.kind === "checks" || b.kind === "invoices" || b.kind === "minibar")) duplicates++;
          else {
            state.seen.add(k);
            accepted++;
          }
        }
        return json(200, { runId: b.runId ?? "server-run", kind: b.kind, received: b.items.length, accepted, duplicates, errors: [] });
      }
      if (req.method === "POST" && url.pathname === "/api/integrations/runs") {
        const parsed = contract.run.safeParse(body);
        if (!parsed.success) return json(400, { error: "Invalid body", issues: parsed.error.issues.slice(0, 5) });
        return json(200, { ok: true });
      }
      if (req.method === "GET" && url.pathname === "/api/integrations/runs/next") {
        return json(200, { request: state.queue.shift() ?? null, settings: state.settings ?? null });
      }
      return json(404, { error: "not found" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const okBodies = (p: string) => state.requests.filter((r) => r.method === "POST" && r.path === p && r.status === 200).map((r) => r.body as any);
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    contract: contract.from,
    ingests: (kind) => okBodies("/api/integrations/ingest").filter((b) => !kind || b.kind === kind),
    runs: () => okBodies("/api/integrations/runs"),
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
