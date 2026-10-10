/** Turkish strings added in feedback round 2 (r2d). Key = English source text. */
export const r2d: Record<string, string> = {
  // §5 purchasing — goods receipts list
  "Lines (qty × unit price = net, VAT)": "Satırlar (miktar × birim fiyat = net, KDV)",
  "VAT": "KDV",
  "Extra costs": "Ek maliyetler",
  "Total (incl. VAT)": "Toplam (KDV dahil)",
  "Partly reversed": "Kısmen ters kayıt",
  "Draft": "Taslak",
  "Micros": "Micros",
  // §6 plans / trial
  "Full package (trial)": "Tam paket (deneme)",
  "Premium · open (trial)": "Premium · açık (deneme)",
  "Trial — every feature is open: e-mail orders are on, but no mail server is configured (SMTP_URL). Orders cannot be sent yet.":
    "Deneme süreci — tüm özellikler açık: e-posta ile sipariş açık, ancak e-posta sunucusu ayarlanmamış (SMTP_URL). Siparişler henüz gönderilemez.",
  "Trial — every feature is open: when the stock of an active rule reaches its reorder point the order is e-mailed to the supplier with the template below (checked every night and on “Check now”).":
    "Deneme süreci — tüm özellikler açık: aktif bir kuralın stoğu yeniden sipariş noktasına düştüğünde sipariş, aşağıdaki şablonla tedarikçiye e-postayla gönderilir (her gece ve “Şimdi kontrol et” ile kontrol edilir).",
  // §6 suppliers
  "Company name, address, e-mail and phone: automatic orders are e-mailed to this address.": "Firma adı, adres, e-posta ve telefon: otomatik siparişler bu adrese e-postayla gönderilir.",
  // §6 order e-mail template
  "Order e-mail template": "Sipariş e-postası şablonu",
  "Order e-mail template saved.": "Sipariş e-postası şablonu kaydedildi.",
  "Replace the order e-mail with the default template?": "Sipariş e-postası varsayılan şablonla değiştirilsin mi?",
  "The default template is back.": "Varsayılan şablona dönüldü.",
  "Edited": "Düzenlendi",
  "Default": "Varsayılan",
  "Subject": "Konu",
  "E-mail text": "E-posta metni",
  "Placeholders": "Yer tutucular",
  "{supplier} company name, {hotel} hotel name, {date} order date, {lines} the product / quantity / unit table (required).":
    "{supplier} firma adı, {hotel} otel adı, {date} sipariş tarihi, {lines} ürün / miktar / birim tablosu (zorunlu).",
  "Save template": "Şablonu kaydet",
  "Reset to default": "Varsayılana dön",
  "The e-mail must contain {lines} (the product table)": "E-posta {lines} (ürün tablosu) içermelidir",
};
