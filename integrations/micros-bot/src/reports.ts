/**
 * Report definitions (reports.json, REPORTS_FILE): WHICH reports the bot reads from Micros / Opera, filled in once
 * the hotel has shown its reports — without code changes. Per system ("micros", "opera") and data kind:
 *   reportName     the report's name as shown in Micros / Opera reporting (logs, check-config, error messages)
 *   menuPath       how to open it, e.g. "Raporlar > Satış > Menü Ürün Satışları" (the clicks themselves are the
 *                  "steps" of the same block in the selectors file)
 *   format         "screen": the report is read on screen (the only format supported so far)
 *   waitForData    true: an empty report means the night audit has not finished yet; the nightly run then tries
 *                  again later (RETRY_MINUTES, until RETRY_UNTIL)
 *   columns        report column header → field, e.g. { "qty": "Adet" }. null = the CSS selector of the field in the
 *                  selectors file is used (the behaviour before report definitions existed)
 *   kindMap / defaultKind   comps only: which text in the "kind" column means on-house (ödenmez) / hospitality (ikram)
 * Values starting with "TODO" are placeholders to fill in after the hotel shows its reports. A comps (ödenmez /
 * ikram) report is read only when its definition exists and its reportName is filled in; otherwise it is skipped.
 */
import fs from "node:fs";
import type { CompKind, Kind } from "./contract";
import { BotError } from "./errors";

export type ReportSystem = "micros" | "opera";
export const REPORT_SYSTEMS: ReportSystem[] = ["micros", "opera"];

/** Kinds each system can deliver, and the fields a report column can be mapped to. */
export const REPORT_FIELDS: Record<ReportSystem, Partial<Record<Kind, readonly string[]>>> = {
  micros: {
    checks: ["itemCode", "itemName", "qty", "amount"],
    invoices: ["itemCode", "itemName", "qty", "unit", "unitPrice", "taxRatePct"],
    covers: ["outlet", "meal", "covers"],
    products: ["name", "code", "unit", "packSize", "packUnit", "taxRatePct", "category", "createdAt"],
    comps: ["checkNo", "outlet", "kind", "reason", "person", "note", "itemCode", "itemName", "qty"],
  },
  opera: {
    occupancy: [],
    minibar: ["room", "itemCode", "itemName", "qty", "reference", "postedAt"],
    comps: ["checkNo", "outlet", "kind", "reason", "person", "note", "itemCode", "itemName", "qty"],
  },
};

const COMP_KINDS: CompKind[] = ["ON_HOUSE", "HOSPITALITY"];
const FORMATS = ["screen"] as const;

export interface ReportDefinition {
  reportName: string | null;
  menuPath: string | null;
  format: (typeof FORMATS)[number];
  waitForData: boolean;
  /** field → column header; a field without one is read with its CSS selector from the selectors file */
  columns: Record<string, string>;
  /** comps: text in the kind column → kind (case-insensitive, "contains") */
  kindMap?: Record<string, CompKind>;
  /** comps: kind when the report has no kind column or the text is not in kindMap */
  defaultKind?: CompKind | null;
}

export type ReportDefinitions = Record<ReportSystem, Partial<Record<Kind, ReportDefinition>>>;

export const isPlaceholder = (v: unknown): boolean => typeof v === "string" && /^\s*TODO/i.test(v);
const filled = (v: string | null | undefined): v is string => typeof v === "string" && v.trim() !== "" && !isPlaceholder(v);

/** Built-in definitions = the behaviour without a reports file: CSS columns, the sales report decides readiness, no comps. */
export function defaultDefinitions(): ReportDefinitions {
  const def = (waitForData = false): ReportDefinition => ({ reportName: null, menuPath: null, format: "screen", waitForData, columns: {} });
  return {
    micros: { checks: def(true), invoices: def(), covers: def(), products: def() },
    opera: { occupancy: def(), minibar: def() },
  };
}

/** Validate parsed JSON; problems are Turkish sentences for the person filling the file in. */
export function parseDefinitions(json: unknown, file = "reports.json"): { definitions: ReportDefinitions; problems: string[] } {
  const problems: string[] = [];
  const definitions = defaultDefinitions();
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { definitions, problems: [`${file}: en üst düzeyde { "micros": {…}, "opera": {…} } nesnesi olmalı`] };
  }
  for (const [sysKey, block] of Object.entries(json as Record<string, unknown>)) {
    if (sysKey.startsWith("_")) continue;
    if (!REPORT_SYSTEMS.includes(sysKey as ReportSystem)) {
      problems.push(`${file}: bilinmeyen sistem "${sysKey}" (geçerli: ${REPORT_SYSTEMS.join(", ")})`);
      continue;
    }
    const system = sysKey as ReportSystem;
    if (block === null) continue;
    if (typeof block !== "object" || Array.isArray(block)) {
      problems.push(`${file}: "${system}" bir nesne olmalı`);
      continue;
    }
    for (const [kindKey, raw] of Object.entries(block as Record<string, unknown>)) {
      if (kindKey.startsWith("_")) continue;
      const fields = REPORT_FIELDS[system][kindKey as Kind];
      const where = `${file} ${system}.${kindKey}`;
      if (!fields) {
        problems.push(`${file}: ${system} için bilinmeyen veri türü "${kindKey}" (geçerli: ${Object.keys(REPORT_FIELDS[system]).join(", ")})`);
        continue;
      }
      const kind = kindKey as Kind;
      if (raw === null) {
        // null = this report is not used: comps skipped; for the others the built-in defaults stay
        if (kind === "comps") delete definitions[system].comps;
        continue;
      }
      if (typeof raw !== "object" || Array.isArray(raw)) {
        problems.push(`${where}: bir nesne veya null olmalı`);
        continue;
      }
      const r = raw as Record<string, unknown>;
      const base = definitions[system][kind] ?? { reportName: null, menuPath: null, format: "screen" as const, waitForData: false, columns: {} };
      const def: ReportDefinition = { ...base, columns: {} };
      for (const key of Object.keys(r)) {
        if (key.startsWith("_")) continue;
        if (!["reportName", "menuPath", "format", "waitForData", "columns", "kindMap", "defaultKind"].includes(key)) problems.push(`${where}: bilinmeyen ayar "${key}"`);
      }
      for (const key of ["reportName", "menuPath"] as const) {
        const v = r[key];
        if (v === undefined || v === null) def[key] = null;
        else if (typeof v === "string") def[key] = v.trim() || null;
        else problems.push(`${where}.${key}: metin veya null olmalı`);
      }
      if (r.format !== undefined && r.format !== null) {
        if (!FORMATS.includes(r.format as (typeof FORMATS)[number])) problems.push(`${where}.format: "${String(r.format)}" desteklenmiyor (şimdilik yalnızca "screen": rapor ekrandan okunur)`);
      }
      if (r.waitForData !== undefined) {
        if (typeof r.waitForData !== "boolean") problems.push(`${where}.waitForData: true veya false olmalı`);
        else def.waitForData = r.waitForData;
      }
      if (r.columns !== undefined && r.columns !== null) {
        if (typeof r.columns !== "object" || Array.isArray(r.columns)) problems.push(`${where}.columns: { "alan": "Sütun başlığı" } biçiminde olmalı`);
        else {
          const seen = new Map<string, string>();
          for (const [field, header] of Object.entries(r.columns as Record<string, unknown>)) {
            if (field.startsWith("_")) continue;
            if (!fields.includes(field)) {
              problems.push(`${where}.columns: bilinmeyen alan "${field}" (geçerli: ${fields.length ? fields.join(", ") : "bu rapor sütun eşleştirmesi kullanmaz"})`);
              continue;
            }
            if (header === null || header === undefined) continue;
            if (typeof header !== "string") {
              problems.push(`${where}.columns.${field}: sütun başlığı metin veya null olmalı`);
              continue;
            }
            if (!filled(header)) continue; // TODO placeholder / empty: the selectors file's CSS is used
            const key = header.trim().toLocaleLowerCase("tr-TR");
            const other = seen.get(key);
            if (other) problems.push(`${where}.columns: "${header.trim()}" başlığı iki alana verilmiş (${other}, ${field})`);
            seen.set(key, field);
            def.columns[field] = header.trim();
          }
        }
      }
      if (kind === "comps") {
        if (r.kindMap !== undefined && r.kindMap !== null) {
          if (typeof r.kindMap !== "object" || Array.isArray(r.kindMap)) problems.push(`${where}.kindMap: { "Rapordaki metin": "ON_HOUSE" | "HOSPITALITY" } biçiminde olmalı`);
          else {
            def.kindMap = {};
            for (const [text, k] of Object.entries(r.kindMap as Record<string, unknown>)) {
              if (text.startsWith("_") || isPlaceholder(text)) continue;
              if (!COMP_KINDS.includes(k as CompKind)) problems.push(`${where}.kindMap."${text}": "${String(k)}" geçersiz (ON_HOUSE = ödenmez, HOSPITALITY = ikram)`);
              else def.kindMap[text] = k as CompKind;
            }
          }
        }
        if (r.defaultKind !== undefined && r.defaultKind !== null) {
          if (!COMP_KINDS.includes(r.defaultKind as CompKind)) problems.push(`${where}.defaultKind: "${String(r.defaultKind)}" geçersiz (ON_HOUSE, HOSPITALITY veya null)`);
          else def.defaultKind = r.defaultKind as CompKind;
        }
        if (filled(def.reportName) && !def.defaultKind && !Object.keys(def.kindMap ?? {}).length) {
          problems.push(`${where}: ödenmez / ikram ayrımı için kindMap (rapordaki metin → ON_HOUSE / HOSPITALITY) veya defaultKind doldurulmalı`);
        }
      } else if (r.kindMap !== undefined || r.defaultKind !== undefined) {
        problems.push(`${where}: kindMap / defaultKind yalnızca comps (ödenmez / ikram) raporunda kullanılır`);
      }
      definitions[system][kind] = def;
    }
  }
  return { definitions, problems };
}

/** Load and validate the file; a missing file means the built-in defaults. Throws a BotError listing every problem. */
export function loadDefinitions(file: string): ReportDefinitions {
  if (!fs.existsSync(file)) return defaultDefinitions();
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new BotError(`rapor tanımları dosyası okunamadı: ${file} (${(err as Error).message})`);
  }
  const { definitions, problems } = parseDefinitions(json, file);
  if (problems.length) throw new BotError(`rapor tanımları dosyasında ${problems.length} sorun var: ${problems.join("; ")}`);
  return definitions;
}

/** Problems of the file as a list (empty = fine; a missing file is fine). For check-config and startup. */
export function validateDefinitionsFile(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  try {
    return parseDefinitions(JSON.parse(fs.readFileSync(file, "utf8")), file).problems;
  } catch (err) {
    return [`rapor tanımları dosyası okunamadı: ${file} (${(err as Error).message})`];
  }
}

/** Is the comps (ödenmez / ikram) report of this system set up? Only then the bot reads it. */
export function compsDefined(defs: ReportDefinitions, system: ReportSystem): boolean {
  return filled(defs[system].comps?.reportName);
}

/** Placeholders still waiting for the hotel (dotted paths), for check-config. */
export function definitionPlaceholders(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const out: string[] = [];
  const walk = (v: unknown, p: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k.startsWith("_")) continue;
        if (isPlaceholder(k)) out.push(`${p}.${k}`);
        walk(x, p ? `${p}.${k}` : k);
      }
    } else if (isPlaceholder(v)) out.push(p);
  };
  walk(json, "");
  return out;
}

/** "Menü Ürün Satışları (Raporlar > Satış > …)" or null: names the report in logs and messages. */
export function describeReport(def: ReportDefinition | undefined): string | null {
  if (!def || !filled(def.reportName)) return null;
  return filled(def.menuPath) ? `${def.reportName} (${def.menuPath})` : def.reportName;
}

/** comps: the kind for a text of the kind column (kindMap, case-insensitive "contains"), else defaultKind. */
export function compKindOf(def: ReportDefinition, text: string | null | undefined): CompKind | null {
  const t = (text ?? "").toLocaleLowerCase("tr-TR").trim();
  if (t && def.kindMap) {
    for (const [k, v] of Object.entries(def.kindMap)) if (t.includes(k.toLocaleLowerCase("tr-TR").trim())) return v;
  }
  return def.defaultKind ?? null;
}
