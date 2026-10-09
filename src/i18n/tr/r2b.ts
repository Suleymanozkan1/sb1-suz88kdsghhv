/** Turkish strings added in feedback round 2 (r2b). Key = English source text. */
export const r2b: Record<string, string> = {
  // ── theoretical vs actual (§3) ──
  "Transfers out are shown net: issues from the main store to the other stores cancel out for the whole hotel; for a department, what it received from other stores is deducted.":
    "Giden transferler net gösterilir: ana depodan diğer depolara yapılan dağıtımlar otel genelinde birbirini götürür; bir departman seçildiğinde diğer depolardan aldığı mallar düşülür.",

  // ── stock counts (§4) ──
  "System vs physical. Every count is sent for approval; stock changes only when an authorised manager approves it.": "Sistem ve fiziksel miktar. Her sayım onaya gönderilir; stok yalnızca yetkili yönetici onayladığında değişir.",
  "Show counts of": "Sayımları gösterilen depo",
  "Send for approval": "Onaya gönder",
  "Sent for approval. Stock changes when an authorised manager approves the count.": "Onaya gönderildi. Stok, yetkili yönetici sayımı onayladığında işlenir.",
  "AWAITING APPROVAL": "ONAY BEKLİYOR",
  "Rejected by the approver - recount and send again: {note}": "Onaylayan reddetti, yeniden sayıp tekrar gönderin: {note}",
  "Do you want to delete this count?": "Bu sayımı silmek istiyor musunuz?",
  "Delete count": "Sayımı sil",
  "Delete count {number}": "{number} sayımını sil",
  "Count deleted": "Sayım silindi",

  // ── approvals ──
  "Delete requests, high-value waste, stock counts. You can never approve your own request.": "Silme talepleri, yüksek tutarlı fireler, stok sayımları. Kendi talebinizi asla onaylayamazsınız.",
  "STOCK COUNT": "STOK SAYIMI",
  "{n} products with a difference": "Farkı olan {n} ürün",

  // ── admin: who approves which warehouse's counts ──
  "Count approvers": "Sayım onaylayıcıları",
  "Which roles may approve the stock counts of each warehouse. No role ticked: every role with the approval right. Nobody can approve their own count.":
    "Her deponun sayımlarını hangi rollerin onaylayabileceği. Hiçbir rol seçilmezse onay yetkisi olan tüm roller onaylayabilir. Kimse kendi sayımını onaylayamaz.",
  "Count approvers saved": "Sayım onaylayıcıları kaydedildi",
  "Any role with the approval right": "Onay yetkisi olan tüm roller",
};

/** Server messages (DomainError) of round 2 (r2b), translated by the API error handler. */
export const r2bMessages: Record<string, string> = {
  "Your role may not approve the counts of this warehouse": "Rolünüz bu deponun sayımlarını onaylayamaz",
  "A posted count cannot be deleted - correct it with a new count": "İşlenmiş sayım silinemez; yeni bir sayımla düzeltin",
  "Missing permission: count:delete": "Yetki eksik: sayım silme",
};
