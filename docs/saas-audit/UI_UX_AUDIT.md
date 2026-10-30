# Arayüz, Kullanıcı Deneyimi ve Erişilebilirlik Denetimi (UI_UX_AUDIT)

## Kapsam ve yöntem

**Ortam:** yerel üretim derlemesi (:3300), demo veritabanı.

**Kullanıcılar:** her biri için bir kez giriş yapıldı ve oturum yeniden kullanıldı.
- Şirket yöneticisi: 41 sayfa
- Şef: 16 sayfa
- Kahvaltı şefi: 7 sayfa
- Platform yöneticisi
- Anonim sayfalar

**Ölçüm:**
- Her sayfa 1280×800 masaüstü ve 390×844 mobil boyutlarda açıldı; toplam yaklaşık 140 sayfa yüklemesi ve ekran görüntüsü.
- axe-core ile WCAG 2.1 A/AA taraması yapıldı.

Veri değiştiren form gönderilmedi.

## 1. Özet

**Erişilebilirlik (axe):** 64 oturumlu sayfa yüklemesinin hiçbirinde ciddi veya kritik ihlal yok. Login, davet ve platform sayfalarında da yok. Önerilen kurallar açıldığında yalnızca küçük/orta maddeler çıkıyor; kontrast kontrolleri "incelenmeli" diyor ama kesin bir hata yok.

axe'ın göremediği gerçek erişilebilirlik sorunları var:
- Diyaloglarda odak yönetimi yok.
- Mobil menü açıkken aynı kimlik (ID) iki kez kullanılıyor.
- "İçeriğe atla" bağlantısı yok.
- Tablo bölgeleri İngilizce bir etiketle duyuruluyor.

**Mobil (390 px):** şirket yöneticisinin 41 sayfasından 8'i yatay kayıyor. Gösterge paneli her rolde bunlardan biri. Sebep, ortak bileşenlerdeki iki düzen hatası.

**Türkçe dil kalitesi:**
- 188 sözlük anahtarı (çapraz inceleme sayımı; ilk sayım 218) farklı dosyalarda çelişen çevirilere sahip; hangisinin geçerli olacağını yükleme sırası belirliyor.
- Tarayıcı sekme başlıkları her sayfada İngilizce.
- Bazı İngilizce veya iç kod metinleri ekrana sızıyor.

**Menü ve yetki:** bazı menü maddeleri şef ve kahvaltı rollerini "yetkiniz yok" sayfasına götürüyor.

## 2. Bulgular

### FE-01 · ORTA · Gösterge paneli, Değerlendirme, Teorik ve Gerçekleşen, Bütçe ve Tahmin telefonda yatay kayıyor
- **Ölçüm (390×844), taşan genişlik:**

  | Sayfa | Taşma |
  |---|---|
  | `/` | +236 px (yönetici), +314 px (şef), +315 px (kahvaltı) |
  | `/review` | +278 px |
  | `/variance` | +48 px |
  | `/budget` | +939 px |
  | `/forecast` | +1202 px |

- **Kök neden (kodla doğrulandı):**
  - Kart ızgaraları (ör. `grid gap-4 lg:grid-cols-3`: `src/app/(app)/page.tsx:88,160`, `budget/page.tsx:43,58`, `review/page.tsx:95`) küçük ekranda tek sütun olarak tanımlanmamış.
  - `Card` bileşeninde (`src/components/ui.tsx`) `min-w-0` yok. Bu yüzden sütun, içindeki tablonun genişliğine kadar büyüyor ve tablonun kendi kaydırma alanı hiç devreye girmiyor.
- **Etki:** Telefondan gösterge paneline bakan şef ve müdürler sağa sola kayan ve kesilen bir sayfa görüyor. Bu, her rolün açtığı ilk ekran.
- **Öneri:** `Card`'ın `<section>` öğesine `min-w-0` eklemek ya da bu ızgaraları `grid-cols-1` ile başlatmak. Ardından mevcut mobil e2e testi bu sayfalarla genişletilmeli.
- **Zorluk:** Küçük.

### FE-02 · DÜŞÜK · Ekran okuyucuya özel tablo başlıkları kaydırma alanından taşıyor (/comps mobilde +525 px)
- `comps/page.tsx:155` içindeki `sr-only` "İşlemler" başlığı `position:absolute`. `Table` sarmalayıcısı `relative` olmadığı için sayfa 915 px'e genişliyor.
- `/purchasing/orders` sekmesinde de 8 px'lik bir taşma var.
- **Öneri:** `Table` sarmalayıcısına `relative` eklemek.
- **Zorluk:** Küçük.

### FE-03 · ORTA · Mobil menü ve eğitim videosu pencerelerinde odak yönetimi yok; aynı kimlik iki kez kullanılıyor
- **Test ile doğrulandı:**
  - Pencere açıldığında odak tetikleyici düğmede kalıyor.
  - Video penceresinde üç kez Tab tuşuna basınca arka sayfadaki bir kutuya geçiliyor.
  - Menü çekmecesi Escape ile kapanmıyor ve erişilebilir bir adı yok.
  - Çekmece açıkken `#hotel` ve `#lang` kimlikleri DOM'da iki kez var; etiketler yanlış kutuya bağlanıyor.
- **Etki:** Klavye ve ekran okuyucu kullanıcıları yerlerini kaybediyor (WCAG 2.4.3 / 2.1.2 riski).
- **Öneri:**
  - Açılışta odak pencereye taşınmalı, Tab pencere içinde tutulmalı, Escape ile kapanmalı ve odak tetikleyiciye geri dönmeli. Ya da yerel `<dialog>.showModal()` kullanılmalı.
  - Çekmeceye `aria-label` verilmeli.
  - Kenar menüsü tek kez çizilmeli ya da çekmecedeki kopyaya farklı kimlik öneki verilmeli.
- **Zorluk:** Küçük–orta.

### FE-04 · DÜŞÜK · "Ana içeriğe geç" bağlantısı yok
- Şirket yöneticisi için Tab sırası şöyle: otel seçimi, 34 menü bağlantısı, ancak sonra sayfa içeriği (WCAG 2.4.1).
- **Öneri:** `<aside>` öğesinden önce, `<main>`'e götüren gizli bir "Ana içeriğe geç" bağlantısı.
- **Zorluk:** Küçük.

### FE-05 · DÜŞÜK · Tüm tablo bölgeleri İngilizce "Scrollable table" olarak duyuruluyor
- `ui.tsx` `Table` bileşeni varsayılan etiketi `t()` ile çevirmiyor; çeviri dosyada mevcut ama kullanılmıyor.
- 89 tablo kullanımının 76'sında etiket verilmemiş.
- axe, /budget sayfasında `landmark-unique` uyarısı veriyor.
- **Öneri:** Varsayılan etiket kart başlığı olmalı ve çevrilmeli.
- **Zorluk:** Küçük.

### FE-06 · ORTA · Kritik gerekçe ve onaylar tarayıcının yerel `prompt` / `confirm` pencereleriyle alınıyor
- **Kanıt:** 16 dosyada 20 kullanım. Örnekler:
  - Onay ret gerekçesi (`approvals/decide.tsx:17`)
  - Dönem kapatma, zorla kapatma ve yeniden açma (`periods/period-actions.tsx:24,30,41`)
  - Stok hareketi silme talebi, sayım, bütçe, dağıtım, bütünlük yeniden kurma, ikram silme
  - Platformda "Ödendi işaretle" (havale referansı), "İptal", "Bildirim kes" (ay sayısı), "Deneme uzat"
  - Kiracı askıya alma (`platform/console.tsx:34`)
- **Sorunlar:**
  - Giriş yerinde doğrulanamıyor; boş gerekçe işlemi sessizce iptal ediyor.
  - Ay sayısı serbest metin olarak giriliyor.
  - Tamam/İptal düğmeleri tarayıcının dilinde görünüyor.
  - Bazı gömülü tarayıcılar bu pencereleri engelliyor.
- **Etki:** Fatura ödeme referansı, ay sayısı veya kapanış gerekçesi gibi parasal ve kontrol amaçlı girişlerde yazım hatası kolaylaşıyor.
- **Öneri:** Zorunlu alan doğrulaması ve sayısal giriş içeren ortak bir `ConfirmDialog` / `ReasonDialog` bileşeni.
- **Zorluk:** Orta.

### FE-07 · ORTA · Platform konsolu, açılır listede seçim değişir değişmez kiracının paketini değiştiriyor
- **Kanıt:**
  - `src/app/platform/console.tsx:85`: açılır liste değişince `setPlan` doğrudan PATCH isteği gönderiyor. Onay, gerekçe ve başarı mesajı yok.
  - E-posta serbest bırakma formu da (kullanıcıyı pasifleştiriyor) onay sormuyor.
- **Etki:** Tek bir yanlış tıklama ya da odaklı listede ok tuşu, ödeme yapan bir müşterinin paketini sessizce değiştirir. Windows Chrome'da her ok tuşu bir değişiklik olayı tetikliyor. Müşterinin kullanabildiği modüller ve faturası değişir.
- **Öneri:** Açık bir "Paketi değiştir" düğmesi, onay adımı, denetim izine yazılan gerekçe ve başarı mesajı.
- **Zorluk:** Küçük.

### FE-08 · ORTA · Doğrulama hataları teknik alan yollarını gösteriyor
- **Kanıt:**
  - Boş giriş formu gönderilince şu mesaj çıkıyor: "Geçersiz giriş: email Geçersiz e-posta; password En az 1 karakter olmalıdır".
  - API, `lines.0.quantity` gibi yollar döndürüyor ve `src/lib/client.ts` bunları mesaja ekliyor.
  - Hatalar alanlara `aria-invalid` / `aria-describedby` ile bağlanmıyor; kod tabanında yalnızca 2 kullanım var.
- **Etki:** Personel Türkçe mesajların içinde İngilizce, programcı tarzı alan adları görüyor. Çok satırlı formlarda (fire, mal kabul) hangi satırın hatalı olduğu belli olmuyor.
- **Öneri:** Hata yolu alanın Türkçe etiketine çevrilmeli ya da hata alanın altında gösterilmeli; alan `aria-invalid` ile işaretlenmeli.
- **Zorluk:** Orta.

### FE-09 · DÜŞÜK · Sayfa geçişlerinde yükleniyor göstergesi yok
- `src/app` altında hiç `loading.tsx` yok.
- **Ölçülen sunucu süreleri:** çoğunlukla 0,6–1,3 sn. Stok hareketleri 2,5 sn; Tasarruf ve Onaylar mobilde 4,8 ve 3,5 sn'ye kadar çıkıyor.
- **Etki:** Tıkladıktan sonra hiçbir şey olmuyor gibi görünüyor ve kullanıcı tekrar tıklıyor.
- **Öneri:** `(app)/loading.tsx` iskeleti ya da üstte bir ilerleme çubuğu.
- **Zorluk:** Küçük.

### FE-10 · DÜŞÜK · /variance sayfasında bir kez React hidrasyon hatası (#418)
- Bir kez görüldü, iki yeniden yüklemede tekrarlanmadı.
- Olası neden (varsayım): saate veya dile bağlı bir metin sunucuda ve tarayıcıda farklı üretiliyor.

### UX-01 · DÜŞÜK · 188 çeviri anahtarı çelişkili; son yüklenen dosya sessizce kazanıyor

> Çapraz incelemede ORTA'dan DÜŞÜK'e indirildi ve ARCH-11 ile birleştirildi. Yeniden sayım: 3.160 anahtar; 188 anahtarda 215 üzerine yazma; 56'sı yalnızca harf büyüklüğünde ayrışıyor.
- **Kanıt:** `src/i18n/tr/index.ts` 28 dosyayı birleştiriyor; yaklaşık 3.600 anahtarın 218'i farklı dosyalarda farklı Türkçe değere sahip. Örnekler:

  | İngilizce anahtar | Çelişen çeviriler |
  |---|---|
  | "Change" | "Değiştir" (fiil) ↔ "Değişim" (isim); düğmelerde isim görünüyor |
  | "Post" | "İşle" ↔ "Kaydet" |
  | "Rooms" | "Oda sayısı" ↔ "Odalar" |
  | "Variance" | "Fark" ↔ "Sapma" |
  | "BUFFET" | "BÜFE" ↔ "KAHVALTI" |
  | "Administration" | "Yönetim" ↔ "Genel yönetim" |
  | "On-house & hospitality" | "İkram ve misafirperverlik" ↔ "Ödenmez ve İkram" |
  | "Version" | "Sürüm" ↔ "Versiyon" |
  | "Type" | "Tür" ↔ "Tip" |

  Ayrıca "kuver" ile "kişi" arasında da tutarsızlık var.
- **Etki:** Aynı kavram farklı ekranlarda, Excel ve PDF çıktılarında farklı adlarla görünüyor.
- **Öneri:**
  - Çelişkili değer bulunduğunda başarısız olan bir birim testi.
  - Bir terim sözlüğü: Fark mı Sapma mı, Büfe mi Kahvaltı mı, Kuver.
  - Gerçekten farklı olması gereken yerlerde bağlama özel anahtarlar.
- **Zorluk:** Orta.

### UX-02 · ORTA · Türkçe arayüzde İngilizce veya iç kod metinleri görünüyor
- **Kanıt:**
  - Tarayıcı sekme başlıkları tüm uygulama sayfalarında İngilizce ("Dashboard · HotelCost", "Theoretical vs Actual", "Subscription" vb.). Sayfaların `metadata.title` değerleri çevrilmiyor; yalnızca /login çevrilmiş.
  - /budget: "Hotel level" metni sunucudan çevrilmeden geliyor (`planning.ts:201`).
  - /audit: önceki/sonraki sütunları iç kimlikler ve kodlar içeren ham JSON gösteriyor (`LABOR_COST_PCT`, `RETURNED_TO_KITCHEN` vb.).
  - /savings: "(override via the API)" metni ve `LABOR_COST_PCT` kodu görünüyor.
  - Reçete türü seçeneği "RESTORAN" olarak büyük harfle, fire türü seçenekleri küçük harfle ("bozulmuş") yazılmış.
- **Etki:** Türk otel personeline ve denetçilere yarım kalmış bir ürün izlenimi veriyor. Denetim izi bir geliştirici olmadan okunamıyor.
- **Öneri:**
  - Başlıklar `generateMetadata` ile çevrilmeli.
  - Sunucu etiketleri çevrilmeli.
  - Denetim farkları "alan: eski → yeni" biçiminde, Türkçe alan adlarıyla gösterilmeli.
- **Zorluk:** Küçük–orta.

### UX-03 · ORTA · Rol menüleri çıkmaz sokağa götürüyor; kahvaltı şefinin menüsü role göre ayarlanmamış
- **Kanıt:**
  - "İçe aktarma" (`report:view` yetkisiyle) şef, kahvaltı ve pastane rollerinde görünüyor. Sayfa ise yalnızca kırmızı bir "İçe aktarma yetkiniz yok." uyarısı gösteriyor.
  - "Onaylar" menüsü tüm operasyon rollerine görünüyor. Bekleyen rozeti, kullanıcının karar veremediği talepler dahil otelin tüm bekleyen onaylarını sayıyor.
  - Kahvaltı şefi ve şefin yetkileri aynı (`permissions.ts:106-107`). Kahvaltı şefi Menü Mühendisliği, Raporlar ve Veri Kalitesi dahil 17 maddelik menünün tamamını görüyor.
  - Başlangıç rehberindeki bağlantılar görüntüleme yetkisine göre açılıyor; hedef sayfa ise işlem yetkisi istiyor. Örnek: "Ürünlerinizi ekleyin" `product:view` ile görünüyor ama `product:manage` isteyen /imports sayfasına gidiyor.
- **Etki:** Operasyon personeli "yetkiniz yok" duvarına çarpıyor ve işlem yapamadığı bir rozet görüyor. Destek çağrıları artıyor, güven azalıyor.
- **Öneri:**
  - Menü maddeleri, sayfanın gerçekten istediği yetkiye göre gösterilmeli.
  - Rozet yalnızca kullanıcının karar verebildiği onayları saymalı.
  - Kahvaltı şefine daraltılmış bir rol şablonu verilmeli.
  - Başlangıç rehberinde işlem yetkileri kullanılmalı.
- **Zorluk:** Küçük–orta.

### UX-04 · DÜŞÜK · Sayı, yüzde, tarih ve para biçimleri tutarsız
- **Yüzde:** üç farklı biçim var: "27,6%" (`pct()`), "25 %" (ikram kartları), "%31" (karşılama sayfası; Türkçe kullanım).
- **Sayı:** başarı mesajlarında `toFixed(2)` kullanıldığı için "1234.50" görünüyor: `sales/importer.tsx:39`, `buffet/[id]/session-actions.tsx:30`, `inventory/movement-form.tsx:33`, `purchasing/receipt-form.tsx:40,57`.
- **Platform sayfası:**
  - Fiyatlar "2500.00" olarak görünüyor.
  - KDV kesir olarak isteniyor ("%20 için 0.20").
  - Kiracı oluşturma tarihi ISO biçiminde ("2026-10-30"); uygulamanın geri kalanı "30.10.2026" kullanıyor.
- **Sayı ayrıştırıcı:** `decimalText()` yalnızca ilk virgülü değiştiriyor; "1.250,50" geçersiz sayı (NaN) oluyor.
- **Öneri:**
  - Her yerde `money()` / `qty()` kullanılmalı.
  - Tek bir yüzde biçimi seçilmeli (Türkçe "%27,6").
  - KDV yüzde olarak alınmalı.
  - Sayı ayrıştırıcı binlik ayırıcıyı tanımalı.

### UX-05 · ORTA · Denetim izi yalnızca son 200 kaydı gösteriyor; süzgeç ve sayfalama yok
- **Kanıt:** `audit-trail.ts:86` `take: 200`. Sayfada tarih, kullanıcı veya işlem süzgeci yok; farklar ham JSON olarak gösteriliyor.
- **Etki:** Bir denetçi veya maliyet kontrolörü geçen ayki bir değişikliği arayüzden bulamıyor. Demoda 200 kayıt, veri yükleme etkinliğinin yalnızca birkaç dakikasını kapsıyor.
- **Öneri:** Ortak FilterBar (tarih, kullanıcı, işlem, kayıt türü), sayfalama ve okunabilir fark gösterimi.
- **Zorluk:** Orta.

### UX-06 · DÜŞÜK · Menü adları sayfa başlıklarıyla uyuşmuyor; büyük harf kullanımı karışık

| Menü adı | Sayfa başlığı (H1) |
|---|---|
| Stok sayımları | Fiziki Stok Sayımları |
| Satın alma | Satın Alma ve Mal Kabul |
| Ürünler | Ürün Kartları |
| Fire | Fire / Zayiat |
| Raporlar ve paket | Raporlar |
| Excel raporu | Excel Tam Maliyet Raporu (.xlsm) |

- Platform sayfası "kiracı" için üç farklı kelime kullanıyor: Müşteri, Kiracı, Şirket.
- **Öneri:** Terim sözlüğü ve isimlendirme kuralı: menü adı H1 ile aynı olmalı ya da onun başı olmalı; tek bir büyük harf düzeni kullanılmalı.

### UX-07 · DÜŞÜK · Devre dışı düğmeler nedenini söylemiyor; zorunlu alanlar işaretli değil
- **Fire formu:**
  - "Fire kaydet" düğmesi form geçerli olana kadar devre dışı; bu yüzden doğrulama mesajına hiç ulaşılamıyor.
  - Form bir `<form>` değil, `<div>`; Enter tuşu çalışmıyor.
- **Yeni reçete:** "Taslağı kaydet" düğmesi ad boşken devre dışı; oysa yanındaki yardım metni eksik taslağın kaydedilebileceğini söylüyor.
- **Zorunlu alanlar:** hiçbir formda yıldız veya "zorunlu" işareti yok.
- **Kesilen metinler:** 1280 px'te reçete malzeme türü seçimi ve arama metni kesiliyor.
- **Öneri:** Düğmeler etkin kalıp satır içi hata göstermeli ya da neden devre dışı olduğunu açıklamalı. Zorunlu alanlar işaretlenmeli ve `<form>` kullanılmalı.

### UX-08 · DÜŞÜK · Eğitim videoları: ses yok, yalnızca Türkçe gömülü altyazı, bazı sayfalar eksik
- 30 MP4 dosyası, toplam 55 MB. Ses kanalı yok; altyazılar görüntüye gömülü ve yalnızca Türkçe.
- Dağıtım, bütçe, tahmin ve faturalama sayfalarının videosu yok.
- Bilgi ikonu açıklaması ise iyi yapılmış: klavye, Escape, dokunma ve `aria-describedby` çalışıyor.
- **Öneri:**
  - Gömülü metin yerine WebVTT altyazı (TR ve EN).
  - Eksik videolar kaydedilmeli.
  - Videolar CDN'den sunulabilir.

### UX-09 · BİLGİ · Gösterge panelindeki sapma rengi yanıltıcı olabilir

> **Çapraz inceleme:** BIZ-15 ile birleştirildi.
- "Sapma −₺173.472" (gerçekleşen maliyet teoriğin yaklaşık %36 altında) yeşil, yani "iyi" olarak gösteriliyor.
- Açıklama listesinde pozitif tutarlar negatif yüzdelerle eşleşiyor.
- **Varsayım:** Büyük negatif sapma genellikle başarıyı değil, eksik sayım veya eksik mal kabulü işaret eder.
- **Öneri:** Renk, sapmanın mutlak büyüklüğüne göre belirlenmeli; işaretler tutarlı olmalı.
- Demo verisindeki %46 açıklanamayan sapma için ARCHITECTURE_AUDIT BIZ-15'e de bakın.

## 3. Kayıt ve faturalama ekranları (PR #22)

**Başlangıç kartı** (yalnızca kodla incelendi; demoda tüm adımlar tamamlanmış olduğu için görünmüyor):
- **İyi yanlar:** adımlar gerçek veriden hesaplanıyor, etiketli bir ilerleme çubuğu var, tamamlanınca gizleniyor.
- **Sorunlar:**
  - Bağlantı yetkileri hatalı (UX-03).
  - Kart yalnızca gösterge panelinde görünüyor.
  - Kart kapatılamıyor.

**Kiracı /billing:** demo şirket için yalnızca "tüm özellikler açık" boş durumu görünüyor. Kodda:
- Etiketler, `maxLength` ve e-posta türü var.
- IBAN dörtlü gruplanıyor.
- "Ödeme bildirimleri vergi faturası değildir" açıkça yazıyor.

**Platform konsolu:** 390 ve 1280 px'te çalışıyor, 0 axe ihlali. Sorunlar FE-06, FE-07 ve UX-04'te. "Askıya al" düğmesi her satırda kırmızı olarak duruyor.

**Paket kapısı:** kilitli modüller menüde kilit ikonuyla gösteriliyor ve hangi pakette olduğu açıklanıyor. Anlaşılır.

## 4. Güçlü yönler
- **Erişilebilirlik:** hiçbir sayfada ciddi veya kritik ihlal yok; e2e testlerinde axe kontrolü zaten var.
- **Tutarlı bileşen seti:**
  - 45 sayfada `PageHeader`, 51 sayfada `Empty`.
  - 127 `Button` kullanımına karşı yalnızca 11 ham `<button>`.
  - Sabit kodlanmış renk yok.
  - Tek bir ortak FilterBar (paylaşılabilir adresli GET formu).
  - Dışa aktarma düğmeleri ekrandaki süzgeçleri taşıyor.
- **Tablolar ve kartlar:** tablolar klavyeyle kaydırılabiliyor; başlıklar `scope="col"`. Tıklanabilir kartlar rakamın arkasındaki ayrıntıyı açıyor.
- **Hata ekranı:** menüyü kullanılabilir bırakıyor ve bir destek referansı gösteriyor.
- **Türkçe ve tarih kuralları:** İ/ı kurallarına uyan başlık biçimlendirme; otelin saat dilimine ve iş gününe göre tarih varsayılanları.
- **Mobil:** 41 sayfanın 33'ü 390 px'te sorunsuz. Fire, sayım ve kahvaltı sayımı giriş ekranları telefonda iyi çalışıyor.
- **Kilitli modüller:** gizlenmiyor, hangi pakette olduğu açıklanıyor. Abonelik bandı yalnızca gerektiğinde görünüyor.

## 5. Sayfa tablosu (özet)

"Mobil sorunsuz" = 390×844'te yatay taşma yok.

| Sayfa | Mobil sorunsuz | axe ciddi/kritik | Not |
|---|---|---|---|
| / (yönetici, şef, kahvaltı) | **Hayır** | 0 | FE-01, UX-09 |
| /variance | **Hayır** (+48 px) | 0 | FE-01, FE-10 |
| /review | **Hayır** (+278 px) | 0 | FE-01 |
| /budget | **Hayır** (+939 px) | 0 | FE-01, "Hotel level" |
| /forecast | **Hayır** (+1202 px) | 0 | FE-01 |
| /comps | **Hayır** (+525 px) | 0 | FE-02, "25 %" |
| /purchasing/orders | **Hayır** (+8 px) | 0 | sekme satırı |
| /inventory/ledger | evet | 0 | 2,5 sn yükleme |
| /recipes/new | evet | 0 | UX-07 |
| /savings | evet | 0 | İngilizce metin, iç kodlar |
| /audit | evet | 0 | UX-05, ham JSON |
| /approvals, /periods | evet | 0 | FE-06 |
| /imports (şef, kahvaltı) | evet | 0 | çıkmaz sokak (UX-03) |
| /platform | evet | 0 | FE-06, FE-07, UX-04 |
| Diğer 30+ sayfa | evet | 0 | — |

## 6. Doğrulanamayanlar
- Gerçek faturaları olan kiracı faturalama ekranı (demoda boş durum)
- Başlangıç kartı (demoda tüm adımlar tamamlanmış)
- `/welcome` tanıtım sayfası (`PUBLIC_LANDING` ayarlı değil)
- Geçerli bir davet anahtarıyla /invite akışı
- İngilizce dil görünümü
- Gerçek ekran okuyucu (NVDA/VoiceOver) ve iOS Safari
- %200 yakınlaştırma
- Form gönderme akışları (demo veritabanını değiştirmemek için bilerek denenmedi)
- axe'ın "incelenmeli" dediği kontrast düğümleri (elle inceleme gerekiyor)
