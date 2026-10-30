/** Turkish strings added in the audit remediation round, area fix-c (adjustment approvals, segregation of duties). Key = English source text. */
export const fixC: Record<string, string> = {
  // BIZ-03: manual stock adjustments above the hotel's approval value wait for approval
  "MANUAL ADJUSTMENT": "STOK DÜZELTMESİ",
  "Sent for approval. Estimated value {cost}. The stock changes when it is approved.": "Onaya gönderildi. Tahmini tutar {cost}. Stok, onaylandığında değişir.",
  "Adjustments worth {value} or more go to approval and are posted once someone else approves them.": "{value} ve üzerindeki düzeltmeler onaya gider; başka bir kişi onayladığında işlenir.",
  "Delete requests, high-value waste and adjustments, stock counts. You can never approve your own request.": "Silme talepleri, yüksek tutarlı fire ve düzeltmeler, stok sayımları. Kendi talebinizi onaylayamazsınız.",
  "This adjustment request has nothing to post": "Bu düzeltme talebinde işlenecek bir kayıt yok",
  "STOCK_ADJUSTMENT_REQUEST": "Stok düzeltmesi onay talebi",
};
