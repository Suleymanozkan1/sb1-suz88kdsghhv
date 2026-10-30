# Performans Denetimi (PERFORMANCE_AUDIT)

## Yöntem

**Sayfalar ve dışa aktarmalar:** yerel üretim derlemesinde (:3300) demo veritabanıyla ölçüldü. Demo veritabanında 3 otel var, otel başına yaklaşık 7.500 stok hareketi.
- Her adres 5 kez çağrıldı; tablolarda ortanca ve p95 değerleri var.
- Makine 4 vCPU ve ölçüm sırasında başka denetçilerle paylaşıldı. Mutlak süreler biraz şişkin, ancak karşılaştırmalar geçerli.

**Veritabanı (salt okunur EXPLAIN ANALYZE):** `hotelcost_staging` üzerinde ölçüldü.
- Toplam 10 otel, 1,46 milyon stok hareketi, 743 bin maliyet hareketi.
- Ölçülen otel 155.884 hareketli.
- Staging şeması 30 migrasyonun 12'sinde. Eksik bir indeks, ölçüm için geri alınan bir işlem içinde geçici olarak oluşturuldu.

**Ölçek testi:** `hotelcost_stress` verisi bir test veritabanına kopyalandı ve güncel şemaya taşındı.
- İçerik: 10 bin ürün, 5 bin reçete, 100 bin stok hareketi, 100 bin satış satırı.
- Servisler doğrudan çağrıldı. Ardından test veritabanı eski boş haline getirildi.

**Not:** Ölçümler sırasında şirket yöneticisinin saatlik 30'luk dışa aktarma kotasından 11'i kullanıldı. Proje dosyaları değiştirilmedi.

## 1. Ölçümler

### A. Sayfalar (demo, şirket yöneticisi; ms)

| Sayfa | HTML | İlk bayt (ortanca / p95) | Toplam (ortanca / p95) |
|---|---|---|---|
| / (gösterge paneli) | 117 KB | 205 / 231 | 213 / 235 |
| /variance | 398 KB | 147 / 156 | 163 / 174 |
| /inventory | 513 KB | 181 / 252 | 198 / 267 |
| **/inventory/ledger** | 211 KB | **919 / 1280** | **929 / 1284** |
| /inventory/ledger?view=detail | 211 KB | 98 / 105 | 110 / 112 |
| /recipes | 154 KB | 98 / 179 | 103 / 179 |
| /recipes/{id} | 72 KB | 76 / 147 | 77 / 153 |
| /buffet | 125 KB | 67 / 79 | 77 / 92 |
| /review | 105 KB | 179 / 216 | 181 / 216 |
| /data-quality | 72 KB | 102 / 133 | 104 / 135 |
| /comps | 156 KB | 51 / 64 | 56 / 70 |
| /purchasing | 576 KB | 205 / 256 | 223 / 287 |
| /products (200'lük sayfa) | 372 KB | 152 / 226 | 174 / 257 |

HTML gzip ile sıkıştırılıyor; örneğin /inventory 525 KB'tan 84 KB'a iniyor. Sayfalar `Cache-Control: private, no-store` kullanıyor; oturuma bağlı sayfalar için doğru.

### B. Dışa aktarmalar (demo, 1–29 Ekim; ms)

| Çıktı | Boyut | Ortanca | p95 |
|---|---|---|---|
| Teorik ve Gerçekleşen xlsx | 21 KB | 165 | 257 |
| Teorik ve Gerçekleşen PDF | 50 KB | 356 | 482 |
| Stok hareketleri xlsx | 170 KB | 1149 | 1428 |
| Yönetim paketi PDF | 59 KB | **2216** | 2274 |
| Excel çalışma kitabı (.xlsm) | 1074 KB | **5584** | **9476** |
| Maliyet CSV (tek tablo) | 525 KB | **1908** | **4811** |

Sunucunun bellek kullanımı (RSS) 1,07 GB'tan 1,30 GB'a çıktı. Eşzamanlılık testinden sonra 1,86 GB'a ulaştı, boşta 0,92 GB'a döndü. Sızıntı gözlenmedi.

### C. Eşzamanlılık (demo)

| Sayfa | Paralel istek | Ortanca ms | p95 ms | İstek/sn |
|---|---|---|---|---|
| / | 1 | 163 | 197 | 5,8 |
| / | 10 | 1170 | 1350 | 8,1 |
| /variance | 10 | 1259 | 1544 | 7,2 |
| /inventory/ledger | 1 | 654 | 680 | 1,5 |
| /inventory/ledger | 10 | 3479 | 3663 | 2,8 |

Gecikme yaklaşık 7 kat artarken işlem hacmi yalnızca 1,4–1,9 kat artıyor. Node süreci CPU'ya bağlı: sayfa çizimi, Prisma sonuç ayrıştırma ve Decimal aritmetiği.

### D. Veritabanı (staging, 155.884 hareketli otel)

| Sorgu | Süre | Not |
|---|---|---|
| Sapma açılış toplamı (tüm geçmiş) | 135 ms ılık / **1.512 ms soğuk** | Geçmişle büyüyor |
| Stok hareketleri sayfası `ORDER BY txDate DESC LIMIT 100` | 178–226 ms | Uygun indeks yok |
| Aynı sorgu, `OFFSET 100000` ile | 368–661 ms | Diske taşan sıralama |
| `costTableAsOf` DISTINCT ON | 313–342 ms | Diske taşan sıralama |
| Bütünlük kontrolü "cost_amounts" | **19,6 sn** (indeksle 9,4 sn) | Tüm platformun hareketlerini dolaşıyor |
| Bütünlük kontrolü "cost_ledger" | **11,4 sn** (indeksle 0,33 sn) | |
| Bütünlük kontrolü kiracı döngüsü (54 sıralı sorgu) | 4,1 sn | |
| Mal kabul satırları, fiş başına | 22,9 ms | 122.769 satırda tam tarama |

### E. Ölçek testi (stres verisi, doğrudan servis çağrısı)

| Yol | Süre | Not |
|---|---|---|
| Gösterge paneli | **7,4–8,8 sn** | 61 sorgu |
| Teorik ve Gerçekleşen (ay) | 2,8–4,3 sn | |
| Veri kalitesi | 4,0–4,5 sn | |
| Maliyet değerlendirmesi | 3,6–4,0 sn | |
| Reçete listesi | 3,3–3,5 sn | |
| **Tam maliyet dışa aktarımı (1 ay)** | **62–85 sn, en yüksek bellek 4,1–4,4 GB** | 404 sorgu |
| **Excel çalışma kitabı** | **140,6 sn, en yüksek bellek 7,1 GB** | |
| **Yönetim paketi** | **63,5 sn** | |
| **Satış aktarımı, 1 günde 3.000 POS satırı** | **33,4 sn** | 24.364 sorgu; veritabanı süresi yalnızca 1,5 sn |
| **Sayım onayı, 1.000 satır** | **20,7 sn** | Tek işlem (transaction) içinde |

Tam dışa aktarmanın CPU profili (63 sn):
- 17,8 sn veritabanı bekleme
- 11,0 sn çöp toplama
- yaklaşık 10 sn Prisma ayrıştırma
- yaklaşık 7 sn Decimal hesabı

### F. Ön yüz paketi

- **İlk yükleme JS:** rota başına 205–220 kB; bunun 103 kB'ı tüm rotalarda ortak.
- **En büyük parça:** 274 KB ham / 93 KB gzip. Neredeyse tamamı **Türkçe sözlüğün bütünü**; her sayfada ve her dilde yükleniyor.
- **Statik dosyalar:** `immutable` önbellekle sunuluyor (iyi).

## 2. Bulgular

| No | Başlık | Önem |
|---|---|---|
| PERF-01 | Tam maliyet dışa aktarımı gerçek otel hacminde sunucusuz süre ve bellek sınırlarına sığmıyor | YÜKSEK |
| PERF-03 | Toplu yazma yolları tek işlemde binlerce sıralı sorgu yapıyor (POS aktarımı, sayım onayı) | YÜKSEK |
| PERF-02 | Tek tablo CSV/JSON çıktıları bile tüm dışa aktarmayı hesaplıyor | ORTA |
| PERF-04 | Maliyet sorguları ve açılış bakiyeleri her çağrıda tüm defter geçmişini tarıyor | ORTA |
| PERF-05 | Stok hareketleri sayfası 50 satır göstermek için 5.000 hareketi yüklüyor | ORTA |
| PERF-06 | Bütünlük kontrolünün süresi kiracının değil tüm platformun verisiyle büyüyor | ORTA |
| PERF-07 | Yabancı anahtar ve sıralama indeksleri eksik | ORTA |
| PERF-08 | Ürün düzeyindeki sayfalar sayfalanmıyor; yüksek ürün sayısında ağır servisler | ORTA |
| PERF-09 | CPU'ya bağlı istek işleme, tek düğümlü kurulumlarda hacmi sınırlıyor | ORTA (yerel) / DÜŞÜK (Vercel) |
| PERF-10 | Yönetim paketinde hız sınırı yok; gece işi tüm otelleri tek fonksiyonda sırayla işliyor | DÜŞÜK |
| PERF-11 | Türkçe sözlüğün tamamı her istemciye gönderiliyor | DÜŞÜK |
| PERF-12 | Eğitim videoları `max-age=0` ile sunuluyor | DÜŞÜK |
| PERF-13 | Gösterge paneli bağımsız işleri sırayla bekliyor | DÜŞÜK |
| PERF-14 | Performans belgeleri ve staging verisi güncel değil | BİLGİ |

### PERF-01 · YÜKSEK · Tam maliyet dışa aktarımı gerçek otel hacminde sunucusuz süre ve bellek sınırlarına sığmıyor
- **Kanıt:**
  - `src/server/services/export.ts` `buildFullCostExport` tüm dönemi belleğe yüklüyor (satır 170–180): stok hareketleri (200.000'e kadar), satış satırları, maliyet hareketleri, mal kabul satırları.
  - `theoreticalVsActual` 17 kez çalışıyor: satır 141'de, 163–164'te, 477–486'daki trend döngüsünde 12 kez ve 711–712'de.
  - `costTableAsOf` ve `buildResolver` 12 kez çalışıyor.
  - Ölçülen süreler:
    - Demo çalışma kitabı: 5,6 sn ortanca, 9,5 sn p95.
    - Stres ölçeği: dışa aktarma 62–85 sn ve 4,1–4,4 GB; çalışma kitabı 141 sn ve 7,1 GB; yönetim paketi 63,5 sn.
  - Rota süre sınırları: çalışma kitabı ve yönetim paketi 120 sn, dışa aktarma işi 300 sn.
- **Etki:**
  - 500 odalı bir otelde aylık çalışma kitabı veya yönetim paketi 120 sn sınırına ve Vercel bellek sınırına takılır. Vercel bellek sınırı varsayılan 2 GB, Pro'da en fazla 4 GB.
  - Ürünün temel ay sonu çıktısı 504 ya da bellek yetersizliği hatasıyla düşer.
  - "Arka plan" işleri de `after()` ile aynı fonksiyonda çalışıyor; aynı sınırlara tabi.
  - Yerel kurulumda bir dışa aktarma, tek Node sürecini bir dakikadan uzun süre meşgul eder.
- **Öneri:**
  - Yalnızca istenen bölümler üretilmeli.
  - 12 aylık trend, 12 tam sapma hesabı yerine tek bir `GROUP BY date_trunc('month')` sorgusuyla ya da dönem kapanış görüntüsünden hesaplanmalı.
  - Yalnızca gereken kolonlar seçilmeli ve satırlar parça parça akıtılmalı.
  - Gerçek arka plan işleri bellek bütçesi olan bir kuyrukta veya işçide çalışmalı.
  - Eşzamanlı uç noktalar bir ayla sınırlanmalı.
- **Zorluk:** Büyük.
- **Güven:** Ölçümle doğrulandı. Ölçek tahmini bir varsayım.
- **Ayrıca bkz.** ARCH-01 (4,5 MB yanıt sınırı) ve ARCH-07.

### PERF-03 · YÜKSEK · Toplu yazma yolları tek işlemde binlerce sıralı sorgu yapıyor
- **Kanıt:**
  - `sales.ts commitSales` (193–219) her satır için `assertPostable` ve `saleLine.create` çağırıyor.
  - `postSalesConsumption`, gün × satış noktası × ürün başına yaklaşık 20 sorguluk bir `postMovement` çalıştırıyor.
  - Ölçüm: **1 günde 3.000 satır = 33,4 sn ve 24.364 sorgu.** Veritabanı süresi yalnızca 1,5 sn; geri kalanı gidiş-dönüşler ve Prisma yükü. İşlem süre sınırı 120 sn.
  - `counts.ts postCount` (onay içinde, 60 sn sınırla): **1.000 satır 20,7 sn.**
- **Etki:**
  - Neon'un gidiş-dönüş gecikmesiyle (1–2 ms) 24 bin sorgu yaklaşık 25–50 sn daha ekler (tahmin).
  - Yoğun bir otelin gece Micros aktarımı, birkaç günlük geriye dönük aktarım ya da 2.000–3.000 kalemlik ay sonu sayımı işlem süre sınırını aşabilir. Bu durumda tüm işlem geri alınır.
  - Bu sürede stok bakiye satırları kilitli kalır ve diğer kayıtlar bekler.
- **Öneri:**
  - Satış satırları için `createMany`.
  - `assertPostable` her farklı tarih için bir kez çağrılmalı.
  - Hareketler bellekte hesaplanıp küme halinde yazılmalı.
  - İşlemler satış noktası ve gün bazında parçalanmalı.
  - Sayım satırları toplu yazılmalı.
- **Zorluk:** Büyük.

### PERF-02 · ORTA · Tek tablo CSV/JSON çıktıları tüm dışa aktarmayı hesaplıyor
- **Kanıt:** `src/app/api/export/[section]/route.ts`, yaklaşık 60 bölümün tamamını hesaplayan `buildFullCostExport`'u çağırıp yalnızca bir tabloyu döndürüyor.
- **Ölçüm:** Maliyet CSV'si 1,9 sn ortanca / 4,8 sn p95. Eşdeğer tablo dışa aktarımı 0,17 sn.
- **Etki:**
  - Ortak saatlik 30 dışa aktarma kotasını ve CPU'yu tüketiyor.
  - Excel makrosunun "yenile" yolunu yavaşlatıyor.
- **Öneri:** Oluşturucu bölüm gruplarına ayrılmalı; yalnızca istenen grup hesaplanmalı.
- **Zorluk:** Orta.

### PERF-04 · ORTA · Maliyet sorguları ve açılış bakiyeleri her çağrıda tüm geçmişi tarıyor
- **Kanıt:**
  - `sales.ts costTableAsOf` (32–52), o tarihe kadarki tüm hareketler üzerinde SUM ve DISTINCT ON çalıştırıyor. Staging'de çağrı başına 313–342 ms + 118–137 ms. Satış aktarımında her farklı gün için, dışa aktarmada 12 kez çağrılıyor.
  - Sapma açılışı ve stok durumundaki son çıkış tarihi de tüm geçmişi topluyor: 135 ms ılık / 1,5 sn soğuk.
  - Dönem kapanış görüntüleri yazılıyor ama ekranda hiç okunmuyor. Veri önbelleği yok.
- **Etki:** Maliyet geçmişle doğrusal büyüyor. 500 odalı bir otel yılda yaklaşık 1 milyon hareket üretir; bu durumda çağrı başına 1–3 sn (tahmin).
- **Öneri:**
  - Aylık kapanış bakiyeleri saklanmalı.
  - Son maliyetler StockBalance ve FifoLayer'dan alınmalı.
  - `(hotelId, productId, txDate DESC, createdAt DESC)` indeksi eklenmeli.
- **Zorluk:** Orta. Ayrıca bkz. DB-03.

### PERF-05 · ORTA · Stok hareketleri sayfası 50 satır göstermek için 5.000 hareketi yüklüyor
- **Kanıt:**
  - `inventory/ledger/page.tsx` `SUMMARY_MAX = 5000` kullanıyor ve tam ilişkilerle (ürün, depo, departman, ters kayıt) yüklüyor.
  - **Ölçüm:** 0,92 sn ortanca / 1,28 sn p95; 10 eşzamanlı istekte 3,5 sn. Prisma 5.000 satır için 1,1–1,6 sn, 50 satır için 50–60 ms harcıyor.
  - `explodeSalesRows` (`inventory.ts:265`) her satır için her satış satırını süzüyor.
  - `businessDay` her çağrıda yeni bir `Intl.DateTimeFormat` oluşturuyor: çağrı başına yaklaşık 92 µs. 20 bin çağrı 1,84 sn; önbellekli biçimlendiriciyle 0,19 sn.
- **Etki:** En çok kullanılan stok ekranı bugün en yavaş sayfa ve POS kayıtlarıyla daha da yavaşlayacak.
- **Öneri:**
  - Özet birleştirme SQL'de yapılmalı ve sayfalanmalı.
  - `(hotelId, txDate DESC, createdAt DESC)` indeksi eklenmeli.
  - Saat dilimi biçimlendiricisi önbelleğe alınmalı.
- **Zorluk:** Orta.

### PERF-06 · ORTA · Bütünlük kontrolünün süresi kiracının değil platformun verisiyle büyüyor
- **Kanıt:**
  - `integrity.ts:158` sorgusu tüm platformun hareket tablosunu dolaşıyor: indeksle 9,4 sn, indekssiz 19,6 sn.
  - Gider kontrolü 2,5 sn.
  - Kiracı döngüsü 54 sıralı sorguyla 4,1 sn.
  - Staging'de otel başına toplam yaklaşık 16–27 sn. PERFORMANCE.md'deki 0,35 sn tek kiracılı veritabanında ölçülmüş.
  - `/api/integrity/check` için süre sınırı tanımlanmamış.
- **Etki:** Her yeni kiracı diğer tüm kiracıların kontrolünü yavaşlatıyor. 5 milyon satırdan sonra fonksiyon sınırlarını aşar.
- **Öneri:**
  - Önce otele daraltılmalı (otel hareketleri üzerinde bir CTE).
  - Gider kontrolü GROUP BY ile yeniden yazılmalı.
  - Kiracı kontrolleri tek bir UNION sorgusu olmalı ya da gece çalıştırılmalı.
- **Zorluk:** Küçük–orta.

### PERF-07 · ORTA · Eksik indeksler
- **Kanıt:** Yaklaşık 80 tek kolonlu yabancı anahtarın başta gelen bir indeksi yok. Önemli olanlar:
  - `GoodsReceiptItem.receiptId`
  - `StockCountLine.countId`
  - `RecipeIngredient.versionId`
  - `SaleLine.importId` ve `SaleLine.recipeVersionId`
  - `FifoConsumption.txId` ve `layerId`
  - `PurchaseOrderItem.orderId`
  - `InvoiceItem.invoiceId`
  - `Session.userId`
  - `StockTransaction.productId`
- **Eksik bileşik ve kısmi indeksler:**
  - `StockTransaction(hotelId, txDate DESC, createdAt DESC)`
  - `FifoLayer(warehouseId, productId, receivedAt) WHERE remainingQty > 0`
- **Etki:** Belge sayfaları (mal kabul, sipariş, fatura, sayım) diğer kiracılar büyüdükçe yavaşlıyor.
- **Öneri:** Tek bir migrasyonda, canlıda `CREATE INDEX CONCURRENTLY` ile eklenmeli.
- **Zorluk:** Küçük. Ayrıca bkz. DB-02.

### PERF-08 · ORTA · Ürün düzeyindeki sayfalar sayfalanmıyor
- **Kanıt:**
  - /inventory yaklaşık 102 ürün için 513 KB HTML üretiyor (satır başına yaklaşık 4,5 KB). /variance 398 KB, /purchasing 576 KB. Yalnızca /products sayfalanıyor.
  - Stres ölçeğinde (10 bin ürün, 5 bin reçete):
    - gösterge paneli 7,4–8,8 sn
    - sapma 2,8–4,3 sn
    - veri kalitesi 4,0–4,5 sn
    - değerlendirme 3,6–4,0 sn
    - reçete listesi 3,3–3,5 sn
  - Veri kalitesi, tüm reçeteleri tüm sürümleri ve satırlarıyla yüklüyor.
- **Etki:** 1.500–3.000 ürünlü bir otelde /inventory yaklaşık 7–14 MB HTML olur (gzip ile 1–2 MB; tahmin). Depodaki tabletlerde yavaş açılır. Giriş sayfası olan gösterge paneli birkaç saniye sürer.
- **Öneri:**
  - Sunucu tarafında sayfalama ya da sanal tablolar.
  - Toplamlar SQL'de hesaplanmalı.
  - Reçete başına yalnızca son onaylı sürüm yüklenmeli.
- **Zorluk:** Orta.

### PERF-09 · ORTA (yerel/Docker) / DÜŞÜK (Vercel) · CPU'ya bağlı istek işleme
- **Kanıt:** C tablosu: 10 paralel istekte gecikme yaklaşık 7 kat artıyor, işlem hacmi yalnızca 1,4–1,9 kat artıyor.
- **Etki:** Windows kurulum programı ve Docker tek bir Node süreci çalıştırıyor. Ay sonu yoğunluğunda bir dışa aktarma herkesi bekletir.
- **Öneri:**
  - PERF-01, PERF-05 ve PERF-08 uygulanmalı.
  - Dışa aktarmalar ayrı bir işçi iş parçacığına veya sürecine alınmalı.
  - Yerel kurulumda birden fazla süreç (cluster) düşünülmeli.

### DÜŞÜK önem ve bilgi
- **PERF-10:** Yönetim paketi rotasında hız sınırı yok; demoda 2,2 sn, stres ölçeğinde 63 sn sürüyor. Gece işi tüm otelleri tek fonksiyonda, 300 sn içinde sırayla işliyor.
  - Öneri: hız sınırı; gece işinin otel başına bölünmesi.
- **PERF-11:** Türkçe sözlüğün tamamı (93 KB gzip) her istemciye, İngilizce kullanıcılara da gidiyor.
  - Öneri: yalnızca istemci bileşenlerinin mesajları gönderilmeli ya da dil başına bölünmeli.
- **PERF-12:** 30 video (55 MB) `public/` altından `max-age=0` ile sunuluyor; her oynatmada yeniden doğrulanıyor ve her dağıtıma dahil ediliyor. Olumlu taraf: yalnızca yardım penceresi açılınca yükleniyorlar, faststart formatındalar ve aralık (Range) isteklerini destekliyorlar.
  - Öneri: `/videos/:path*` için `immutable` önbellek ya da Blob/CDN.
- **PERF-13:** Gösterge paneli `homeDashboard`, `gettingStarted` ve `integrationHealth` çağrılarını sırayla bekliyor.
  - Öneri: `Promise.all`.
- **PERF-14:** Staging şeması eski. PERFORMANCE.md'deki "tam tarama kalmadı" ve "bütünlük 0,35 sn" ifadeleri bu ölçümlerle çelişiyor. Demo ve staging verisinde tüketim POS satışından değil elle girilmiş; bu yüzden satış kaydı yolları ölçekte hiç test edilmemiş.
  - Öneri: güncel şemayla, POS kaynaklı tüketimle staging'in yeniden üretilmesi; bellek tepe değerlerinin belgelenmesi; bir performans regresyon işi.

## 3. Ölçek tahmini: 500 odalı otel, 12 ay (varsayım, doğrusal ekstrapolasyon)

**Varsayılan hacim:**
- 1.500–3.000 ürün
- 6–10 satış noktası
- Günde 2–5 bin POS satırı (yılda 0,7–1,8 milyon)
- Yılda otel başına yaklaşık 0,7–1 milyon stok hareketi

**Beklenen süreler:**

| İşlem | Tahmini süre |
|---|---|
| Gösterge paneli | 2–8 sn |
| Teorik ve Gerçekleşen | 1–4 sn |
| Stok hareketleri | 1–2 sn (5 bin üst sınırla) |
| Aylık çalışma kitabı / yönetim paketi | 60–140 sn, 4–7 GB |
| Gece POS aktarımı | gün başına 30–80 sn |
| 2–3 bin satırlık ay sonu sayım onayı | 40–60 sn ve üzeri |
| Bütünlük kontrolü | platform büyüdükçe onlarca saniye |

**Sonuç:**
- Aylık çalışma kitabı ve yönetim paketi 120 sn rota sınırını, Vercel bellek sınırını ve 60 sn'lik plan sınırlarını aşar. **Tam yıllık çalışma kitabı sunucusuz ortamda mümkün değil.**
- Gece POS aktarımı 120 sn işlem sınırı için risk.
- Ay sonu sayım onayı 60 sn işlem sınırı için risk.

## 4. Güçlü yönler
- Sapma hesabı satışları SQL'de reçete sürümüne göre topluyor ve sorgularını paralel çalıştırıyor.
- Dışa aktarma ilişkileri iç içe sorgular yerine bellekteki eşlemelerden kuruyor; Excel paketleyici büyük tabloları akış halinde yazıyor.
- Ana defter toplamları otel bazlı bileşik indekslerle kapsanıyor.
- Stok hareketleri ve tablo dışa aktarımında açık bir 5.000 satır sınırı ve kullanıcıya gösterilen bir uyarı var.
- Arka plan işleri atomik olarak sahipleniliyor, ömürleri sınırlı, kullanıcı başına sınırlı ve bayatlayınca temizleniyor.
- Sağlık uç noktası veritabanı gecikmesini raporluyor; statik dosyalar `immutable` önbellekli.

## 5. Doğrulanamayanlar
- Gerçek Vercel davranışı: soğuk başlatma, Neon gidiş-dönüş gecikmesi, bellek sınırları ve plana göre süre sınırları
- `pg_stat_statements` ve yavaş sorgu günlüğü (süper kullanıcı yetkisi yok)
- Satıştan gelen tüketim kayıtlarıyla stok hareketleri ve ayrıntı görünümü (yerel veritabanlarında böyle veri yok)
- Dışa aktarma sürerken diğer sayfaların gecikmesi (ortak kotayı korumak için ölçülmedi)
- Tarayıcı tarafı ölçümler (Lighthouse / Web Vitals)
- Güncel şemada gerçek 12 aylık veri (12 aylık rakamlar tahmin)
