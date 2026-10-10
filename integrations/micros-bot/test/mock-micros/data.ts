/** Deterministic fake hotel data for the mock Micros / Opera, and the payloads the bot is expected to send. */

export interface MockLine { code: string; name: string; qty: number; amount: number }
export interface MockCheck { id: string; checkNo: string; outlet: string; closed: string /* DD.MM.YYYY HH:mm */; lines: MockLine[] }
export interface MockInvoiceLine { code: string; name: string; qty: number; unit: string; price: number; vat: number }
export interface MockInvoice { id: string; supplier: string; invoiceNo: string; date: string /* YYYY-MM-DD */; store: string; lines: MockInvoiceLine[] }
export interface MockCovers { outlet: string; meal: string; covers: number }
export interface MockMinibar { room: string; code: string; item: string; qty: number; ref: string; time: string }
export interface MockProduct { code: string; name: string; unit: string; pack: number | null; packUnit: string; vat: number; group: string; created: string /* YYYY-MM-DD */ }
export interface MockStats { available: number; occupied: number; guests: number; revenue: number; ooo: number; rooms: string[] }

const OUTLETS = ["Lobby Bar", "A la Carte Restoran", "Havuz Bar"];
const MENU: Array<[string, string, number]> = [
  ["1001", "Efes Pilsen 50cl", 180],
  ["1002", "Kola 33cl", 90],
  ["2001", "Izgara Köfte", 450],
  ["2002", "Mercimek Çorbası", 160.5],
  ["3001", "Türk Kahvesi", 95],
  ["4001", "Sezar Salata", 1234.5],
];

/** "2026-10-06" → "06.10.2026" */
export const trDate = (day: string) => day.split("-").reverse().join(".");

export function checksFor(day: string, count: number): MockCheck[] {
  const [, mm, dd] = day.split("-");
  const out: MockCheck[] = [];
  for (let i = 1; i <= count; i++) {
    const lines: MockLine[] = [];
    const n = (i % 3) + 1;
    for (let j = 0; j < n; j++) {
      const [code, name, price] = MENU[(i + j) % MENU.length]!;
      const qty = ((i + j) % 2) + 1;
      lines.push({ code, name, qty, amount: Number((price * qty).toFixed(2)) });
    }
    const hour = 10 + (i % 13);
    out.push({ id: `${day}-${i}`, checkNo: `${mm}${dd}${String(i).padStart(4, "0")}`, outlet: OUTLETS[i % OUTLETS.length]!, closed: `${trDate(day)} ${String(hour).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}`, lines });
  }
  return out;
}

export function invoicesFor(day: string): MockInvoice[] {
  return [
    { id: "inv1", supplier: "Ege Gıda A.Ş.", invoiceNo: `EGE${day.replace(/-/g, "")}01`, date: day, store: "Ana Depo", lines: [
      { code: "ST-01", name: "Un 50 kg", qty: 4, unit: "çuval", price: 1250.75, vat: 1 },
      { code: "ST-02", name: "Ayçiçek Yağı 18 lt", qty: 2, unit: "teneke", price: 2100, vat: 1 },
    ] },
    { id: "inv2", supplier: "Akdeniz Et Ltd.", invoiceNo: `AK-${day.slice(8)}-77`, date: day, store: "Mutfak Deposu", lines: [
      { code: "", name: "Dana Kıyma", qty: 12.5, unit: "kg", price: 690, vat: 1 },
    ] },
    { id: "inv3", supplier: "İçecek Dağıtım", invoiceNo: "ID-5531", date: day, store: "Bar Deposu", lines: [
      { code: "B-11", name: "Efes Pilsen 50cl", qty: 240, unit: "adet", price: 61.2, vat: 20 },
      { code: "B-12", name: "Kola 33cl", qty: 96, unit: "adet", price: 22.4, vat: 20 },
    ] },
  ];
}

export function coversFor(_day: string): MockCovers[] {
  return [
    { outlet: "Ana Restoran", meal: "Kahvaltı", covers: 214 },
    { outlet: "Ana Restoran", meal: "Akşam Yemeği", covers: 1180 },
    { outlet: "A la Carte Restoran", meal: "Akşam Yemeği", covers: 42 },
  ];
}

export function minibarFor(day: string): MockMinibar[] {
  const d = trDate(day);
  return [
    { room: "101", code: "MB01", item: "Su 0,5 lt", qty: 2, ref: "F-88121", time: `${d} 09:12` },
    { room: "101", code: "MB07", item: "Çikolata", qty: 1, ref: "F-88122", time: `${d} 09:12` },
    { room: "214", code: "MB03", item: "Kola 33cl", qty: 3, ref: "F-88140", time: `${d} 11:40` },
    { room: "305", code: "MB01", item: "Su 0,5 lt", qty: -1, ref: "F-88141", time: `${d} 12:02` }, // correction: ignored by the bot
  ];
}

/** Product cards of the purchasing module, with the day each was created. */
export function productsAll(): MockProduct[] {
  return [
    { code: "ST-01", name: "Un 50 kg", unit: "çuval", pack: 50, packUnit: "kg", vat: 1, group: "Kuru Gıda", created: "2026-09-20" },
    { code: "ST-31", name: "Domates Salçası 830 gr", unit: "adet", pack: 830, packUnit: "gr", vat: 1, group: "Kuru Gıda", created: "2026-10-02" },
    { code: "B-40", name: "Maden Suyu 200 ml", unit: "koli", pack: 24, packUnit: "adet", vat: 20, group: "İçecek", created: "2026-10-05" },
    { code: "", name: "Dana Antrikot", unit: "kg", pack: null, packUnit: "", vat: 1, group: "Et", created: "2026-10-06" },
  ];
}

export function statsFor(_day: string): MockStats {
  return { available: 248, occupied: 3, guests: 5, revenue: 123456.78, ooo: 2, rooms: ["101", "214", "305"] };
}

/** Format like Micros does in Turkish locale: 1.234,50 */
export const trNum = (n: number, decimals = 2) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
