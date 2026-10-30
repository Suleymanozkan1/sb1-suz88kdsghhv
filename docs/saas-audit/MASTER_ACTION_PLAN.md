# Ana Eylem Planı

**Kapsam:** `main` 39083c6 (30 Ekim 2026). Bu belge diğer sekiz denetim belgesindeki bulguları tek bir öncelikli yol haritasında topluyor.

**Denetim yalnızca belgeleme yaptı.** Hiçbir bulgu düzeltilmedi; kaynak kod, şema, yapılandırma ve canlı ortam değiştirilmedi. Aşağıdaki her madde uygulanmadan önce onay bekliyor.

## Nasıl okunmalı

**Öncelikler**

| Öncelik | Anlamı | Son tarih |
|---|---|---|
| **P0** | Lansmanı engelleyen ya da GM demosunda görünecek madde | GM demosu (Kasım başı) veya en geç 23 Kasım |
| **P1** | Lansmandan önce yapılmalı | 30 Kasım |
| **P2** | Lansmandan sonraki ilk 1–2 ay | Ocak 2027 |
| **P3** | Bekleyen iş listesi | Planlanmadı |

**Tahmin birimleri** tek geliştirici içindir ve test yazmayı kapsar:
- **Küçük:** 1 güne kadar.
- **Orta:** 2–5 gün.
- **Büyük:** 1–3 hafta.

**Değişiklik riski** düzeltmenin kendisinin bir şeyi bozma olasılığıdır, bulgunun ciddiyeti değildir.

**Kimlikler:** Aynı sorunu anlatan bulgular birleştirildi (aşağıdaki eşleme tablosu). Her yerde birleşik kimlik kullanılıyor.

## 1. Çapraz incelemenin değiştirdikleri

Beşinci aşamada bağımsız bir gözden geçirici her YÜKSEK ve önemli ORTA bulgunun kaynak satırını yeniden okudu. Mümkün olanları `hotelcost_test_f` test veritabanında ve yerel demo sunucusunda salt okunur olarak yeniden üretti. Canlı ortama dokunulmadı.

### Ciddiyet düzeltmeleri

| Kimlik | Eski | Yeni | Neden |
|---|---|---|---|
| DB-06 | ORTA | **YÜKSEK** | Kiracılar yaklaşık **23 Kasım 2026**'da salt okunur moda düşebilir; tarih lansmandan önce. Canlı kontrol olumlu çıkarsa KRİTİK. |
| ARCH-03 (+NV-12) | YÜKSEK / ORTA | **YÜKSEK** | Önizleme derlemelerinin canlı veritabanını migrate etmesi doğrulandı. Vercel Preview gerçekten canlı Neon'a bağlıysa KRİTİK. |
| BIZ-01 | YÜKSEK | **ORTA** | Kod bunu bilerek yapıyor ve belgeliyor (`recipes.ts:307-312`). Değişiklik ileriye dönük, departmanla sınırlı ve denetim izine yazılıyor. Bu bir ürün kararı. Onay zorunlu sayılırsa yeniden YÜKSEK olur. |
| DB-04 | ORTA | **DÜŞÜK** | Veritabanı tetikleyicisi boşluğu gerçek, ancak tek yazma yolu oteli zaten kontrol ediyor. Yalnızca ek savunma katmanı ve belge düzeltmesi. |
| UX-01 (+ARCH-11) | ORTA | **DÜŞÜK** | Gerçek sayı 188 anahtarda 215 üzerine yazma. Bunların 56'sı yalnızca harf büyüklüğünde ayrışıyor, yani yaklaşık 132 anlamsal çelişki var. |

### Bulguların kapsamındaki düzeltmeler

- **ARCH-03:** `recipes-refreeze` her dağıtımda tüm reçeteleri yeniden maliyetlendirmiyor. Yalnızca eski maliyet modelindeki görüntülere dokunuyor, değilse hiçbir şey yapmıyor. Asıl risk, gözden geçirilmemiş migrasyonların önizleme derlemelerinden canlıya uygulanması. Bu risk geçerli.
- **SEC-01:** "Başka kiracıların demosunu silme" senaryosu, canlı veritabanında demo şirketi olmasını gerektiriyor; `docs/VERCEL.md:57` buna karşı çıkıyor. Gerçek etki, süresiz ücretsiz Premium. Bu, test veritabanında yeniden üretildi.
- **BIZ-07:** Deneme bitince ekranlar ve kayıt düzeyindeki ayrıntı kapanıyor. Ancak toplanmış modül verisi `/api/export/[section]` üzerinden CSV olarak alınabiliyor. Yan etki: BASIC kiracılar STANDARD raporlarını CSV ile alabiliyor (DÜŞÜK düzeyde bir gelir sızıntısı).
- **SEC-03:** Sızıntı tek tek maaşları değil, departman toplamlarını gösteriyor. Ancak `rooms_division` rolü de F&B havuzlarını aynı şekilde görüyor; bulgu bu açıdan hafife alınmıştı.
- **ARCH-01:** Varsayılan tek aylık dışa aktarma demo ölçeğinde 4,5 MB'a sığıyor (Eylül: TSV 1,25 MB, XLSM 0,84 MB). İki üç aylık, yıl başından bugüne ve büyük otel dışa aktarmaları sığmıyor.

### Hiçbir gözden geçiricinin görmediği maddeler

1. **Faturalama için kapatma anahtarı zaten var:** `BILLING_ENFORCEMENT=off` (`plans.ts:73`, `.env.example:31`, README:132). DB-06'nın acil çözümü kod değil, yapılandırma.
2. **Rol şablonları kod içinde sabit** (`permissions.ts:84-111`). Rol düzenleme servisi veya rotası yok. Müşteri görev ayrılığı sorunlarını kendi çözemiyor; bu BIZ-02'yi güçlendiriyor.
3. **İlk SaaS müşterisi 30 günlük BASIC denemeyle başlıyor.** `setup:first-company --platform-admin` platform şirketini kuruyor, bu yüzden ilk müşteri (büyük olasılıkla pilot ya da GM müşterisi) tasarım gereği denemeye düşüyor. Kurulumda açık bir `paidThrough` veya paket verilmeli. Kök neden DB-06 ile aynı.
4. **Demo kimlik bilgileri açık** (yeni bulgu **DEMO-01**, ORTA). `docs/VERCEL.md:64` çalışan demo şifrelerini yayınlıyor; bunlara platform konsoluna erişen `superadmin@test.local` da dahil. Depo veya demo adresi herkese açıksa GM demosundan önce değiştirilmeli.
5. **Belgelerdeki sayılar uyumsuzdu.** Doğru sayılar: 158 rota dosyası, 198 HTTP işleyicisi. Bunların 189'u `api()` sarmalayıcısını kullanıyor. QA belgesindeki "191" düzeltildi.

### Birleştirilen kimlikler

| Birleşik kimlik | İçerdiği | Konu |
|---|---|---|
| ARCH-02 | SEC-06 | Bağımlılık güvenlik açıkları |
| ARCH-03 | NV-12 | Önizleme derlemeleri canlı veritabanını migrate ediyor |
| DB-06 | QA-03, ilk şirket denemesi | 30 günlük deneme varsayılanı |
| BE-01 | BIZ-06, BIZ-05'in bir kısmı | Faturalanan otel sayısı ve paket bütünlüğü |
| DB-01 | BIZ-14 (numaralandırma), ARCH-06 (numaralandırma) | Eşzamanlılık ve belge numaraları |
| UX-01 | ARCH-11 | Çelişkili çeviri anahtarları |
| TOOL-01 | QA-06, QA-04'ün kapsam eşiği kısmı | CI boşlukları |
| ARCH-05 | DB-07 (temizlik), BE-04 (gece işi) | Zamanlama ve saklama süresi |
| ARCH-07 | BE-02, BE-04 | Sunucusuz çalışma sınırları |
| PERF-04 | DB-03 | Açılış bakiyeleri tüm geçmişten hesaplanıyor |
| PERF-07 | DB-02 | Eksik indeksler |
| PERF-01 | ARCH-01'in süre/bellek kısmı | Büyük dışa aktarmalar |
| BIZ-15 | UX-09 | Demo sapması ve renk anlamı |
| FE-06 | FE-07'nin onay kısmı | Onay pencereleri |

SEC-02 ile BIZ-07 aynı kapı tasarımından doğuyor ama ayrı tutuldu: biri güvenlik, diğeri ürün sorunu.

## 2. P0: lansmanı engelleyenler

Sıra önemlidir. İlk iki madde yapılandırma kontrolüyle başlıyor ve kod gerektirmeyebilir.

### P0-1 · DB-06 · Mevcut kiracılar 23 Kasım civarında salt okunur moda düşebilir

- **Sorun:** Faturalama migrasyonu `trialEndsAt` alanına `now() + 30 gün` varsayılanı ekliyor. Postgres bu değeri mevcut satırlar için migrasyon anında bir kez hesaplıyor. `plan` zaten BASIC varsayılanına sahip. Platform şirketi olan bir veritabanında, `paidThrough` alanı boş her gerçek kiracı 30 gün sonra EXPIRED olur, salt okunur moda geçer ve BASIC özelliklerine düşer.
- **Kanıt:**
  - Migrasyon `20261023090000_billing`.
  - `plans.ts:72-77`: zorlama yalnızca bir platform şirketi varken açık.
  - PR #22 24 Ekim'de birleşti. Canlı ortam o gün migrate olduysa son gün yaklaşık **23 Kasım 2026**.
  - QA-03: kalıcı e2e veritabanı da aynı nedenle 30 gün sonra bozulacak.
- **Etki:** Ödeme yapan bir müşteri GM demosu ile lansman arasında hiçbir veri giremez hale gelir. Veri kaybolmaz.
- **Çözüm:**
  1. Canlı ortamda iki salt okunur sorgu çalıştırılmalı:
     ```sql
     SELECT count(*) FROM "Organization" WHERE "isPlatform";
     SELECT name, "trialEndsAt", "paidThrough", plan
     FROM "Organization" WHERE NOT "isDemo" AND NOT "isPlatform";
     ```
  2. Sonuca göre üç seçenek var:
     - gerçek müşteriler için platform konsolundan `paidThrough` ve paket ayarlanır;
     - `extendTrial` ile deneme uzatılır;
     - faturalama gerçekten başlayana kadar Vercel'de `BILLING_ENFORCEMENT=off` yapılır.
  3. Kalıcı çözüm:
     - `setup:first-company` ve platform konsoluna açık bir paket ve bitiş tarihi alanı eklenmeli;
     - süresi 7 gün içinde dolacak kiracıları gösteren bir operatör uyarısı eklenmeli;
     - e2e ve demo şirketleri uzak bir bitiş tarihiyle kurulmalı (QA-03).
- **Değişiklik riski:** Düşük. Anahtar ve konsol işlemleri zaten var ve geri alınabilir.
- **Bağımlılık:** Canlı veritabanına salt okunur erişim ya da Vercel ortam değişkenlerine erişim. Bu sizin işleminiz.
- **Tahmin:** Kontrol ve acil önlem için 1 saat. Kalıcı çözüm Küçük.

### P0-2 · ARCH-03 · Önizleme derlemeleri canlı veritabanını migrate edebiliyor

- **Sorun:** `vercel-build` her derlemede `prisma migrate deploy` ve ardından `recipes-refreeze` çalıştırıyor. Belgeler veritabanını Production, Preview ve Development ortamlarının üçüne de bağlamayı söylüyor. Bu yüzden herhangi bir dalın önizleme derlemesi, gözden geçirilmemiş bir migrasyonu canlı veritabanına uygular.
- **Kanıt:**
  - `package.json:45`.
  - `scripts/check-build-env.mjs:26`.
  - `docs/VERCEL.md:12`.
  - `recipes.ts:574-576`: refreeze her derlemede tüm otelleri tarıyor ve herhangi bir hatada dağıtımı düşürüyor.
- **Etki:** Bir deneme dalı canlı şemayı geri dönüşsüz değiştirebilir. Bu oturumdaki her PR, bir önizleme derlemesi tetikledi.
- **Çözüm:**
  1. Vercel → Storage → Neon ortam kapsamları kontrol edilmeli. Preview ortamı canlı veritabanına bağlıysa ya Neon'un "önizleme başına dal" özelliği açılmalı ya da Preview'dan veritabanı bağlantısı kaldırılmalı.
  2. Kodda `migrate deploy` ve `recipes-refreeze` yalnızca `VERCEL_ENV=production` iken çalışmalı.
  3. Canlı migrasyondan önce Neon anlık görüntüsü alınmalı; bu adım `docs/VERCEL.md`'ye yazılmalı.
- **Değişiklik riski:** Düşük. Önizleme derlemeleri migrasyonsuz veritabanında hata verebilir; Neon dalı bunu çözer.
- **Bağımlılık:** Vercel ve Neon panellerine erişim.
- **Tahmin:** Küçük (yarım gün).

### P0-3 · SEC-01 · İlk müşterinin yöneticisi süresiz ücretsiz Premium alabilir

- **Sorun:** Kurulum sahibi kontrolü yalnızca üç şeye bakıyor: `admin:users` izni, demo veya platform olmamak ve tam bir gerçek şirket olması. Belgelenen lansman kurulumunda bu koşul ilk müşterinin yöneticisi için sağlanıyor. Yönetici demo yükleme API'sini çağırabiliyor; `ownerConsent:true` canlı ortamdaki `ALLOW_DEMO_DATA` korumasını aşıyor.
- **Kanıt:**
  - `setup/index.ts:67-72`.
  - `generate.ts:42-44`.
  - `plans.ts:89`: demo şirketleri her zaman PREMIUM.
  - Test veritabanında yeniden üretildi; değişiklikler geri alındı.
- **Etki:** Müşteri, otel ekleyebilen bir yöneticisi olan, her zaman PREMIUM iki demo şirketi ve üç otel alır. Bu faturalamayı atlatır. Diğer gerçek kiracıların verisine dokunmuyor ve konsolda "demo" rozetiyle görünüyor.
- **Çözüm:** `/api/setup/demo*` uç noktaları, `billingEnabled()` doğruyken reddedilmeli ya da yalnızca platform yöneticisine açılmalı. DELETE için şifre yeniden sorulmalı. Regresyon testi eklenmeli.
- **Değişiklik riski:** Düşük. Canlı demo yükleme betiği (`.video-work/reload-demo.ts`) ayrı demo projesinde çalıştığı sürece etkilenmez. Demo projesi aynı veritabanında ise platform yöneticisi hesabıyla çalışmalı.
- **Bağımlılık:** Yok.
- **Tahmin:** Küçük.

### P0-4 · ARCH-02 · Next.js ve diğer bağımlılıklarda bilinen açıklar

- **Sorun:** `next@15.5.27` için kritik (GHSA-2464-fhr4-w9xw) ve yüksek (GHSA-p3m5-59mp-jv5r) danışma notları var. nodemailer, sharp ve zod için de notlar var.
- **Kanıt:** `npm audit --omit=dev`: 1 kritik, 6 yüksek, 3 orta. Tüm bağımlılıklarla: 3 kritik, 7 yüksek, 6 orta.
- **Etki:** İstismar olasılığı düşük görünüyor:
  - `images` yapılandırması yok;
  - `public/` altında SVG yok;
  - `"use server"` yok;
  - `/_next/image` 400 döndü.

  Yine de lansmandan önce yamalanmalı.
- **Çözüm:** `next@15.5.28`, `nodemailer@>=10.1.4`, sharp ve zod güncellemesi. CI'a `npm audit --omit=dev --audit-level=high` ve Dependabot eklenmeli (TOOL-01 ile birlikte).
- **Değişiklik riski:** Düşük. Yama sürümü; tam test takımı ve e2e ile doğrulanmalı.
- **Bağımlılık:** Yok.
- **Tahmin:** Küçük.

### P0-5 · GM demosu hazırlığı (FE-01, DEMO-01, BIZ-15, UX-03)

Bu dört madde ucuz, ama GM'in göreceği ekranları doğrudan etkiliyor.

| Kimlik | Sorun ve kanıt | Çözüm | Risk | Tahmin |
|---|---|---|---|---|
| **FE-01** | Gösterge paneli 390 px telefonda 236 px yatay kayıyor; /review 174 px, /variance 48 px. Neden: `Card` (`ui.tsx:47`) `min-w-0` içermiyor. | `Card`'a `min-w-0` eklenmeli; mobil e2e testi bu sayfalara genişletilmeli. | Düşük | Küçük |
| **DEMO-01** | `docs/VERCEL.md:64` çalışan demo şifrelerini, platform konsolu hesabı dahil, yayınlıyor. | Demo dağıtımının şifreleri değiştirilmeli ya da depo ve demo adresinin gizli olduğu doğrulanmalı. Belgeden şifreler çıkarılmalı. | Düşük | 1 saat |
| **BIZ-15** (+UX-09) | Demo verisinde %46 "açıklanamayan" sapma var; negatif sapma yeşil görünebiliyor. | Demo üreticisinin tüketim ve sayım oranları düzeltilmeli. Renk, sapmanın mutlak büyüklüğüne göre seçilmeli. | Düşük | Küçük |
| **UX-03** | Şef menüsünde `/imports` görünüyor ama sayfa "İçe aktarma yetkiniz yok" diyor. Şef ile kahvaltı şefinin izinleri aynı. | Menü maddeleri sayfanın gerçek izniyle gösterilmeli; kahvaltı şefine daraltılmış bir şablon verilmeli. | Düşük | Küçük |

**Bağımlılık:** FE-01 ve BIZ-15 sonrası demo yeniden yüklenmeli. Bu, canlı demoyu değiştirdiği için onayınızı gerektirir.

### P0-6 · BIZ-01 · Ürün kararı: reçete düzenlemesi onay sayılmalı mı?

- **Sorun:** `recipe:approve` izni olmayan bir şef reçeteyi düzenlediğinde yeni sürüm ONAYLI oluyor ve onaylayan şef olarak yazılıyor.
- **Kanıt:** `recipes.ts:314` → `freezeAndApprove`; test veritabanında yeniden üretildi.
- **Etki:** Bu tasarım ise sorun değil. Ama müşteriye "reçeteler onaydan geçer" denecekse, dördüncü göz kontrolü aslında yok.
- **Karar seçenekleri:**
  1. Bilinçli tasarım olarak kalır; belgeye ve eğitime yazılır.
  2. `recipe:approve` izni olmayanların düzenlemesi TASLAK olur ve onaya gider. Tahmin: Orta.
- **Bağımlılık:** BIZ-02 ile birlikte ele alınmalı.

## 3. P1: lansmandan önce (30 Kasım)

### P1-1 · ARCH-01 · Büyük dışa aktarmalar Vercel'in 4,5 MB sınırını aşıyor

- **Sorun:** Excel, XLSM ve tam maliyet uç noktaları dosyanın tamamını tek yanıtta döndürüyor. Vercel fonksiyon yanıtları 4,5 MB ile sınırlı.
- **Kanıt:**
  - `export/workbook/route.ts:15`.
  - `export/jobs/[id]/download/route.ts:9`.
  - `export/full-cost/route.ts:21`.
  - `docs/PERFORMANCE.md`: 13 ay için 36,3 MB, TSV için 71 MB.
- **Etki:** Üç aylık, yıl başından bugüne ve büyük otel dışa aktarmaları canlıda 413 hatası alır. Tek ay demo ölçeğinde çalışıyor.
- **Çözüm:**
  1. Acil önlem: Vercel'de tarih aralığı sınırlanmalı (ör. 2 ay) ve kullanıcıya açık bir mesaj gösterilmeli.
  2. Kalıcı çözüm: dosyalar Vercel Blob veya S3'e yazılmalı ve kısa ömürlü imzalı adresle verilmeli. TSV/CSV akış olarak gönderilmeli. `MAX_BODY` 4,5 MB'ın altına çekilmeli.
  3. Önizleme dağıtımında staging boyutunda bir otelle 3 aylık dışa aktarma denenmeli.
- **Değişiklik riski:** Orta. Dışa aktarma akışı değişiyor; toplamların aynı kaldığını gösteren test gerekli (QA-04).
- **Bağımlılık:** Blob deposu (Vercel paneli). PERF-01 ile birlikte tasarlanmalı.
- **Tahmin:** Acil önlem Küçük; kalıcı çözüm Orta.

### P1-2 · BIZ-03 · "Şu tutarın üstündeki düzeltmeler onaya gitsin" ayarı uygulanmıyor

- **Sorun:** `adjustmentApprovalValue` yalnızca kaydediliyor ve gösteriliyor. Stok işleme yolu bu değeri hiç okumuyor.
- **Kanıt:**
  - `admin.ts:188,205` ve `console.tsx:326`.
  - Yeniden üretildi: eşik 1.000 iken 50.000 değerinde bir düzeltme onaysız işlendi.
  - `inventory.ts:54-68`: denetim kaydı hareket işleminin dışında yazılıyor.
- **Etki:** Müşteriye görünen bir kontrol aslında yok. Denetimde ciddi güven kaybı yaratır.
- **Çözüm:** Eşiği aşan düzeltmeler, fire akışında olduğu gibi onaya gitmeli ve onaylanınca işlenmeli. Denetim kaydı aynı işleme taşınmalı. Bu yapılamıyorsa ayar ekrandan kaldırılmalı.
- **Değişiklik riski:** Orta. Stok işleme yoluna dokunuyor.
- **Bağımlılık:** Yok.
- **Tahmin:** Küçük–orta.

### P1-3 · BIZ-02 · Satın alma ve bütçede görev ayrılığı yok (1. aşama)

- **Sorun:** Satın alma müdürü kendi açtığı siparişi onaylayabiliyor. Aynı kişi siparişsiz mal kabul de girebiliyor. Bütçeyi oluşturan kişi onu onaylayabiliyor.
- **Kanıt:**
  - `purchasing.ts:89-97`: oluşturan ile onaylayan arasında karşılaştırma yok.
  - Canlı demoda `/api/budgets` kayıtlarında `createdById == approvedById`.
  - Rol şablonları kodda sabit ve müşteri tarafından değiştirilemiyor (`permissions.ts:84-111`).
- **Etki:** Satın alma suistimaline karşı temel iç kontrol yok. Otel denetçileri ve zincir merkezleri bunu ilk sorar.
- **Çözüm:**
  - **1. aşama (P1):** sipariş, bütçe ve reçete onayında "oluşturan ≠ onaylayan" kontrolü. Tek kişilik oteller için yönetici tarafından açılabilen bir istisna ayarı.
  - **2. aşama (P2):** görev ayrılığı matrisi, düzeltilmiş şablonlar ve rol düzenleme ekranı.
- **Değişiklik riski:** Orta. Küçük otellerde iş akışını durdurabilir; istisna ayarı bu yüzden gerekli.
- **Bağımlılık:** BIZ-01 kararı.
- **Tahmin:** 1. aşama Küçük; 2. aşama Orta–büyük.

### P1-4 · SEC-02 · Süresi dolan abonelik erişim kaldırmayı engelliyor

- **Sorun:** Salt okunur muafiyet listesi `/api/admin/` ve `/api/integrations/` yollarını kapsamıyor.
- **Kanıt:** `handler.ts:207` ve `features.ts:72-73`.
- **Etki:** Abonelik süresi dolmuş bir otelde ayrılan çalışan pasifleştirilemiyor ve okuma erişimini koruyor. Bot anahtarı bu dönemde etkisiz, ama abonelik yenilenince yeniden canlanıyor.
- **Çözüm:** Erişimi azaltan işlemler salt okunur moddan ve paket kapısından muaf tutulmalı:
  - kullanıcı pasifleştirme;
  - davet iptali;
  - entegrasyon anahtarı iptali;
  - API anahtarı iptali.
- **Değişiklik riski:** Düşük.
- **Bağımlılık:** Yok.
- **Tahmin:** Küçük.

### P1-5 · SEC-03 · Dağıtım modülü diğer departmanların personel havuzlarını gösteriyor

- **Sorun:** Dağıtım (allocation) okumaları yalnızca `opex:view` izni istiyor, departman kapsamına bakmıyor.
- **Kanıt:**
  - `allocation.ts:64,121,241`.
  - Canlı demoda F&B müdürü (`fbm`) için `/api/opex/reports/housekeeping` 403 dönüyor, ama `/api/allocation/runs` 200 dönüyor.
  - CSV dışa aktarımında Teknik Servis personel toplamı görünüyor.
- **Etki:** Departman düzeyinde personel maliyeti başka departman müdürlerine sızıyor. `rooms_division` rolü de F&B havuzlarını görüyor.
- **Çözüm:** Satırlar `actor.departmentIds` ile süzülmeli ya da okuma tüm departmanlara yetkili rollere bırakılmalı. Her iki rol için regresyon testi eklenmeli.
- **Değişiklik riski:** Düşük.
- **Bağımlılık:** Yok.
- **Tahmin:** Küçük.

### P1-6 · DB-01 · Eşzamanlı yazmalarda numara çakışması ve kilitlenme

- **Sorun:** Belge numaraları `count()+1` ile üretiliyor. Kilitlenmeler (40P01) kullanıcıya 500 hatası olarak ulaşıyor.
- **Kanıt:**
  - `purchasing.ts:52-56` ve `handler.ts:130-144`.
  - 10 eşzamanlı siparişin 8'i 409 aldı.
  - Mimari incelemede 20 eşzamanlı mal kabulün 17'si çakıştı; 10 eşzamanlı işin 9'u kilitlendi.
- **Etki:** Yoğun saatlerde, örneğin mal kabul ile bot aktarımı aynı anda olduğunda, kullanıcı hata alır ve işlem kaybolabilir.
- **Çözüm:**
  - Otel başına numaralandırma tablosu ya da danışma kilidi.
  - Satır kilitleri sabit sırada alınmalı.
  - `inTx` 40P01/40001 hatalarında yeniden denemeli; bu hatalar 500 yerine 409/503 olarak dönmeli.
- **Değişiklik riski:** Orta. Tüm yazma işlemlerinin ortak yolu değişiyor.
- **Bağımlılık:** Yok.
- **Tahmin:** Küçük–orta.

### P1-7 · PERF-03 · Toplu POS aktarımı binlerce sıralı sorgu yapıyor

- **Sorun:** Satış ve sayım yazma yolları her satır için ayrı sorgular çalıştırıyor.
- **Kanıt:** 3.000 POS satırı 33,4 sn ve 24.364 sorgu sürdü. 1.000 satırlık sayım onayı 20,7 sn sürdü.
- **Etki:** Büyük bir otelin günlük Micros aktarımı Vercel süre sınırına yaklaşıyor. Uzun işlem diğer yazmaları kilitliyor (DB-01).
- **Çözüm:**
  1. Acil önlem: aktarım satış noktası ve gün başına parçalara bölünmeli.
  2. Kalıcı çözüm:
     - satış satırları `createMany` ile yazılmalı;
     - `assertPostable` her tarih için bir kez çağrılmalı;
     - hareketler bellekte hesaplanıp küme halinde yazılmalı.
- **Değişiklik riski:** Orta–yüksek. Maliyet hesaplarının en kritik yolu; mutabakat testleriyle korunmalı.
- **Bağımlılık:** DB-01 ile birlikte yapılmalı.
- **Tahmin:** Acil önlem Küçük; kalıcı çözüm Büyük.

### P1-8 · BIZ-08 · Süresi dolan kiracılar için otomatik siparişler sürüyor

- **Sorun:** Gece işi otomatik siparişleri paket durumuna bakmadan gönderiyor. Sipariş kaydı açmıyor ve `replyTo` vermiyor.
- **Kanıt:** `nightly.ts:19-29` ve `auto-order.ts:254`. `runNightly` için test kapsamı %0.
- **Etki:**
  - Ödemesi geçmiş bir Premium otel tedarikçilere sipariş e-postası göndermeye devam eder.
  - Gönderilen siparişin sistemde karşılığı yok.
  - Tedarikçinin yanıtı otele değil, gönderen adrese gider.
- **Çözüm:**
  - Salt okunur kiracılar atlanmalı.
  - Her e-posta için bir sipariş kaydı açılmalı ve numarası e-postaya yazılmalı.
  - `replyTo` otelin satın alma adresi olmalı.
  - `runNightly` için test eklenmeli.
- **Değişiklik riski:** Düşük–orta.
- **Bağımlılık:** Yok.
- **Tahmin:** Orta.

### P1-9 · BE-01 · Faturalanan otel sayısı kiracıya bağlı

- **Sorun:** Kiracı paket kontrolü olmadan otel ekleyebiliyor. Fatura, kesildiği andaki aktif otel sayısıyla hesaplanıyor.
- **Kanıt:** `tenancy.ts:130-146`, `billing.ts:150-153` ve `billing.ts:212`.
- **Etki:** Fatura kesilmeden önce otel kapatılıp sonra yeniden açılabilir. Faturalama elle yapıldığı için operatör sayıyı görüp düzeltebiliyor; risk orta.
- **Çözüm:** Dönem içindeki en yüksek aktif otel sayısı faturalanmalı. Platform konsolunda faturalanan ve aktif sayılar yan yana gösterilmeli.
- **Değişiklik riski:** Düşük.
- **Bağımlılık:** Yok.
- **Tahmin:** Küçük.

### P1-10 · TOOL-01 · CI'da uçtan uca test, güvenlik taraması ve kapsam eşiği yok

- **Sorun:** `ci.yml` yalnızca şu adımları çalıştırıyor:
  - VBA farkı;
  - tip kontrolü;
  - lint;
  - birim testleri;
  - entegrasyon testleri.
- **Kanıt:** `tests/e2e` altındaki 10 senaryo CI'da hiç çalışmıyor. `.github/` altında Dependabot yok.
- **Etki:** Bu denetimdeki mobil taşma (FE-01) gibi hatalar ve bağımlılık açıkları birleştirmeden önce yakalanmıyor.
- **Çözüm:**
  - Postgres ve Chromium ile bir e2e işi; başarısız olursa rapor yüklenmeli.
  - `npm audit --omit=dev --audit-level=high`.
  - Dependabot.
  - `src/server/**` için kapsam eşiği.
- **Değişiklik riski:** Düşük. Yalnızca CI değişiyor; ilk çalıştırmada düzeltilmesi gereken kararsız testler çıkabilir.
- **Bağımlılık:** Önce DB-06'nın e2e kısmı (QA-03) düzeltilmeli.
- **Tahmin:** Orta.

### P1-11 · Diğer lansman öncesi maddeler

| Kimlik | Sorun | Kanıt | Etki | Çözüm | Risk | Tahmin |
|---|---|---|---|---|---|---|
| **ARCH-04** | Arka plan hataları sessiz | Gece işi bir otel başarısız olsa da 2xx dönüyor; webhook `after()` dışında | Hatalar fark edilmiyor | `log.error`, 2xx dışı yanıt, `after()`, `/api/health`'te son başarılı çalıştırma | Düşük | Küçük |
| **BIZ-07** | Deneme bitince üst paket ekranları kapanıyor | `featureForPath` okumaları da kapatıyor | "Hiçbir şey kaybolmaz" sözü kısmen tutulmuyor (CSV açık) | Düşürülen modüllerde yalnızca yazma kapanmalı; kapanacak modüller önceden gösterilmeli | Düşük | Küçük–orta |
| **UX-02** | Türkçe arayüzde İngilizce metin | Sekme başlıkları, sunucu etiketleri, denetim farkları | Demo ve lansmanda özensiz görünüm | `generateMetadata` ile çeviri; sunucu etiketleri ve denetim farkları Türkçeleşmeli | Düşük | Küçük–orta |
| **SEC-04** | MFA yok, kullanıcı şifresini değiştiremiyor veya sıfırlayamıyor | Kimlik doğrulama rotaları | Hesap ele geçirme ve unutulan şifre için destek yükü | 1. adım: kendi şifresini değiştirme ve e-postayla sıfırlama. 2. adım (P2): yöneticiler için TOTP. | Orta | Orta |

## 4. P2: lansmandan sonraki ilk 1–2 ay

| Kimlik | Sorun | Kanıt | Etki | Çözüm | Risk | Bağımlılık | Tahmin |
|---|---|---|---|---|---|---|---|
| PERF-01 | Tam maliyet dışa aktarımı gerçek hacimde sınırlara sığmıyor | Stres ölçeğinde 62–85 sn ve 4,4 GB; çalışma kitabı 141 sn ve 7,1 GB | Büyük otellerde zaman aşımı | Yalnızca istenen bölümler; aylık trend için tek `GROUP BY`; akış; bellek bütçeli iş kuyruğu | Orta | ARCH-01 | Büyük |
| PERF-04 (+DB-03) | Açılış bakiyeleri her raporda tüm geçmişten | Sorgu planları | Rapor süresi zamanla doğrusal büyüyor | Dönem kapanışında bakiyeler saklanmalı; `(hotelId, productId, txDate DESC)` indeksi | Orta | Dönem kapanışı | Orta |
| PERF-07 (+DB-02) | Eksik indeksler | Sorgu planları | Büyüdükçe yavaşlama | Tek migrasyon, `CREATE INDEX CONCURRENTLY` | Düşük | ARCH-03 | Küçük |
| PERF-02 | Tek tablo CSV tüm dışa aktarmayı hesaplıyor | `table-export` | Gereksiz yük | Oluşturucu bölüm gruplarına ayrılmalı | Düşük | PERF-01 | Orta |
| PERF-05 | Stok hareketleri 50 satır için 5.000 kayıt yüklüyor | Ölçüm | Sayfa yavaş | SQL'de birleştirme ve sayfalama | Düşük | PERF-07 | Orta |
| PERF-06 | Bütünlük kontrolü platform verisiyle büyüyor | Ölçüm | Kiracı sayısı arttıkça yavaşlama | Önce otele daraltma; tek UNION sorgusu | Düşük | Yok | Küçük–orta |
| PERF-08 | Ürün düzeyindeki sayfalar sayfalanmıyor | Ölçüm | Büyük katalogda yavaş sayfa | Sunucu tarafında sayfalama | Düşük | Yok | Orta |
| ARCH-05 (+DB-07, BE-04) | Gece işi ve temizlik yalnızca Vercel'de | Docker/Windows kurulumunda cron yok | Yerel kurulumda otomatik sipariş ve temizlik çalışmıyor | İşlem içi zamanlayıcı (danışma kilidiyle) veya Windows zamanlanmış görevi; saklama süreleri | Orta | Yok | Orta |
| ARCH-06 | Çoğaltılmış iş mantığı ayrışmış | `effectiveVersion` kopyaları, numaralandırma | Ekranlar arası tutarsız sonuç | Tek `effectiveVersion()`, tek numaralandırma servisi, tüm denetim kayıtları `audit()` ile | Orta | DB-01 | Küçük–orta |
| ARCH-07 (+BE-02) | Sunucusuz ölçek sınırları; ağır uç noktalar sınırsız | `connection_limit=1`, PDF ve yönetim paketi | Havuz zaman aşımı | Hız sınırı, PDF kuyruğu, pooler ile havuz > 1 | Orta | ARCH-01 | Orta–büyük |
| BIZ-02 2. aşama | Görev ayrılığı matrisi ve rol düzenleme | Sabit şablonlar | Müşteri kendi kontrolünü kuramıyor | Rol düzenleme ekranı ve şablon düzeltmeleri | Orta | BIZ-02 1. aşama | Orta–büyük |
| BIZ-04 | Çoklu para birimi modellenmiş ama işlenmiyor | Mal kabul formu | Yabancı para birimli faturada yanlış maliyet | Kur zorunlu olmalı ya da tek para birimi kilitlenmeli | Orta | Yok | Küçük–orta |
| BIZ-05 | Paket değişikliği kıst hesapsız | `billing.ts` | Faturalama adaletsizliği | Kıst hesap; süresi geçen kiracılar için dönem kuralı | Orta | BE-01 | Orta |
| BIZ-09 | Sayımlar kör değil | Sayım ekranı | Sayım güvenilirliği düşük | Kör sayım modu; onayda yeniden hesaplanan fark | Orta | Yok | Orta |
| BIZ-10 | Ayı yeniden açmak sonraki kapalı ayları sessizce geçersiz kılıyor | Dönem servisi | Kapanmış raporlar fark edilmeden değişiyor | Sonraki aylar "yeniden kapanış gerekli" olarak işaretlenmeli | Orta | Ürün kararı | Orta |
| DB-05 | Yedekleme ve geri yükleme boşlukları | `restore.sh`, Windows kurulumu | Yerel kurulumda veri kaybı riski | UTC ayarı, zamanlanmış `pg_dump`, PITR süresinin belgelenmesi | Düşük | Yok | Küçük–orta |
| SEC-05 | Yerel kurulumda düz HTTP ve taklit edilebilir IP | Kurulum programı | Yerel ağda oturum çalınabilir | Caddy ile TLS veya yalnızca localhost; `TRUSTED_PROXY_HOPS` | Orta | Yerel müşteri varsa P1 | Orta |
| FE-03 | Pencerelerde odak yönetimi yok | axe ve klavye testi | Erişilebilirlik | `<dialog>.showModal()`; benzersiz kimlikler | Düşük | Yok | Küçük–orta |
| FE-06 (+FE-07) | Kritik onaylar tarayıcı `prompt`/`confirm` ile; platform konsolu paketi seçimde değiştiriyor | `console.tsx:85` | Yanlışlıkla paket değişikliği (denetime yazılıyor, geri alınabilir) | Ortak `ConfirmDialog`/`ReasonDialog`; açık "Paketi değiştir" düğmesi | Düşük | Yok | Küçük–orta |
| FE-08 | Doğrulama hataları teknik alan yolu gösteriyor | Form hataları | Kullanıcı anlamıyor | Türkçe alan etiketi, `aria-invalid` | Düşük | Yok | Küçük |
| UX-05 | Denetim izi son 200 kayıtla sınırlı | `/audit` | Denetimde geçmiş bulunamıyor | Süzgeç, sayfalama, okunur fark | Düşük | Yok | Orta |
| QA-01, QA-02 | Kararsız test ve temizlenmeyen test veritabanları | Kapsam çalıştırması | Yanlış alarm | Süre sınırı; genel kurulumda veritabanı boşaltma | Düşük | Yok | Küçük |
| QA-04 | Rotalar, dışa aktarmalar ve gece işi test edilmiyor | Kapsam: rotalar %7,6, gece işi %0 | Gerilemeler kaçıyor | Rota yetki/paket matrisi testi; dışa aktarma toplamı testi; `runNightly` testi | Düşük | TOOL-01 | Orta |

## 5. P3: bekleyen iş listesi

| Kimlik | Konu | Çözüm özeti | Tahmin |
|---|---|---|---|
| DB-04 | Kiracı tetikleyicisi her referansı kapsamıyor | Eksik tetikleyiciler; `MULTI_TENANCY.md` düzeltmesi | Küçük |
| DB-08 | Migrasyon uygulamalarında riskler | Kilit süresi, geri dönüş notu | Küçük |
| DB-09 | Silme davranışı tutarsız | Kaynak belgeler silinmemeli; GERİ ALINDI durumu | Orta |
| ARCH-08 | Bakım borcu | Dışa aktarmayı bölmek, ölü kod, demo üreticisini ayırmak | Orta |
| ARCH-09 | Katmanlama tutarsız | Okumalar servislere; lint kuralı | Orta |
| ARCH-10 | Yapılandırma yönetimi | Tek doğrulanmış yapılandırma modülü | Küçük |
| UX-01 (+ARCH-11) | 188 anahtarda 215 çelişkili çeviri | Sözlükler alana göre; çakışmada CI hatası | Küçük–orta |
| BIZ-11 | Fire ve ikram eşikleri bölünebiliyor | Kullanıcı ve ürün başına günlük toplam eşik | Küçük |
| BIZ-12 | Denetim izinde boşluklar | Eksik işlemler `audit()` ile | Küçük |
| BIZ-13 | Dışa aktarma toplamları kayan noktalı | Decimal | Küçük |
| BIZ-14 | Faturalama bildirimleri elle | Otomatik bildirim | Orta |
| BIZ-07 yan etki | BASIC kiracılar STANDARD raporlarını CSV ile alabiliyor | `/api/export/[section]` paket kapısı | Küçük |
| FE-02, FE-04, FE-05 | Ekran okuyucu ve klavye ayrıntıları | `relative`, "Ana içeriğe geç", çevrilen tablo etiketi | Küçük |
| FE-09, FE-10 | Yükleniyor göstergesi yok; tek hidrasyon hatası | `loading.tsx`; hata yeniden üretilmeli | Küçük |
| UX-04, UX-06, UX-07 | Biçim, adlandırma ve düğme tutarsızlıkları | Ortak biçimleyiciler; terim sözlüğü; nedenli devre dışı | Küçük–orta |
| UX-08 | Eğitim videolarında ses yok, bazı sayfalar eksik | Seslendirme, ayrı altyazı dosyası, eksik sayfalar | Orta |
| PERF-09 | Yerel kurulumda CPU'ya bağlı istek işleme | Ağır işler için işçi iş parçacığı | Orta |
| QA-05 | Test süresinin %41'i tek dosyada | "Yavaş" etiketi, gece çalıştırma | Küçük |
| TOOL-02 | Depoda proje bağlamı yok | `CLAUDE.md` ve `.claude/skills/hotelcost-dev` (TOOLKIT_INVENTORY seçenek B) | Küçük |
| TOOL-03 | Playwright 8 alt sürüm geride | Ayrı PR ile 1.64.1 | Küçük |

## 6. Önerilen takvim

| Zaman | İş |
|---|---|
| **Bu hafta (GM demosundan önce)** | P0-1 kontrolü ve acil önlem; P0-2 Vercel/Neon kontrolü; DEMO-01; FE-01; BIZ-15; UX-03; BIZ-01 kararı |
| **Hafta 2 (3–9 Kasım)** | P0-2 kod koruması; SEC-01; ARCH-02; ARCH-01 acil önlemi; SEC-02; SEC-03 |
| **Hafta 3 (10–16 Kasım)** | BIZ-03; BIZ-02 1. aşama; DB-01; PERF-03 acil önlemi; BE-01 |
| **Hafta 4 (17–23 Kasım)** | TOOL-01; BIZ-08; ARCH-04; UX-02; BIZ-07; DB-06 kalıcı çözüm. **23 Kasım: DB-06 son günü.** |
| **Hafta 5 (24–30 Kasım)** | SEC-04 1. adım; ARCH-01 kalıcı çözüm; dondurma, tam regresyon ve önizleme dağıtımında yük testi |
| **Aralık–Ocak** | P2 |

Her madde ayrı, küçük bir PR olmalı. Her PR'da şunlar bulunmalı: regresyon testi, tam birim ve entegrasyon takımı ve bir önizleme dağıtımı. Önizleme dağıtımı ancak P0-2 tamamlandıktan sonra güvenlidir.

## 7. Onay gerektiren kararlar

1. **Canlı ortam kontrolleri (P0-1, P0-2):** Canlı veritabanında iki salt okunur sorgu; Vercel ve Neon ortam kapsamları. Bunları siz yapabilirsiniz ya da erişim verebilirsiniz.
2. **Acil yapılandırma:** `BILLING_ENFORCEMENT=off` ya da müşteri bazında `paidThrough` ayarı.
3. **Ürün kararları:**
   - BIZ-01: reçete onayı;
   - BIZ-10: yeniden açma kuralı;
   - BIZ-02: tek kişilik oteller için istisna;
   - BIZ-07: düşürülen modüllerde okuma açık kalsın mı.
4. **Kod düzeltmeleri:** Bu planın tamamı. Denetim hiçbir düzeltme uygulamadı.
5. **Demo:** Kimlik bilgilerinin değiştirilmesi ve düzeltmelerden sonra canlı demonun yeniden yüklenmesi.
6. **Araçlar:** TOOLKIT_INVENTORY'deki A ve B seçenekleri (önerilen) ile isteğe bağlı C–F seçenekleri.
