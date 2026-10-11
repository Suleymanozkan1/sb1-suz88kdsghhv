/** Turkish strings added in feedback round 2 (r2f). Key = English source text. */
export const r2f: Record<string, string> = {
  // management pack / reports page: no budget section, the P&L keeps its own heading
  "9. P&L cost view": "9. Kâr-zarar maliyet görünümü",
  "Executive summary, F&B, rooms, labor, energy, laundry, housekeeping, engineering, purchasing & supplier changes, waste, stock, variance, top drivers, P&L cost view, recommended actions and the month-end checklist — from the same engine as the screens and Excel.":
    "Yönetici özeti, F&B, odalar, personel, enerji, çamaşırhane, kat hizmetleri, teknik, satın alma ve tedarikçi değişiklikleri, fire, stok, sapma, başlıca etkenler, kâr-zarar maliyet görünümü, önerilen aksiyonlar ve ay sonu kontrol listesi — ekranlar ve Excel ile aynı hesaplama motorundan.",
  // F&B cost statements and monthly stock: transfers shown net, as on the variance page
  "Opening + purchases − transfers out (net) − closing = actual food cost vs theoretical": "Açılış + alımlar − giden transferler (net) − kapanış = gerçekleşen yiyecek maliyeti ve teorik karşılaştırması",
  "Transfers Out (net)": "Giden transferler (net)",
  "Actual Cost (= Opening + Purchases − Transfers Out (net) − Closing)": "Gerçekleşen maliyet (= Açılış + Alımlar − Giden transferler (net) − Kapanış)",
  // department cost / monthly summary notes without the budget
  "Direct and allocated cost are shown separately (spec 146). Revenue: POS + minibar + rooms (PMS).": "Direkt ve dağıtılan maliyet ayrı gösterilir. Gelir: POS + minibar + odalar (PMS).",
  "Operating-expense categories have no theoretical cost. Expense rows are hotel-wide only.": "İşletme gideri kategorilerinin teorik maliyeti yoktur. Gider satırları yalnızca otel geneli içindir.",
  // room cost export headers (no "allocation" wording)
  "Maintenance Cost": "Bakım maliyeti",
  // review pass: room expense form
  "Item {n} has an amount but no name: enter its name or clear the amount.": "{n}. kalemde tutar var ama ad yok: adını girin ya da tutarı silin.",
};

/** Server messages added in the review pass (r2f). */
export const r2fMessages: Record<string, string> = {
  "This month was changed by someone else — reload and try again": "Bu ay başka biri tarafından değiştirildi — sayfayı yenileyip tekrar deneyin",
};
