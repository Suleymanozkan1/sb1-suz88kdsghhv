/** Turkish strings added in feedback round 3, area r3e. Key = English source text. */
export const r3e: Record<string, string> = {
  // recipe detail: dates and versions (§3)
  "In force": "Yürürlükte",
  "Old version": "Eski sürüm",
  "Awaiting approval": "Onay bekliyor",
  Rejected: "Reddedildi",
  "Created at": "Oluşturuldu",
  "Last updated": "Son güncelleme",
  "Version in force": "Yürürlükteki sürüm",
  "Portion cost when saved": "Kaydedildiğindeki porsiyon maliyeti",
  "Reason for change": "Değişiklik nedeni",
  "Showing version {version} at today's ingredient costs.": "Sürüm {version}, malzemelerin bugünkü maliyetleriyle gösteriliyor.",
  "The cost of this recipe is incomplete:": "Bu reçetenin maliyeti eksik:",
  "The cost of this recipe cannot be calculated: {reason}": "Bu reçetenin maliyeti hesaplanamıyor: {reason}",
  "no cost yet: enter a purchase or a price for this product": "henüz maliyeti yok: bu ürün için bir alış veya fiyat girin",
  "the product is inactive: activate it again or replace it in the recipe": "ürün pasif: ürünü yeniden aktif edin ya da reçetede başka bir ürünle değiştirin",
  "the product no longer exists: replace it in the recipe": "ürün artık yok: reçetede başka bir ürünle değiştirin",
  "the sub-recipe has no version in force": "alt reçetenin yürürlükte bir sürümü yok",
  "the sub-recipe's cost is incomplete": "alt reçetenin maliyeti eksik",
  "Initial standard recipe": "İlk standart reçete",

  // cost review (§12)
  "Cost review": "Maliyet değerlendirmesi",
  "Top cost increases": "En çok maliyet artışı",
  "Top waste items": "En çok fire veren ürünler",
  "Top variance items (unexplained usage)": "En yüksek sapmalı ürünler (açıklanamayan kullanım)",
  "Unexplained usage": "Açıklanamayan kullanım",
  "No price increases in this period": "Bu dönemde fiyat artışı yok",
  "No waste in this period": "Bu dönemde fire yok",
  "No recipe version approved in this period": "Bu dönemde reçete değişikliği yok",
  "first {n} of {total}": "{total} kaydın ilk {n} tanesi",
  "See all ({n})": "Tümünü gör ({n})",
  "Back to the summary": "Özete dön",
  Updated: "Güncellendi",
  "{from} – {to}: the largest cost increases, waste, unexplained usage, critical stock and recipe changes. Each list shows the first 5; \"See all\" opens the full list.":
    "{from} – {to}: en büyük maliyet artışları, fire, açıklanamayan kullanım, kritik stok ve reçete değişiklikleri. Her listede ilk 5 kayıt görünür; \"Tümünü gör\" tam listeyi açar. Üstteki kartlara tıklayınca ilgili liste açılır.",

  // control calendar (§13)
  "The month's recurring controls, week by week (week 1 = days 1–7, week 2 = days 8–14 …). System evidence is shown next to each control but never completes it: the owner marks it done, and a completed control stays in its week with the completion date. Each week can be printed as a checklist (PDF).":
    "Ayın tekrarlayan kontrolleri, hafta hafta (1. hafta = ayın 1–7'si, 2. hafta = 8–14'ü …). Sistemdeki kanıt her kontrolün yanında gösterilir ama kontrolü kendiliğinden tamamlamaz: sorumlu \"Tamamlandı olarak işaretle\" ile kapatır; tamamlanan kontrol, tamamlanma tarihiyle haftasında kalır. Her hafta, elle işaretlemek için kontrol listesi (PDF) olarak yazdırılabilir.",
  Done: "Tamamlanan",
  "Open (today and later)": "Açık (bugün ve sonrası)",
  "Showing: {what}": "Gösterilen: {what}",
  "Show all": "Tümünü göster",
  "Week {n}": "{n}. hafta",
  "Checklist (PDF)": "Kontrol listesi (PDF)",
  "Completed on": "Tamamlandı",
  "No controls with this status this week.": "Bu hafta bu durumda kontrol yok.",
  "No controls are due this week.": "Bu hafta yapılacak kontrol yok.",
  "Week {n} control checklist": "{n}. hafta kontrol listesi",
  "Status / note": "Durum / not",
  "Checked by": "Kontrol eden",
  "Sign off": "Tamamla",
};

/** Server messages (DomainError, validation) of area r3e. Key = the English message; {0}, {1} … = dynamic parts. */
export const r3eMessages: Record<string, string> = {
  "The end date must not be before the start date": "Bitiş tarihi başlangıç tarihinden önce olamaz",
  "month (YYYY-MM) and week (1-5) are required": "Ay (YYYY-AA) ve hafta (1-5) gerekli",
};
