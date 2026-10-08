/**
 * HotelCost API client.
 *   POST /api/integrations/ingest      data (chunked)
 *   POST /api/integrations/runs        run status STARTED / SUCCEEDED / FAILED
 *   GET  /api/integrations/runs/next   pending "Şimdi çalıştır" request
 * Retries with exponential backoff on network errors, 5xx and 429 (Retry-After honoured); never on other 4xx.
 */
import { HttpError } from "../errors";
import { log, redact } from "../logger";
import type { IngestBody, IngestResult, ItemsByKind, Kind, NextRunResponse, RunStatusBody } from "../contract";

export interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  retries?: number;
  retryBaseMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HotelCostClient {
  private retries: number;
  private retryBaseMs: number;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(private opts: ClientOptions) {
    this.retries = opts.retries ?? 5;
    this.retryBaseMs = opts.retryBaseMs ?? 1000;
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const url = `${this.opts.baseUrl}${path}`;
    let attempt = 0;
    for (;;) {
      attempt++;
      let retryAfterMs: number | null = null;
      let failure: Error;
      try {
        const res = await this.fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${this.opts.apiKey}`,
            Accept: "application/json",
            ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
            "User-Agent": "hotelcost-micros-bot/0.1",
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        const text = await res.text();
        if (res.ok) return (text ? JSON.parse(text) : {}) as T;
        let detail = text;
        try {
          const j = JSON.parse(text) as { error?: unknown; message?: unknown };
          detail = String(j.error ?? j.message ?? text);
        } catch {
          /* plain text body */
        }
        const err = new HttpError(res.status, redact(detail), url);
        if (res.status !== 429 && res.status < 500) throw err; // 4xx: our request is wrong → retrying will not help
        failure = err;
        const ra = res.headers.get("retry-after");
        if (ra && Number.isFinite(Number(ra))) retryAfterMs = Number(ra) * 1000;
      } catch (err) {
        if (err instanceof HttpError && err.status !== 429 && err.status < 500) throw err;
        failure = err as Error;
      }
      if (attempt > this.retries) throw failure instanceof HttpError ? failure : new Error(`network error calling HotelCost ${path}: ${describe(failure)}`);
      const delay = retryAfterMs ?? this.retryBaseMs * 2 ** (attempt - 1);
      log.warn(`HotelCost ${method} ${path} failed (${describe(failure)}), retry ${attempt}/${this.retries} in ${delay} ms`);
      await sleep(delay);
    }
  }

  async ingestChunk<K extends Kind>(body: IngestBody<K>): Promise<IngestResult> {
    return this.request<IngestResult>("POST", "/api/integrations/ingest", body);
  }

  /** Post items in chunks; results are added up (error item indexes are made relative to the full list). */
  async ingest<K extends Kind>(base: Omit<IngestBody<K>, "items">, items: ItemsByKind[K][], chunkSize: number): Promise<IngestResult> {
    const total: IngestResult = { runId: base.runId ?? "", kind: base.kind, received: 0, accepted: 0, duplicates: 0, errors: [] };
    const size = Math.max(1, chunkSize);
    const chunks = Math.ceil(items.length / size);
    for (let offset = 0, n = 1; offset < items.length; offset += size, n++) {
      const chunk = items.slice(offset, offset + size);
      if (chunks > 1) log.info(`posting ${base.kind} chunk ${n}/${chunks} (${chunk.length} items)`);
      const r = await this.ingestChunk({ ...base, items: chunk } as IngestBody<K>);
      total.runId = r.runId ?? total.runId;
      total.received += r.received ?? chunk.length;
      total.accepted += r.accepted ?? 0;
      total.duplicates += r.duplicates ?? 0;
      for (const e of r.errors ?? []) total.errors.push({ item: e.item + offset, message: e.message });
    }
    return total;
  }

  /** Report a run status. Never throws: a broken status report must not stop the data transfer. */
  async reportRun(body: RunStatusBody): Promise<boolean> {
    try {
      await this.request("POST", "/api/integrations/runs", { ...body, message: body.message ? redact(body.message).slice(0, 2000) : undefined });
      return true;
    } catch (err) {
      log.error(`could not report run ${body.status} to HotelCost: ${describe(err)}`);
      return false;
    }
  }

  async nextRequest(): Promise<NextRunResponse> {
    return this.request<NextRunResponse>("GET", "/api/integrations/runs/next");
  }
}

function describe(err: unknown): string {
  const e = err as Error & { cause?: { code?: string; message?: string } };
  if (e?.name === "TimeoutError") return "timeout";
  const cause = e?.cause?.code ?? e?.cause?.message;
  return redact(cause ? `${e.message} (${cause})` : String(e?.message ?? err));
}
