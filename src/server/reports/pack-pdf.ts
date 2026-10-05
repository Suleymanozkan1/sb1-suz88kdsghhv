/**
 * Monthly management cost pack (spec 254) rendered as PDF. Pure rendering: every number comes from
 * the full-cost export (the same engine as the screens and Excel); nothing is recalculated here.
 */
import path from "node:path";
import PDFDocument from "pdfkit";
import type { Column, FullCostExport, Section } from "../services/export";
import { makeT, type Locale } from "@/i18n/core";
import { TR } from "@/i18n/tr";
import { xlLang } from "../excel/i18n";

const FONT = path.join(process.cwd(), "assets", "fonts", "DejaVuSans.ttf");
const FONT_BOLD = path.join(process.cwd(), "assets", "fonts", "DejaVuSans-Bold.ttf");
const INK = "#1f2937";
const MUTED = "#6b7280";
const BRAND = "#0f766e";
const STATUS_COLOR: Record<string, string> = { GREEN: "#15803d", YELLOW: "#b45309", RED: "#b91c1c", PASS: "#15803d", WARNING: "#b45309", FAIL: "#b91c1c" };

/** text columns holding fixed engine words (statement lines, enums, statuses, notes); other text columns are user data */
const TEXT_KEYS = new Set(["line", "metric", "type", "driver", "category", "utility", "channel", "status", "note", "detail", "check", "item", "impact"]);

export interface PackExtras {
  reconciliation: "GREEN" | "YELLOW" | "RED";
  closeChecks: Array<{ label: string; ok: boolean; critical: boolean; detail?: string }>;
  periodStatus: string;
}

function fmt(v: string | null | undefined, type: Column["type"], cur: string): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  switch (type) {
    case "money":
      return new Intl.NumberFormat("tr-TR", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(n);
    case "unitcost":
      return new Intl.NumberFormat("tr-TR", { style: "currency", currency: cur, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    case "pct":
      return `${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(n * 100)}%`;
    case "qty":
      return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(n);
    case "int":
      return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 0 }).format(n);
    default:
      return String(v);
  }
}

export async function renderManagementPack(e: FullCostExport, x: PackExtras, locale: Locale = "en"): Promise<Buffer> {
  const t = makeT(locale);
  /** engine words (statement lines, enums, notes, check names): translated when the dictionary knows them, else as is */
  // engine words and server texts with numbers inside ("10.4% price", "3 pending")
  // UI wording first; generated phrases (saving opportunities, notes with numbers) as in the Excel workbook
  const xl = xlLang(locale);
  const tx = (v: string): string => (locale === "en" ? v : (TR[v] ?? xl.val(v)));
  const cur = e.meta.hotel.currency;
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true, info: { Title: t("Management cost pack {period}", { period: e.meta.period.label }), Author: "HotelCost", Subject: e.meta.hotel.name, CreationDate: new Date(e.meta.generatedAt) } });
  doc.registerFont("body", FONT);
  doc.registerFont("bold", FONT_BOLD);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width - 80;
  const bottom = () => doc.page.height - 50;
  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };
  const h1 = (t: string) => {
    ensure(60);
    doc.moveDown(0.6).font("bold").fontSize(14).fillColor(BRAND).text(t, 40);
    doc.moveTo(40, doc.y + 2).lineTo(40 + W, doc.y + 2).strokeColor(BRAND).lineWidth(0.8).stroke();
    doc.moveDown(0.5).fillColor(INK);
  };
  const note = (t: string) => {
    if (!t) return;
    ensure(24);
    doc.font("body").fontSize(7.5).fillColor(MUTED).text(t, 40, doc.y, { width: W });
    doc.moveDown(0.3).fillColor(INK);
  };
  /** Table from an export section: chosen columns, widths as fractions. */
  const table = (s: Section | undefined, cols: Array<[string, number]>, opts: { max?: number; title?: string; filter?: (r: Record<string, string | null>) => boolean } = {}) => {
    // a column the export does not have is a layout bug: fail loudly outside production (even for empty sections)
    const unknown = s ? cols.filter(([k]) => !s.columns.some((c) => c.key === k)).map(([k]) => k) : [];
    if (unknown.length && process.env.NODE_ENV !== "production") throw new Error(`management pack: section ${s!.key} has no column ${unknown.join(", ")}`);
    if (opts.title) {
      ensure(40);
      doc.font("bold").fontSize(10).fillColor(INK).text(opts.title, 40);
      doc.moveDown(0.2);
    }
    if (!s || s.status === "NOT_AVAILABLE") {
      note(t("Not available — {note}", { note: s?.note ? tx(s.note) : t("module not in scope") }));
      return;
    }
    const rows = (opts.filter ? s.rows.filter(opts.filter) : s.rows).slice(0, opts.max ?? 25);
    if (!rows.length) {
      note(t("No data in this period."));
      return;
    }
    const defs = cols.map(([k, w]) => ({ c: s.columns.find((c) => c.key === k), w: w * W })).filter((d): d is { c: Column; w: number } => !!d.c);
    // generic dictionary words that mean something else here: asset "Name", income "Tax" (English unchanged)
    const head = (c: Column) => (locale !== "en" && s.key === "assetCost" && c.key === "name" ? t("Name (asset)") : t(c.header));
    const word = (v: string) => (locale !== "en" && s.key === "pnl" && v === "Tax" ? t("Tax (P&L line)") : tx(v));
    const right = (c: Column) => c.type !== "text" && c.type !== "date" && c.type !== "datetime";
    const header = () => {
      let xx = 40;
      const y = doc.y;
      doc.font("bold").fontSize(7.5);
      const hh = Math.max(...defs.map((d) => doc.heightOfString(head(d.c), { width: d.w - 4 }))) + 4;
      doc.rect(40, y - 2, W, hh).fill("#f3f4f6").fillColor(INK);
      for (const d of defs) {
        doc.text(head(d.c), xx + 2, y + 1, { width: d.w - 4, align: right(d.c) ? "right" : "left" });
        xx += d.w;
      }
      doc.y = y + hh;
    };
    ensure(30);
    header();
    doc.font("body").fontSize(7.5);
    for (const r of rows) {
      // statement sections carry a per-row format in a "kind" column (money / pct / qty)
      const rowKind = (r.kind ?? null) as Column["type"] | null;
      const cells = defs.map((d) => {
        const c = fmt(r[d.c.key], d.c.key === "value" && rowKind && ["money", "pct", "qty", "int", "unitcost"].includes(rowKind) ? rowKind : d.c.type, cur);
        return d.c.type === "text" && TEXT_KEYS.has(d.c.key) ? word(c) : c;
      });
      const h = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: defs[i]!.w - 4 }))) + 3;
      if (doc.y + h > bottom()) {
        doc.addPage();
        header();
        doc.font("body").fontSize(7.5);
      }
      const y = doc.y;
      let xx = 40;
      const bold = /^(TOTAL|Total|GOP|EBITDA|Actual Cost)/.test(String(r[defs[0]!.c.key] ?? ""));
      doc.font(bold ? "bold" : "body");
      defs.forEach((d, i) => {
        doc.fillColor(d.c.key === "status" ? STATUS_COLOR[String(r.status)] ?? INK : INK).text(cells[i]!, xx + 2, y + 1, { width: d.w - 4, align: right(d.c) ? "right" : "left" });
        xx += d.w;
      });
      doc.y = y + h;
      doc.moveTo(40, doc.y).lineTo(40 + W, doc.y).strokeColor("#e5e7eb").lineWidth(0.4).stroke();
    }
    if (s.rows.length > rows.length) note(t("… {n} more rows in the Excel report.", { n: s.rows.length - rows.length }));
    if (s.note) note(tx(s.note));
    doc.moveDown(0.4);
  };
  const S = e.sections;

  // ── Cover ──
  doc.font("bold").fontSize(22).fillColor(BRAND).text(t("Monthly Management Cost Pack"), 40, 120);
  doc.font("body").fontSize(14).fillColor(INK).text(e.meta.hotel.name).moveDown(0.3);
  doc.fontSize(12).text(t("Period: {label} ({from} – {to}) · {status}", { label: e.meta.period.label, from: e.meta.period.from, to: e.meta.period.to, status: tx(x.periodStatus) }));
  doc.moveDown(1.2);
  doc.font("bold").fontSize(12).fillColor(STATUS_COLOR[x.reconciliation]!).text(t("Reconciliation status: {status}", { status: tx(x.reconciliation) }));
  doc.font("body").fontSize(10).fillColor(INK).text(t("Server checks: {status} ({errors} errors, {warnings} warnings) · data quality {dq}%", { status: tx(e.score.reconciliation), errors: e.score.errors, warnings: e.score.warnings, dq: e.score.dataQuality ?? "—" }));
  doc.moveDown(1);
  doc.fontSize(9).fillColor(MUTED).text(t("Generated {at} UTC by {user}", { at: new Date(e.meta.generatedAt).toISOString().replace("T", " ").slice(0, 16), user: e.meta.generatedBy }));
  doc.text(t("Export {id} · contract {contract} · app {app}", { id: e.exportId, contract: e.exportVersion, app: e.appVersion }));
  doc.text(t("Period hash {hash}… (reproducibility of closed months)", { hash: e.meta.periodHash.slice(0, 24) }));
  doc.text(t("Scope: {scope}", { scope: e.meta.scope.departments === "ALL" ? t("all departments") : (e.meta.scope.departments as string[]).join(", ") }));
  doc.moveDown(1.5).fillColor(INK).font("bold").fontSize(11).text(t("Contents"));
  doc.font("body").fontSize(9).text(["Executive summary", "Food & beverage cost", "Rooms cost", "Labor · Energy · Laundry · Housekeeping · Engineering", "Purchasing & supplier changes", "Waste", "Stock", "Variance & unexplained usage", "Top cost drivers", "Budget", "Recommended actions", "Month-end checklist & reconciliation" ].map((c, i) => `${i + 1}. ${t(c)}`).join("\n"));

  // ── 1 Executive summary ──
  doc.addPage();
  h1(t("1. Executive summary"));
  const sum = e.summary;
  const kpi: Array<[string, string, Column["type"]]> = [
    ["Total revenue", "totalRevenue", "money"], ["Total cost", "totalCost", "money"], ["Actual cost of sales (F&B)", "actualCost", "money"], ["Theoretical cost", "theoreticalCost", "money"],
    ["Cost variance", "costVariance", "money"], ["Unexplained variance", "unexplainedVariance", "money"], ["Waste cost", "totalWasteCost", "money"], ["Labor cost", "totalLaborCost", "money"],
    ["Labor cost %", "laborCostPct", "pct"], ["Energy cost", "totalEnergyCost", "money"], ["Occupancy", "occupancy", "pct"], ["ADR", "adr", "unitcost"], ["RevPAR", "revpar", "unitcost"],
    ["Cost per occupied room", "costPerOccupiedRoom", "unitcost"], ["Room cost per night", "roomCostPerNight", "unitcost"], ["Cost per cover (buffet)", "costPerCover", "unitcost"],
    ["Stock value (period end)", "totalStockValue", "money"], ["GOP", "gop", "money"], ["EBITDA", "ebitda", "money"],
  ];
  const kpiSection: Section = { key: "kpi", title: "KPI", source: "summary", status: "OK", columns: [{ key: "metric", header: "Metric", type: "text" }, { key: "value", header: "Value", type: "text" }, { key: "status", header: "Data status", type: "text" }, { key: "note", header: "Note", type: "text" }], rows: kpi.map(([label, k, ty]) => ({ metric: t(label), value: fmt(sum[k]?.value ?? null, ty, cur), status: sum[k]?.status ?? "NOT_AVAILABLE", note: sum[k]?.note ?? null })) };
  table(kpiSection, [["metric", 0.28], ["value", 0.18], ["status", 0.16], ["note", 0.38]], { max: 40 });

  h1(t("2. Food & beverage cost"));
  table(S.foodCost, [["line", 0.7], ["value", 0.3]], { title: t("Food cost statement"), max: 20 });
  table(S.beverageCost, [["line", 0.7], ["value", 0.3]], { title: t("Beverage cost statement"), max: 20 });
  table(S.buffetSummary, [["meal", 0.4], ["cost", 0.2], ["costPerCover", 0.2], ["wastePerCover", 0.2]], { title: t("Buffet") });

  h1(t("3. Rooms cost"));
  table(S.roomTypeCost, [["group", 0.16], ["rooms", 0.08], ["occupiedNights", 0.12], ["roomRevenue", 0.16], ["fullCost", 0.16], ["costPerNight", 0.14], ["contribution", 0.18]], { title: t("By room type") });
  table(S.roomChannelCost, [["channel", 0.16], ["nights", 0.1], ["gross", 0.16], ["distribution", 0.16], ["net", 0.14], ["roomCost", 0.14], ["netContribution", 0.14]], { title: t("By channel (net room contribution)") });

  h1(t("4. Labor · energy · laundry · housekeeping · engineering"));
  table(S.laborCost, [["department", 0.22], ["employees", 0.1], ["salary", 0.14], ["employerCost", 0.14], ["overtime", 0.12], ["total", 0.14], ["costPct", 0.14]], { title: t("Labor"), max: 15 });
  table(S.energyCost, [["utility", 0.18], ["cost", 0.16], ["billedQty", 0.14], ["unit", 0.08], ["unitCost", 0.14], ["perOccupiedRoom", 0.15], ["meterCoverage", 0.15]], { title: t("Energy") });
  table(S.laundryCost, [["line", 0.45], ["quantity", 0.12], ["unit", 0.08], ["value", 0.17], ["perOccupiedRoom", 0.18]], { title: t("Laundry") });
  table(S.housekeepingCost, [["line", 0.5], ["value", 0.25], ["perOccupiedRoom", 0.25]], { title: t("Housekeeping") });
  table(S.engineeringCost, [["type", 0.5], ["cost", 0.3], ["share", 0.2]], { title: t("Engineering") });
  table(S.assetCost, [["asset", 0.18], ["name", 0.32], ["periodCost", 0.18], ["periodJobs", 0.12], ["cumulativeCost", 0.2]], { title: t("Cost per asset (top)"), max: 8 });

  h1(t("5. Purchasing & supplier changes"));
  table(S.ppv, [["product", 0.28], ["standardCost", 0.14], ["actualPurchaseCost", 0.14], ["ppvPct", 0.1], ["priceVariance", 0.16], ["impact", 0.18]], { title: t("Purchase price variance"), max: 12 });
  table(S.topCostDrivers, [["rank", 0.07], ["product", 0.3], ["supplier", 0.25], ["costIncrease", 0.18], ["impact", 0.2]], { title: t("Top cost drivers"), max: 10 });

  h1(t("6. Waste"));
  table(S.wasteSummary, [["metric", 0.6], ["value", 0.4]], { title: t("Waste summary"), max: 12 });
  table(S.topWaste, [["rank", 0.08], ["key", 0.44], ["records", 0.14], ["cost", 0.2], ["pct", 0.14]], { title: t("Top waste drivers"), max: 10 });

  h1(t("7. Stock"));
  table(S.criticalStock, [["product", 0.3], ["currentStock", 0.14], ["unit", 0.08], ["minimum", 0.14], ["recommendedOrder", 0.16], ["status", 0.18]], { title: t("Critical stock (at generation time)"), max: 12 });

  h1(t("8. Variance & unexplained usage"));
  table(S.topVariance, [["rank", 0.08], ["product", 0.32], ["theoreticalCost", 0.2], ["actualCost", 0.2], ["variance", 0.2]], { title: t("Top theoretical vs actual differences"), max: 10 });
  table(S.unexplainedVariance, [["product", 0.34], ["theoretical", 0.16], ["actual", 0.16], ["knownWaste", 0.14], ["unexplained", 0.2]], { title: t("Unexplained variance (largest)"), max: 10, filter: (r) => Number(r.unexplained ?? 0) > 0 });

  h1(t("9. Budget"));
  table(S.budgetVariance, [["category", 0.22], ["budget", 0.15], ["actual", 0.15], ["variance", 0.15], ["variancePct", 0.11], ["ytdVariance", 0.22]], { title: t("Budget vs actual"), max: 25 });
  table(S.pnl, [["line", 0.6], ["value", 0.25], ["status", 0.15]], { title: t("P&L cost view"), max: 20 });

  h1(t("10. Recommended actions"));
  table(S.costSaving, [["driver", 0.13], ["item", 0.37], ["saving", 0.14], ["owner", 0.14], ["dueDate", 0.1], ["status", 0.12]], { title: t("Saving actions and opportunities"), max: 18 });

  h1(t("11. Month-end checklist & reconciliation"));
  const cl: Section = { key: "cl", title: "Checklist", source: "period", status: "OK", columns: [{ key: "item", header: "Check", type: "text" }, { key: "status", header: "Status", type: "text" }, { key: "detail", header: "Detail", type: "text" }], rows: x.closeChecks.map((c) => ({ item: `${tx(c.label)}${c.critical ? " *" : ""}`, status: c.ok ? "PASS" : c.critical ? "FAIL" : "WARNING", detail: c.detail ?? null })) };
  table(cl, [["item", 0.55], ["status", 0.15], ["detail", 0.3]], { max: 30 });
  const checkName = (c: string) => (c.startsWith("Module available: ") ? t("Module available: {name}", { name: tx(c.slice(18)) }) : tx(c));
  const ck: Section = { key: "ck", title: "Checks", source: "export", status: "OK", columns: [{ key: "check", header: "Server reconciliation check", type: "text" }, { key: "status", header: "Status", type: "text" }], rows: e.checks.map((c) => ({ check: checkName(c.check), status: c.status })) };
  table(ck, [["check", 0.82], ["status", 0.18]], { max: 40 });

  // footer with page numbers
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.page.margins.bottom = 0; // writing inside the bottom margin must not open a new page
    doc.font("body").fontSize(7).fillColor(MUTED).text(t("{hotel} · {period} · page {page} / {pages}", { hotel: e.meta.hotel.name, period: e.meta.period.label, page: i + 1, pages: range.count }), 40, doc.page.height - 30, { width: W, align: "center", lineBreak: false });
  }
  doc.end();
  return done;
}
