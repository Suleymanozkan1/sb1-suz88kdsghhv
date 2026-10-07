/**
 * Small local record of what was sent per business day (state/sent.json). For logging / support only —
 * idempotency is guaranteed by HotelCost (check no + day, supplier + invoice no, minibar reference ...).
 */
import fs from "node:fs";
import path from "node:path";
import { log } from "./logger";

export interface SentEntry { at: string; runId: string; items: number; accepted: number; duplicates: number; rejected: number }
export type SentState = Record<string, Record<string, SentEntry>>;

export class StateStore {
  private file: string;
  constructor(dir: string) {
    this.file = path.join(dir, "sent.json");
  }

  load(): SentState {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8")) as SentState;
    } catch {
      return {};
    }
  }

  get(day: string): Record<string, SentEntry> | undefined {
    return this.load()[day];
  }

  record(day: string, kind: string, entry: SentEntry): void {
    try {
      const state = this.load();
      state[day] = { ...(state[day] ?? {}), [kind]: entry };
      // keep the last 120 days
      const days = Object.keys(state).sort();
      for (const d of days.slice(0, Math.max(0, days.length - 120))) delete state[d];
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(state, null, 2));
    } catch (err) {
      log.warn(`could not write state file ${this.file}: ${(err as Error).message}`);
    }
  }

  /** generic small key/value (e.g. the daemon's last nightly run date) */
  meta(key: string, value?: string): string | undefined {
    const file = path.join(path.dirname(this.file), "meta.json");
    let data: Record<string, string> = {};
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
    } catch {
      /* first use */
    }
    if (value === undefined) return data[key];
    data[key] = value;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (err) {
      log.warn(`could not write ${file}: ${(err as Error).message}`);
    }
    return value;
  }
}
