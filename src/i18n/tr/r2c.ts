/** Turkish strings added in feedback round 2 (r2c). Key = English source text. */
export const r2c: Record<string, string> = {
  // §8 recipes — dates, date filter, edit, delete
  "created or updated": "oluşturulma veya güncelleme",
  "Created or updated": "Oluşturulma veya güncelleme",
  "Created on": "Oluşturulma tarihi",
  "Updated on": "Güncelleme tarihi",
  "Delete the recipe {name}? It disappears from the recipe list, the sales matching and the pickers; its sales history is kept.":
    "{name} reçetesi silinsin mi? Reçete listesinden, satış eşleştirmesinden ve seçim listelerinden kalkar; satış geçmişi korunur.",
  "Saved as the recipe's new version and in force at once: cost and stock deduction use it from now on. The previous version stays in the version history.":
    "Reçetenin yeni sürümü olarak kaydedilir ve hemen geçerli olur: maliyet ve stok düşümü bundan sonra bu sürümü kullanır. Önceki sürüm sürüm geçmişinde kalır.",
  "Reason for the change (optional)": "Değişiklik nedeni (isteğe bağlı)",
  "Save changes": "Değişiklikleri kaydet",
  "Edit recipe": "Reçeteyi güncelle",
  "Edit recipe: {name}": "Reçeteyi güncelle: {name}",
  "Change the recipe and save: the new version is in force at once (no separate approval). Earlier versions stay in the history.":
    "Reçeteyi değiştirip kaydedin: yeni sürüm hemen geçerli olur (ayrıca onay gerekmez). Önceki sürümler geçmişte kalır.",
  "Initial version": "İlk sürüm",
  "Recipe updated": "Reçete güncellendi",
  // §8 recipes — "Reçete fiyatlarını güncelle" (FIFO)
  "Re-cost every recipe at today's ingredient costs (FIFO: the oldest batch in stock, else the last invoice price) and refresh their frozen costs?":
    "Tüm reçeteler bugünkü malzeme maliyetleriyle (FIFO: stoktaki en eski parti, stok yoksa son fatura fiyatı) yeniden hesaplansın ve kayıtlı maliyetleri güncellensin mi?",
  "Updating…": "Güncelleniyor…",
  "Update recipe prices": "Reçete fiyatlarını güncelle",
  "Recipe prices updated: {n} recipes, {changed} changed": "Reçete fiyatları güncellendi: {n} reçete, {changed} tanesinin maliyeti değişti",
  "Close": "Kapat",
  "Not updated:": "Güncellenemeyenler:",
  "Old cost / portion": "Eski maliyet / porsiyon",
  "New cost / portion": "Yeni maliyet / porsiyon",
  "per {unit}": "{unit} başına",
  // §7 products — "Ürünleri çek", account codes
  "The Micros automation is not set up (Imports → Automation)": "Micros otomasyonu kurulmamış (İçe aktarma → Otomasyon)",
  "A pull is already waiting for the automation.": "Bir çekme isteği zaten otomasyonu bekliyor.",
  "Requested: the automation fetches the new products from Micros within a few minutes.": "İstek alındı: otomasyon yeni ürünleri birkaç dakika içinde Micros'tan çeker.",
  "Pull products": "Ürünleri çek",
  "Waiting for the automation…": "Otomasyon bekleniyor…",
  "Last pulled: {when}": "Son çekim: {when}",
  "Never pulled from Micros": "Micros'tan henüz çekilmedi",
  "Purchase → stock → recipe units with explicit conversions. Costs come from the ledger (FIFO: the oldest batch in stock).":
    "Satın alma → stok → reçete birimleri, açık dönüşümlerle. Maliyetler stok hareketlerinden gelir (FIFO: stoktaki en eski parti).",
  "New product (manual)": "Yeni ürün (elle)",
  "Categories and account codes": "Kategoriler ve hesap planı kodları",
  "chart-of-accounts codes (e.g. 150.01) are optional": "hesap planı kodları (ör. 150.01) isteğe bağlıdır",
  "Account code": "Hesap kodu",
  "Account code of {name}": "{name} hesap kodu",
  "e.g. 150.01": "ör. 150.01",
  "Saved": "Kaydedildi",
};

/** Server messages (r2c), merged into TR_MESSAGES. {0}, {1} … = the dynamic parts, in order. */
export const r2cMessages: Record<string, string> = {
  "{0} is used as a sub-recipe by: {1}": "{0} şu reçetelerde alt reçete olarak kullanılıyor: {1}",
  "Use digits, letters, dots or dashes (e.g. 150.01)": "Rakam, harf, nokta veya tire kullanın (ör. 150.01)",
  "Pack size must be positive": "Ambalaj içeriği pozitif olmalıdır",
  "VAT % must be between 0 and 100": "KDV % 0 ile 100 arasında olmalıdır",
};
