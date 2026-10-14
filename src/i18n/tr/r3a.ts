/** Turkish strings added in feedback round 3, area r3a. Key = English source text. */
export const r3a: Record<string, string> = {
  // dashboard: the footer note moved into the page info icon
  "All figures come from the shared cost engine and reconcile with the Theoretical vs Actual report.": "Tüm rakamlar ortak maliyet motorundan gelir ve Teorik ve Gerçekleşen raporuyla tutarlıdır.",
  // cost periods: page info (feedback r3 §11)
  "Each month is a cost period. While it is open, stock movements, goods receipts, waste, expenses, sales and breakfast sessions can be dated into it.": "Her ay bir maliyet dönemidir. Dönem açıkken o aya tarihli stok hareketi, mal kabul, fire, gider, satış ve kahvaltı kaydı girilebilir.",
  "At month end, work through the checklist below and close the month: nothing more can be posted into it, and the month's results are saved as a fixed snapshot (Reports → archive), so the reported figures can no longer change.": "Ay sonunda aşağıdaki kontrol listesini tamamlayıp ayı kapatırsınız: kapanan aya artık kayıt girilemez ve ayın sonuçları sabit bir kopya olarak saklanır (Raporlar → arşiv); böylece raporlanan rakamlar sonradan değişemez.",
  "Soft close: only the administrator, cost controller and accounting manager can still post (final corrections). A closed month can be reopened only with a written reason; the reopening is logged in the audit trail.": "Ön kapanış: o aya yalnızca yönetici, maliyet kontrol ve muhasebe müdürü son düzeltmeleri girebilir. Kapalı bir ay ancak yazılı gerekçeyle yeniden açılabilir; bu işlem denetim kaydına yazılır.",
  "Colours: red = a required step is missing (closing then needs an override reason), yellow = something to check, green = complete.": "Renkler: kırmızı = zorunlu bir adım eksik (kapatmak için gerekçe gerekir), sarı = kontrol edilmesi gereken eksik, yeşil = tamam.",
};

/** Server messages (DomainError, validation) of area r3a. Key = the English message; {0}, {1} … = dynamic parts. */
export const r3aMessages: Record<string, string> = {
};
