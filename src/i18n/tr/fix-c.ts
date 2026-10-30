/** Turkish strings added in the audit remediation round, area fix-c (adjustment approvals, segregation of duties). Key = English source text. */
export const fixC: Record<string, string> = {
  // BIZ-03: manual stock adjustments above the hotel's approval value wait for approval
  "MANUAL ADJUSTMENT": "STOK DÜZELTMESİ",
  "Sent for approval. Estimated value {cost}. The stock changes when it is approved.": "Onaya gönderildi. Tahmini tutar {cost}. Stok, onaylandığında değişir.",
  "Adjustments worth {value} or more go to approval and are posted once someone else approves them.": "{value} ve üzerindeki düzeltmeler onaya gider; başka bir kişi onayladığında işlenir.",
  "Delete requests, high-value waste and adjustments, stock counts. You can never approve your own request.": "Silme talepleri, yüksek tutarlı fire ve düzeltmeler, stok sayımları. Kendi talebinizi onaylayamazsınız.",
  "This adjustment request has nothing to post": "Bu düzeltme talebinde işlenecek bir kayıt yok",
  "This adjustment request was already decided": "Bu düzeltme talebi zaten karara bağlanmış",
  "STOCK_ADJUSTMENT_REQUEST": "Stok düzeltmesi onay talebi",
  // BIZ-02: the creator of a purchase order, budget or recipe version cannot approve it
  "The person who created a record cannot approve it": "Bir kaydı oluşturan kişi aynı kaydı onaylayamaz",
  "Allow the creator to approve their own purchase orders, budgets and recipe versions": "Kaydı oluşturan kişi kendi siparişini, bütçesini ve reçete sürümünü onaylayabilsin",
  "Meant for small hotels with a single manager. When off, a second person has to approve. Every change of this setting is recorded in the audit trail.": "Tek yöneticisi olan küçük oteller içindir. Kapalıyken onayı ikinci bir kişi verir. Bu ayarın her değişikliği denetim izine yazılır.",
  "Creator may approve own records": "Oluşturan kendi kaydını onaylayabilir",
  "SELF_APPROVAL_ALLOWED": "Kendi kaydını onaylamaya izin verildi",
  "SELF_APPROVAL_BLOCKED": "Kendi kaydını onaylama kapatıldı",
  "Another person approves": "Onayı başka bir kişi verir",
};
