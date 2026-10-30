# Mimari, Veritabanı ve İş Mantığı Denetimi (ARCHITECTURE_AUDIT)

**Kapsam:** `main` (39083c6).

**Ölçüm ortamları:**
- **EXPLAIN (ANALYZE):** demo veritabanında ve staging veritabanında (1,46 milyon stok hareketi, 540 bin satış satırı, 10 otel), salt okunur.
- **Eşzamanlılık ve tetikleyici denemeleri:** test veritabanında; tetikleyici denemeleri geri alınan bir işlem içinde.
- **Dışa aktarma boyutları:** yerel sunucuda.

Proje dosyaları değiştirilmedi.

## 1. Mimari bulgular

| No | Başlık | Önem |
|---|---|---|
| ARCH-01 | Dışa aktarmalar ve yüklemeler Vercel'in 4,5 MB fonksiyon yükü sınırını aşıyor | YÜKSEK |
| ARCH-02 | Üretim bağımlılıklarında güvenlik açıkları (next için yama düzeyinde düzeltme var) | YÜKSEK |
| ARCH-03 | Her Vercel dağıtımı, birleştirilmemiş dal önizlemeleri dahil, ortak canlı veritabanını migrate ediyor ve yeniden yazıyor | YÜKSEK |
| ARCH-04 | Gözlemlenebilirlik zayıf; arka plan hataları çoğunlukla sessiz | ORTA |
| ARCH-05 | Gece işi ve temizlik yalnızca Vercel'de var; Docker ve Windows kurulumlarında hiç çalışmıyor | ORTA |
| ARCH-06 | Çoğaltılmış iş mantığı farklı davranışlara ayrışmış | ORTA |
| ARCH-07 | Mevcut tasarımın sunucusuz (serverless) ölçek sınırları | ORTA |
| ARCH-08 | Bakım borcu: dev fonksiyon, ölü kod ve kolonlar, üretim paketinde demo kodu | DÜŞÜK |
| ARCH-09 | Katmanlama tutarsız: sayfalar ve rotalar doğrudan Prisma sorgusu yapıyor | DÜŞÜK |
| ARCH-10 | Merkezi, tipli yapılandırma yok; belgeler koddan kopmuş | DÜŞÜK |
| ARCH-11 | Sözlük dosyaları teslim turlarına göre ayrılmış; 215 anahtar sessizce farklı çeviriyle eziliyor | DÜŞÜK |

### ARCH-01 · YÜKSEK · Dışa aktarmalar ve yüklemeler Vercel'in 4,5 MB fonksiyon yükü sınırını aşıyor
- **Kanıt:**
  - Vercel belgesi (vercel.com/docs/functions/limitations): istek veya yanıt gövdesi en fazla 4,5 MB; aşılırsa 413 `FUNCTION_PAYLOAD_TOO_LARGE`.
  - Dosyalar fonksiyondan tek parça tampon olarak dönüyor:
    - `src/app/api/export/workbook/route.ts:15`
    - `export/jobs/[id]/download/route.ts:9` (arka plan dışa aktarması da indirmeyi fonksiyon üzerinden yapıyor)
    - `export/full-cost/route.ts:21`
    - `export/[section]`
    - `table-export/[key]`
  - **Ölçüm (küçük demo oteli, 2 ay, yaklaşık 7.500 defter satırı):**

    | Çıktı | Boyut |
    |---|---|
    | `GET /api/export/full-cost` JSON | **6,95 MB** |
    | TSV | 3,37 MB |
    | `.xlsm` | 2,0 MB |
    | Yönetim paketi PDF'i | 60 KB |

  - `docs/PERFORMANCE.md`, 13 aylık staging için 36,3 MB'lık bir çalışma kitabı kaydetmiş.
  - İstek tarafında da aynı uyumsuzluk var: `MAX_BODY` 5 MB, veri alım sınırı 10 MB; ikisi de 4,5 MB'ın üstünde.
- **Doğrulama:** orta ölçekli bir otelde, Vercel önizlemesinde Excel sayfasında 2–3 aylık aralık seçilir → 413.
- **Etki:** Vercel'deki SaaS kurulumunda, gerçek otellerde aylık Excel maliyet raporu, Excel yenileme makrosu ve büyük CSV çıktıları başarısız olur. Bunlar maliyet kontrolörünün ve genel müdürün temel çıktıları; arka plan dışa aktarması da çözüm değil.
- **Öneri:**
  - Üretilen dosyalar nesne depolamaya (Vercel Blob / S3) yazılmalı ve kısa ömürlü imzalı bir adres döndürülmeli. ExportJob yalnızca üst veri tutmalı.
  - TSV/CSV akış (stream) olarak gönderilmeli.
  - Vercel'de `MAX_BODY` 4,5 MB'ın altına çekilmeli.
  - Sınır VERCEL.md'de belgelenmeli.
- **Zorluk:** Orta.
- **Güven:** Boyutlar ölçüldü; sınır Vercel belgesinden doğrulandı. Sıkıştırılmış veya akış yanıtların da 413 alıp almadığı bir önizleme dağıtımında doğrulanmalı.

### ARCH-02 · YÜKSEK · Üretim bağımlılıklarında güvenlik açıkları
- **Kanıt:** `npm audit --omit=dev` 10 paket buluyor (1 kritik, 6 yüksek, 3 orta).
  - `next@15.5.27`: GHSA-2464-fhr4-w9xw (SVG ile görsel optimizasyonunda kimlik doğrulamasız uzaktan kod çalıştırma) ve GHSA-p3m5-59mp-jv5r. Düzeltme **15.5.28**'de, yani yama düzeyinde.
  - `sharp@0.34.5`, `nodemailer@10.0.16` (alıcı enjeksiyonu; 10.1.4+ düzeltiyor), `zod@3.25.76` (zod 4 gerekiyor), `exceljs` → `uuid`, `prisma` → `deepmerge-ts`.
  - Eski ana sürümler: Next 16, Prisma 7, zod 4, vitest 5, eslint 10, Tailwind 4.
  - CI'da `npm audit` adımı ve Dependabot yok.
- **Etki:** Çok kiracılı SaaS'ta uzaktan kod çalıştırma veya hizmet reddi riski; yönlendirilebilir sipariş e-postaları.
- **Öneri:**
  - Hemen: `next@15.5.28`, `nodemailer@^10.3.1`, `react@19.1.10`, `postcss` yaması.
  - Sonra: zod 4 ve Prisma 7 geçişlerinin planlanması.
  - CI'a `npm audit --omit=dev --audit-level=high` ve Dependabot eklenmesi.
  - Görsel kullanılmadığı için `images: { unoptimized: true }`.
- **Zorluk:** Küçük (yamalar) / Büyük (ana sürümler).
- **Ayrıca bkz.** SECURITY_AUDIT SEC-06.

### ARCH-03 · YÜKSEK · Her Vercel dağıtımı canlı veritabanını migrate ediyor ve yeniden yazıyor
- **Kanıt:**
  - `vercel-build`, `next build`'den önce `prisma migrate deploy` ve `recipes-refreeze` çalıştırıyor.
  - `docs/VERCEL.md` §2, Neon veritabanının "tüm ortamlara (Production, Preview, Development)" bağlanmasını söylüyor.
  - `recipes-refreeze.ts`, her derlemede tüm kiracıların onaylı reçete maliyet görüntülerini yeniden hesaplıyor. Herhangi bir kiracıda hata olursa dağıtımı durduruyor.
  - Docker da her başlatmada migrate ediyor.
  - Migrasyondan önce hiçbir yerde yedek alınmıyor.
- **Doğrulama:** Yeni bir migrasyon içeren bir dal gönderilir; Vercel önizlemesi bunu inceleme ve birleştirmeden önce canlı veritabanına uygular.
- **Etki:**
  - Test edilmemiş şema veya veri değişiklikleri canlı kiracıların defterlerine ulaşır.
  - Tek bir oteldeki hatalı bir reçete tüm sürümleri durdurur.
  - Onaylı maliyet görüntüleri onaysız ve iz bırakmadan değişir.
- **Öneri:**
  - Her ortam için ayrı veritabanı veya Neon dalı.
  - `migrate deploy` yalnızca `VERCEL_ENV=production` iken çalışmalı.
  - Reçete yenilemesi açık ve denetim izi bırakan, tek seferlik bir işe taşınmalı.
  - Canlı migrasyondan önce yedek veya anlık görüntü alınmalı.
- **Zorluk:** Küçük–orta.
- **Güven:** Kod ve belgeyle doğrulandı; canlı Vercel projesinde doğrulanmadı.

### ARCH-04 · ORTA · Gözlemlenebilirlik zayıf; arka plan hataları çoğunlukla sessiz
- **Kanıt:**
  - Yapılandırılmış günlükçü yalnızca 6 yerde çağrılıyor; hâlâ 5 `console.error` var (export-jobs, ingest, setup, error.tsx).
  - `runNightly` otel başına hataları yalnızca yanıt gövdesinde topluyor; Vercel cron bu gövdeye bakmıyor ve hiçbir şey günlüğe yazılmıyor.
  - `runExportJob` hataları yalnızca iş satırına yazıyor.
  - `log.ts notify()` webhook'u beklenmeyen bir `fetch` ile ve `after()` olmadan gönderiyor. Sunucusuz ortamda yanıt döndükten sonra bildirim kaybolabilir (varsayım).
  - Ölçüm, izleme (tracing) veya iş tazeliği kontrolü yok.
- **Etki:** Otomatik tedarikçi siparişleri, arka plan dışa aktarmaları ve aktarım sonrası siparişler günlerce kimse fark etmeden başarısız olabilir.
- **Öneri:**
  - Tüm arka plan yolları `log.error` ile otel ve istek kimliğini yazmalı.
  - Gece işi bir otel bile başarısız olsa 2xx dışı yanıt dönmeli ve günlüğe yazmalı.
  - Webhook `after()` ile gönderilmeli.
  - `/api/health` "son başarılı çalıştırma" bilgisini göstermeli.
- **Zorluk:** Küçük.

### ARCH-05 · ORTA · Gece işi ve temizlik yalnızca Vercel'de var
- **Kanıt:**
  - Tek zamanlayıcı `vercel.json` içindeki `crons`. Kurulum programında, Docker'da veya kaynak kodda zamanlayıcı yok.
  - Kurulum programı `CRON_SECRET` ayarlamıyor; bu yüzden gece işi rotası kapalı.
  - Süresi dolan oturumları, dışa aktarma dosyalarını, entegrasyon çalıştırmalarını ve hız sınırı satırlarını silen bir iş yok (bkz. DB-07).
- **Etki:** Yerel kurulumlu otellerde otomatik siparişlerin yedek yolu çalışmıyor; siparişler yalnızca botun raporu gelirse gidiyor. Tablolar sınırsız büyüyor.
- **Öneri:** Standalone ve Docker için işlem içi bir zamanlayıcı (ör. veritabanı danışma kilidiyle `instrumentation.ts`) ya da rotayı üretilmiş bir `CRON_SECRET` ile çağıran bir Windows zamanlanmış görevi.
- **Zorluk:** Küçük–orta.

### ARCH-06 · ORTA · Çoğaltılmış iş mantığı farklı davranışlara ayrışmış
- **Geçerli reçete sürümü üç yerde seçiliyor:**
  - `recipes.ts:89 effectiveAt`, o tarihi kapsayan sürüm yoksa güncel onaylı sürüme düşüyor.
  - `sales.ts:152 theoreticalFor` ve `comps.ts:142 recipeRequirements` bu geri dönüşü yapmıyor.
  - Sonuç: bir sürümün başlangıç tarihinden önceki tarihlerde reçete sayfası maliyet gösterirken, satış satırı teorik maliyet ve tüketim almıyor; ikramlar da malzeme almıyor.
- **Ters kayıt tarihleri farklı:**
  - `comps.ts:283 deleteComp` iş tarihini kullanıyor.
  - `sales.ts:242 rollbackSalesImport`, `reverseMovement`'ı tarihsiz çağırıyor, bu yüzden ters kayıt bugünün tarihini alıyor.
  - Geçen ayın aktarımı geri alınırsa satış satırları M ayında silinirken stok M+1 ayında geri dönüyor; iki ayın sapma ve tüketim rakamları da bozuluyor.
- **Belge numaralandırma 6 yerde ayrı yazılmış**, çoğu "sayı+1" (bkz. DB-01).
- **Denetim kaydı:** 9 dosyada 20 doğrudan `auditLog.create` çağrısı `audit()` yardımcısını atlıyor; şirket kimliği kuralları farklı.
- **Etki:** Gıda maliyeti yüzdeleri ekranlar ve aylar arasında tutmayabilir; temel sapma raporuna olan güven zedelenir.
- **Öneri:**
  - `domain/` altında açık politikalı tek bir `effectiveVersion()`.
  - Satış geri alma işlemine orijinal iş tarihinin geçirilmesi.
  - Tek bir numaralandırma servisi.
  - Tüm denetim kayıtlarının `audit()` üzerinden yazılması.
- **Zorluk:** Küçük–orta.

### ARCH-07 · ORTA · Sunucusuz ölçek sınırları
- **Kanıt:**
  - `buildFullCostExport` (yaklaşık 650 satır) dönemin tüm bölümlerini aynı anda belleğe yüklüyor. Belgelenen ölçüm: 455 bin satır 49 sn; çalışma kitabı 82 sn.
  - Defter bölümü `take: 200_000` ile sessizce kesiliyor; kesildiğini gösteren bir işaret yok.
  - Dosyalar Postgres'te bytea olarak tutuluyor. Süresi dolanlar yalnızca o otelin kullanıcısı bir sonraki işi listeleyince temizleniyor.
  - `docs/VERCEL.md` `connection_limit=1` öneriyor. Uzun işlemlerle (`inTx` 30 sn, mal kabul 60 sn) ve `after()` dışa aktarmalarıyla birlikte bu, havuz zaman aşımlarına yol açabilir (varsayım).
  - Gece işi tüm otelleri 300 sn içinde sırayla işliyor.
- **Etki:** Büyük otellerde ve zincirlerde ay sonu dışa aktarmaları başarısız olur ya da sessizce kesilir. Eşzamanlı kullanımda gecikme sıçramaları olur. Gece işi 100 otelin üstüne ölçeklenmez.
- **Öneri:**
  - Dışa aktarmalar akış veya sayfalama ile yapılmalı ve kesinti işaretlenmeli.
  - Nesne depolama kullanılmalı.
  - Havuz boyutu 1'den büyük tutulmalı (pooler ile) ya da işlemler kısaltılmalı.
  - Gece işi otel başına bölünmeli.
- **Zorluk:** Orta–büyük.

### ARCH-08 · DÜŞÜK · Bakım borcu
- `export.ts` 100 KB; `buildFullCostExport` yaklaşık 650 satır ve 400 karakteri aşan 55 satır içeriyor.
- `src/server/demo/generate.ts` 114 KB ve üretim paketinde yer alıyor.
- Ölü kod: `startExportJob`.
- Ölü kolonlar: `Product.yieldPct`, `RecipeIngredient.yieldPct/wastePct`, `RecipeVersion.productionLossPct/packaging/labor/energy/otherCost`.
- Servisi olmayan modeller: Attachment, Notification.
- **Olumlu taraf:** servis import döngüsü yok, domain katmanı saf, TODO yok, yalnızca 1 `eslint-disable`.
- **Öneri:** dışa aktarmayı bölüm oluşturuculara ayırmak, ölü kod ve kolonları migrasyonla kaldırmak, demo üreticisini ayrı bir giriş noktasına taşımak.

### ARCH-09 · DÜŞÜK · Katmanlama tutarsız
- 51 sayfanın 25'i ve 8 rota doğrudan `prisma.<model>.find…` çağırıyor (ör. `inventory/ledger/page.tsx:34`, `api/receipts/route.ts`). Kiracı kapsamı burada servis `authorize()` ile değil, elle yazılmış `hotelId` süzgeçleriyle sağlanıyor.
- **Öneri:** okumalar servis fonksiyonlarına taşınmalı; `src/app` altında `@/server/db` içe aktarmasını yasaklayan bir lint kuralı eklenmeli.

### ARCH-10 · DÜŞÜK · Yapılandırma yönetimi
- Yaklaşık 45 ortam değişkeni farklı dosyalarda doğrudan okunuyor.
- `SESSION_SECRET` zorunlu olarak belgelenmiş ve kurulum programı ayarlıyor, ama uygulama **hiç okumuyor**.
- Okunan ama `.env.example`'da olmayan değişkenler: `INSECURE_COOKIES`, `DATABASE_URL_UNPOOLED`, `DEFAULT_LOCALE`, `NEXT_PUBLIC_I18N_STRICT`, `PRISMA_LOG`, `HOTELCOST_ENV`, `NEXT_OUTPUT`, `ALLOW_DEMO_DATA`, `APP_ENV`.
- `MAIL_TRANSPORT=memory` üretimde e-postayı sessizce "başarılı" gösteriyor.
- **Öneri:**
  - Açılışta zod ile doğrulanan bir `config.ts`.
  - `SESSION_SECRET` ya kaldırılmalı ya da kullanılmalı.
  - Tüm değişkenler belgelenmeli.
  - Üretimde `memory` taşıyıcısı reddedilmeli.

### ARCH-11 · DÜŞÜK · Sözlük düzeni
- 28 sözlük dosyası teslim turlarına göre ayrılmış (`r2a`…`r3f`, `seca`…`secd`, `denetim`).
- 215 anahtar çelişkili; son yüklenen kazanıyor. Ayrıntı için UI_UX_AUDIT UX-01'e bakın.
- Sunucu mesajları, tüm şablonlara karşı düzenli ifade eşleşmesiyle çevriliyor.
- **Öneri:** sözlükler alanlarına göre birleştirilmeli; çelişkili tekrarlarda CI başarısız olmalı; sunucu hataları için kararlı mesaj kodları kullanılmalı.

## 2. Veritabanı bulguları

| No | Başlık | Önem |
|---|---|---|
| DB-01 | Eşzamanlı yazmalar kilitlenme, numara çakışması ve dönem oluşturma yarışıyla başarısız oluyor | ORTA |
| DB-02 | Sık kullanılan alt tablo ve yabancı anahtar sorgularında indeks eksik; FIFO tabloları tüm kiracılar boyunca taranıyor | ORTA |
| DB-03 | Açılış bakiyeleri her raporda tüm defter geçmişinden yeniden hesaplanıyor | ORTA |
| DB-04 | Kiracı tutarlılık tetikleyicileri tüm otel referanslarını kapsamıyor; belge kapsamı abartıyor | ORTA |
| DB-05 | Yedekleme ve geri yükleme boşlukları | ORTA |
| DB-06 | Faturalama migrasyonu mevcut her kiracı için 30 günlük geri sayım başlatıyor | ORTA |
| DB-07 | Operasyonel tablolarda saklama süresi ve temizlik yok | DÜŞÜK |
| DB-08 | Migrasyon uygulamalarında riskler | DÜŞÜK |
| DB-09 | Silme davranışı tutarsız; defter satırları silinmiş kaynak belgeleri gösteriyor | DÜŞÜK |

### DB-01 · ORTA · Eşzamanlı yazmalar kilitlenme, numara çakışması ve dönem oluşturma yarışıyla başarısız oluyor (testle doğrulandı)
- **Numara çakışması:**
  - 20 eşzamanlı mal kabulden **17'si** belge numarası benzersizlik hatasıyla (P2002) başarısız oldu; 10 tek satırlık mal kabulde 8'i.
  - Neden: numara `count()+1` ile üretiliyor (`purchasing.ts:52`, `counts.ts:28`).
- **Kilitlenme (deadlock):**
  - İki eşzamanlı çok satırlı kayıt ürünleri ters sırada işlediğinde, 10 denemede **9 kilitlenme** (`40P01`) oluştu.
  - `ledger.ts:lockBalance` satırları gelen sırayla kilitliyor.
  - `errorResponse` kilitlenmeyi eşlemiyor, bu yüzden kullanıcı **500 "Beklenmeyen hata"** görüyor.
- **Dönem oluşturma:** yeni bir ayın ilk eşzamanlı kayıtları `CostPeriod (hotelId, code)` benzersizlik hatası alıyor.
- **Tedarikçi fatura no:** benzersizliği yalnızca uygulamada kontrol ediliyor (`findFirst` + insert). Numaralandırma düzeltildiğinde yarış ortaya çıkacak.
- **Genel:** yalıtım seviyesi READ COMMITTED; `inTx` yeniden deneme yapmıyor.
- **Etki:** Yoğun saatlerde (depo mal kabul yaparken bot satış veya fatura aktarırken) kullanıcılar sahte "tekrarlanan kayıt" veya "beklenmeyen hata" mesajları alır ve belgeleri yeniden girmek zorunda kalır. Bot parçaları başarısız olabilir.
- **Öneri:**
  - Numaralar için otel başına sıra (`UPDATE … RETURNING`) ya da danışma kilidi.
  - Satırlar (depo, ürün) sırasına göre kilitlenmeli.
  - `inTx` kilitlenme ve serileştirme hatalarında yeniden denemeli.
  - Dönemler `INSERT … ON CONFLICT DO NOTHING` ile oluşturulmalı.
  - `(hotelId, supplierId, invoiceNo)` için kısmi benzersiz indeks eklenmeli.
- **Zorluk:** Küçük–orta.

### DB-02 · ORTA · Sık kullanılan sorgularda eksik indeksler
- **Ölçüm:**

  | Sorgu | Kod | Sonuç |
  |---|---|---|
  | `FifoConsumption.txId` (tabloda hotelId yok) | her transfer girişi | tam tablo taraması, 21.729 satır |
  | `FifoLayer.sourceTxId` | son kullanma tarihli her mal kabul satırı, ters kayıt | tam tablo taraması |
  | `SaleLine.importId` | geri alma; 3 sorgu otel kapsamsız (`sales.ts:235/238/243`) | staging 540 bin satır: **4,8 sn soğuk** / 55 ms ılık |
  | `GoodsReceiptItem.receiptId` | her `include: { items }` | staging: fiş başına 20 ms |

- **İndeksi olmayan diğer alanlar:** `StockCountLine.countId`, `RecipeIngredient.versionId`, `InvoiceItem.invoiceId`, `StockTransaction.transferGroup`, `Session.userId`.
- **Aylık maliyet toplamları:** `(hotelId, txDate)` indeksi daha uygun olur.
- **Etki:** FIFO sorguları otel bazında kapsanmadığı için maliyetleri platformun toplam verisiyle büyüyor. Kayıtlar ve geri almalar, satır kilidi tutan işlemlerin içinde yavaşlıyor; bu da DB-01'i büyütüyor.
- **Öneri:**
  - Yukarıdaki alanlara `@@index` eklenmeli; büyük tablolar için elle yazılmış migrasyonda `CREATE INDEX CONCURRENTLY` kullanılmalı.
  - Mümkün olan sorgulara `hotelId` eklenmeli.
- **Zorluk:** Küçük.

### DB-03 · ORTA · Açılış bakiyeleri her raporda tüm geçmişten hesaplanıyor
- **Kanıt:**
  - `variance.ts:112`, `inventory.ts:115`, `counts.ts:260` ve `operations.ts:247` açılış bakiyesini `txDate < from` ile tüm geçmiş üzerinden topluyor.
  - Dönem sonu bakiye görüntüsü tutan bir tablo yok.
  - Staging'deki en yoğun otelde: 143 bin satır okunuyor, geçici dosyaya taşmayla 119 ms.
- **Etki:** Rapor süresi geçmişin uzunluğuyla doğrusal artıyor; 5 yılda sorgu başına yaklaşık 0,5 sn ve sayfa başına birkaç sorgu.
- **Öneri:** Dönem kapanışında depo × ürün kapanış bakiyeleri saklanmalı; açılış, son kapalı dönem + fark olarak hesaplanmalı.
- **Zorluk:** Orta.

### DB-04 · ORTA · Kiracı tutarlılık tetikleyicileri her referansı kapsamıyor (testle doğrulandı)
- **Kanıt:**
  - `docs/MULTI_TENANCY.md` "otel kapsamlı her yabancı anahtarda" tetikleyici olduğunu söylüyor. Gerçekte 40 tablo kapsanıyor.
  - Kapsam dışı kalanlar:
    - AutoOrderRule (ürün, tedarikçi)
    - CompLine
    - AutoOrderSend.ruleId
    - SaleLine.recipeVersionId
    - BuffetLine.recipeVersionId
- **Deneme (geri alınan işlem içinde):** 1. otelin AutoOrderRule kaydına 2. otelin ürünü ve tedarikçisi bağlandı ve **kabul edildi**. Aynı deneme WasteRecord'da TENANT_MISMATCH ile reddedildi.
- **Hiç yabancı anahtarı olmayan otel kolonları:**
  - CoverCount.departmentId
  - IntegrationKey / Run / Request, Attachment, Notification, DemoScenario
  - AutoOrderSend.hotelId, WasteRecord.stockTxId
  - Expense.periodId / costCenterId, PurchaseRequest.departmentId
  - CostTransaction.productId / recipeId / categoryId
  - Report.periodId, AllocationRun.periodId, CompLine.stockTxId
- **Not:** Uygulama kontrolleri var; bu bilinen bir açık değil, derinlemesine savunmadaki bir boşluk.
- **Öneri:**
  - AutoOrderRule ve CompLine için tetikleyiciler; sürüm→reçete otel kontrolü.
  - Eksik yabancı anahtarlar eklenmeli ya da bilinçli olanlar belgelenmeli.
  - Belge düzeltilmeli.
- **Zorluk:** Küçük.

### DB-05 · ORTA · Yedekleme ve geri yükleme boşlukları
- **Kanıt (Postgres):**
  - `20261023091000_integrity_hardening` migrasyonu veritabanını `ALTER DATABASE … SET timezone` ile UTC'ye sabitliyor (ay sonu hatasının düzeltmesi).
  - `scripts/ops/backup.sh`, `pg_dump --format=custom`'ı `--create` olmadan çalıştırıyor; `restore.sh` de `-C` kullanmıyor.
  - Doğrulandı: böyle bir döküm saat dilimi ayarını içermiyor.
  - Sonuç: UTC olmayan bir sunucuya geri yükleme, ay sonu tarih hatasını sessizce geri getiriyor. `verify-restore.ts` saat dilimini kontrol etmiyor.
- **Kanıt (Windows yedeği, `installer/setup.ts:364`):**
  - Yalnızca elle alınıyor; hizmeti durdurup `pgdata` klasörünü **aynı diske** kopyalıyor.
  - Zamanlama, saklama süresi, **geri yükleme komutu** ve sağlama toplamı yok.
  - Veritabanı şifresini içeren `config.json` her yedek klasörüne kopyalanıyor.
- **Kanıt (Vercel):** Neon PITR'a güveniliyor; saklama süresi plana bağlı ve doğrulanmadı.
- **Etki:** Otel bilgisayarında disk arızası veya fidye yazılımı tüm maliyet geçmişini götürebilir. Bir geri yükleme, ay sonu kayıtlarını sessizce yanlış döneme kaydırabilir.
- **Öneri:**
  - `restore.sh` UTC ayarını yeniden uygulamalı ve `verify-restore` saat dilimini doğrulamalı.
  - Windows'ta: saklama süreli, zamanlanmış `pg_dump`; ikinci bir konuma kopya; belgelenmiş bir geri yükleme komutu; gizli bilgilerin yedek klasöründen çıkarılması.
  - PITR saklama süresi belgelenmeli.
- **Zorluk:** Küçük–orta.

### DB-06 · ORTA · Faturalama migrasyonu mevcut her kiracı için 30 günlük geri sayım başlatıyor
- **Kanıt:**
  - `20261023090000_billing`, `Organization.trialEndsAt` alanını `now() + 30 gün` varsayılanıyla ekliyor; paket varsayılanı BASIC.
  - Deneme süresi bitip `paidThrough` yoksa durum SÜRESİ DOLDU oluyor ve kiracı salt okunura düşüyor.
  - Bir platform şirketi varsa faturalama açık sayılıyor.
- **Etki:** Bir SaaS kurulumunda, ödeme yapan müşteriler dahil, önceden var olan her kiracı dağıtımdan 30 gün sonra salt okunur olur ve STANDARD/PREMIUM modülleri kapanır; meğer ki operatör ödemeleri kaydetsin veya deneme sürelerini uzatsın. **Kasım sonundaki canlı geçiş için doğrudan risk.**
- **Öneri:**
  - Mevcut kiracılar için `paidThrough` ve paketi ayarlayan bir veri migrasyonu ya da bir operatör kontrol listesi.
  - Veya bu yapılana kadar faturalama zorlamasını kapatan bir anahtar.
  - Süresi dolacak kiracıları listeleyen bir operatör uyarısı.
- **Zorluk:** Küçük.
- **Güven:** Kod okumayla doğrulandı. Canlı veritabanında platform şirketi olup olmadığı bilinmiyor.

### DB-07 · DÜŞÜK · Saklama süresi ve temizlik yok
- **Ölçüm:** Süresi dolan oturumlar hiç silinmiyor (`hotelcost_demo` veritabanındaki 335 oturumun 335'i süresi dolmuş).
- ExportJob satırları sonsuza kadar duruyor.
- RateLimitBucket yalnızca olasılıksal olarak temizleniyor.
- IntegrationRun ve Alert sınırsız büyüyor.
- AuditLog tetikleyiciyle değiştirilemez; KVKK silme talepleri için saklama veya anonimleştirme yolu yok.
- **Öneri:**
  - Gece temizlik işi (ARCH-05 ile birlikte).
  - Belgelenmiş bir saklama politikası.
  - Kişisel verinin denetim izinde takma adla tutulması.

### DB-08 · DÜŞÜK · Migrasyon uygulamalarında riskler
- **Yedeksiz veri yeniden yazan migrasyonlar:**
  - `20261007090000_recipe_raw_quantities`: reçete donma tetikleyicisini kapatıp onaylı satırlardaki verim ve fire yüzdelerini siliyor.
  - `20261009110000`: tüm ürünleri FIFO'ya geçiriyor.
  - `20261010091000`: FIFO katmanlarını düzeltiyor.
- **İndeksler `CONCURRENTLY` olmadan oluşturuluyor.** Örneğin faturalama migrasyonundaki `CostTransaction_stockTxId_idx`, en büyük defter tablosunda (staging'de 742 bin satır / 351 MB) yazmaları bloke ediyor.
- **Ortamlar farklı Postgres sürümleri kullanıyor:** CI 17, Docker 16, kurulum programı "16.14.0-beta.17".
- **Öneri:**
  - Bir migrasyon kontrol listesi: yedek, büyük tablolarda `CONCURRENTLY`, veri düzeltmeleri için denetim izli betikler.
  - Postgres sürümleri hizalanmalı; kurulum programında kararlı bir Postgres derlemesi kullanılmalı.

### DB-09 · DÜŞÜK · Silme davranışı tutarsız
- Reçeteler ve sayımlar yumuşak siliniyor.
- İkram kayıtları (`comps.ts:284`), geri alınan satış satırları (`sales.ts:243`) ve kahvaltı fire kayıtları (`buffet.ts:368`) ise kalıcı olarak siliniyor. Değiştirilemez defter satırları hâlâ bu belgeleri gösteriyor; defterden kaynak belgeye geçiş kopuyor.
- `approvals.ts:20` içinde bir yumuşak silme süzgeci eksik.
- **Öneri:** Kaynak belgeler kalıcı olarak silinmemeli; bunun yerine durumları GERİ ALINDI / SİLİNDİ olarak işaretlenmeli.

## Ölçüm özeti

| Sorgu / yol | Veritabanı | Sonuç |
|---|---|---|
| Açılış bakiyesi (13 ay) | staging, otelde 155.884 hareket | 119 ms, 143 bin satır, geçici dosyaya taşma |
| Ay içi defter toplamı | staging | 40 ms (indeksli) |
| Satış satırı importId ile (geri alma) | staging, 540.904 satır | paralel tam tarama: 4,8 sn soğuk / 55 ms ılık |
| Mal kabul satırı receiptId ile | staging, 122.769 satır | tam tarama, 20 ms |
| Denetim izi listesi (200 kayıt) | staging | 117 ms soğuk |
| Eşzamanlı 20 mal kabul | test | 17 numara çakışması |
| Ters sıralı kayıtlar (10 tur) | test | 9 kilitlenme → HTTP 500 |
| Dışa aktarma boyutları (demo oteli, 2 ay) | :3300 | JSON 6,95 MB, TSV 3,37 MB, xlsm 2,0 MB, PDF 60 KB |

## 3. İş mantığı (SaaS iş kuralları)

Hesaplamalar kuruşuna kadar tutarlı (QA_AUDIT bölüm 2). Bulgular aritmetik değil, kontrol tasarımı, abonelik modeli ve eksik özelliklerle ilgili.

### BIZ-01 · YÜKSEK · Reçete onayı atlanabiliyor: reçeteyi düzenlemek onu anında onaylıyor
- **Kanıt:** `src/server/services/recipes.ts` `editRecipe` (s.314), yalnızca `recipe:manage` yetkisiyle `freezeAndApprove` çağırıyor (`PUT /api/recipes/[id]`). `approveVersion` ise `recipe:approve` istiyor. İki yolda da "oluşturan ≠ onaylayan" kontrolü yok. Şef, kahvaltı şefi ve pastane şefinde `recipe:manage` var, `recipe:approve` yok.
- **Doğrulama:** `chef@test.local` olarak `PUT /api/recipes/{id}` ile malzeme miktarları düşürülür. Yeni sürüm ONAYLANDI olarak oluşur, `approvedById` şefin kendisi olur ve onay talebi açılmaz.
- **Etki:** Reçete, teorik maliyetin standardıdır. Mutfak, kendisinin ölçüldüğü standardı değiştirebiliyor. Bu durumda sapma ve "açıklanamayan" tutarları kontrol aracı olmaktan çıkıyor; `recipe:approve` yetkisinin ve reçete sayfasındaki onay düğmesinin anlamı kalmıyor.
- **Öneri:**
  - `editRecipe`, kullanıcıda `recipe:approve` yoksa ONAY BEKLİYOR durumunda bir sürüm oluşturmalı. İsteğe bağlı olarak otel bazında "reçete düzenlemeleri otomatik onaylansın" anahtarı eklenebilir.
  - `approveVersion` içine "oluşturan ≠ onaylayan" kontrolü konmalı.
- **Zorluk:** Orta. Kod yorumu bunun bilinçli bir ürün kararı olduğunu gösteriyor; **ürün sahibinin kararı gerekiyor.**

### BIZ-02 · YÜKSEK · Satın alma siparişi ve bütçede görev ayrılığı yok; rol şablonları bağdaşmayan görevleri birleştiriyor
- **Kanıt (onay akışı):** `purchasing.ts approvePurchaseOrder` (s.89) ve `planning.ts approveBudget` (s.102), siparişi veya bütçeyi oluşturanla onaylayanı karşılaştırmıyor. Buna karşılık genel onaylar (`approvals.ts decideApproval`) "kendi talebinizi onaylayamazsınız" kontrolünü doğru yapıyor.
- **Kanıt (rol şablonları, `permissions.ts`):**
  - `purchasing_manager`: tedarikçi tanımlama, ürün tanımlama, sipariş, sipariş onayı, fiyat görme ve mal kabul aynı rolde. Tek kişi tedarikçi açıp sipariş verebilir, onaylayabilir ve mal kabul yapabilir.
  - `cost_controller`: yönetim yetkileri dışında her şey, yani satın alma, mal kabul, stok düzeltme, onay verme ve dönem açıp kapama. Kontrol fonksiyonu aynı zamanda operasyon yapıyor.
  - `accounting_manager`: bütçeyi hem hazırlıyor hem onaylıyor; dönemi tek başına yeniden açıp tekrar kapatabiliyor.
- **Doğrulama:** `purchasing@test.local` olarak sipariş oluşturulup aynı kullanıcıyla onaylanır; onay başarılı olur.
- **Etki:** Klasik satın alma suistimali riski. Bağımsız denetim bunu bulgu olarak yazar; otel zincirleri "talep eden ≠ onaylayan" bekler.
- **Öneri:**
  - Sipariş, bütçe ve reçete onayına "oluşturan ≠ onaylayan" kontrolü (küçük).
  - Satın alma müdüründen sipariş onayı ya da mal kabul yetkisi alınmalı.
  - Maliyet kontrolörü görüntüleme, onay ve kapanışla sınırlanmalı.
  - Amaçlanan görev ayrılığı matrisi belgelenmeli (orta).

### BIZ-03 · YÜKSEK · "Şu tutarın üstündeki düzeltmeler onaya gitsin" ayarı hiç uygulanmıyor
- **Kanıt:**
  - `Hotel.adjustmentApprovalValue` yönetim ekranında düzenlenebiliyor ve dışa aktarmada görünüyor, ama hiçbir kayıt kodu bu değeri okumuyor.
  - `inventory.ts postUserMovement`, ADJUSTMENT_IN / ADJUSTMENT_OUT / OPENING hareketlerini tutarı ne olursa olsun anında işliyor. Giriş hareketlerinde birim maliyeti kullanıcı seçiyor. Bu, `inventory:adjust` yetkisi olan herkes için geçerli (yönetici, maliyet kontrolörü, Yiyecek-İçecek müdürü).
- **Doğrulama:** Eşik 1.000 yapılır. Yiyecek-İçecek müdürü 50.000 ₺'lik bir çıkış düzeltmesi girer; hareket işlenir, onay kaydı oluşmaz.
- **Etki:**
  - Yöneticiler büyük düzeltmelerin onaya gittiğini sanıyor, ama gitmiyor.
  - Sayımlar her zaman onaya gidiyor; aynı stok farkı düzeltme olarak onaysız girilebiliyor.
  - Rastgele birim maliyetle girilen bir giriş düzeltmesi FIFO ve ortalama maliyeti de kaydırıyor.
  - Ayrıca denetim kaydı, işlem (transaction) dışında yazılıyor; ikisi arasında bir çökme olursa hareket denetim kaydı olmadan kalır.
- **Öneri:** Eşiğin üstündeki düzeltmeler fire gibi onaya gitmeli ve onaylanınca işlenmeli. Hareket ile denetim kaydı tek işlemde yazılmalı.
- **Zorluk:** Orta.

### BIZ-04 · ORTA · Çoklu para birimi modellenmiş ama işlenmiyor
- **Kanıt:**
  - `postGoodsReceipt` tedarikçinin para birimini alıyor; kur girilmezse 1 kabul ediyor ve para birimini otelin temel para birimiyle karşılaştırmıyor.
  - Hiçbir ekran kur göndermiyor.
  - 9 kolon varsayılan olarak `"TRY"`. `CostTransaction.currency` hiç doldurulmuyor.
- **Etki:** EUR'lu bir tedarikçi faturası 1:1 temel para birimiyle işlenir; stok ve gıda maliyeti yaklaşık 35 kat hatalı çıkar. Temel para birimi EUR olan bir otelde tüm maliyet satırları TRY etiketli olur. Demo verisi tümüyle TRY olduğu için bu şu an görünmüyor.
- **Öneri:** Ya para birimi temel para biriminden farklı bir mal kabul, kur girilmeden reddedilmeli (forma kur alanı eklenmeli), ya da sistemin tek para birimli olduğu açıkça belirtilip tedarikçi ve mal kabul para birimi otelinkine kilitlenmeli.
- **Zorluk:** Orta.

### BIZ-05 · ORTA · Paket değişikliği ödeme anında geçerli oluyor, kıst hesap yok; süresi geçen kiracıların dönemleri adil değil
- **Kanıt:** `billing.ts markBillingInvoicePaid`, faturadaki paketi hemen etkinleştiriyor; oysa faturanın dönemi mevcut ödenmiş dönemden sonra başlıyor (`domain/billing.ts nextPeriod`).
- **Sonuçları:**
  - Yükseltmede, zaten ödenmiş alt paket döneminin kalanı üst paketle ücretsiz kullanılıyor.
  - Peşin ödenen bir düşürmede, kiracı parasını ödediği üst paketi hemen kaybediyor.
  - Süresi geçmiş bir kiracıda dönem, bildirimin kesildiği gün başlıyor. Sonradan ödeme yapan kiracı, salt okunur geçirdiği günlerin parasını da ödüyor.
  - Dönem bitişinden sonra ödeme yapan kiracı, ödemiş olduğu halde süresi dolmuş durumda kalıyor.
  - Ek süre tutarsız. 7 günlük ek süre içinde ödeyen geriye dönük faturalanıyor; ek süreden bir gün sonra ödeyen ise o 7 günü bedava kullanmış oluyor (ölçüldü).
  - Dönem başlangıç günü kayıyor. 31 Ocak'ta başlayan bir aylık dönem 2 Mart'ta bitiyor; sonraki dönemler hep ayın 3'ünden başlıyor (ölçüldü).
- **Etki:** Yükseltmelerde gelir kaybı; düşürmelerde ve geç ödemelerde müşteri şikâyeti ve olası anlaşmazlık.
- **Öneri:**
  - Bekleyen paket ve geçerlilik tarihi tutulup paket dönem başında değiştirilmeli.
  - Süresi geçmiş kiracıların dönemi ödeme anında hesaplanmalı.
  - Yükseltmede kıst hesap yapılmalı ya da fark faturalanmalı.
  - Dönem başlangıç günü sabitlenmeli.
- **Zorluk:** Orta.

### BIZ-06 · ORTA · Otel sayısı faturalanan sayıya bağlı değil
- Fiyat otel başına; ancak otel oluşturmada hiçbir paket veya abonelik kontrolü yok. 1 otel için ödeme yapan bir kiracı dönem ortasında istediği kadar otel açabiliyor. Ayrıntı için SECURITY_AUDIT BE-01'e bakın.
- **Öneri:** Platform konsolunda faturalanan ve aktif otel sayıları yan yana gösterilmeli; fark bir sonraki bildirimde kıst hesapla faturalanmalı.
- **Zorluk:** Küçük–orta.

### BIZ-07 · ORTA · Deneme süresi bitince üst paket modüllerindeki veriye erişim kalkıyor; "hiçbir şey kaybolmaz" sözü tutulmuyor
- **Kanıt:**
  - Varsayılan paket BASIC; deneme süresi PREMIUM veriyor.
  - `FEATURE_ROUTES` (`src/lib/features.ts`) okuma (GET) ve dışa aktarma rotalarını da paketle kapatıyor. `billing.test.ts` testi, deneme bitince kahvaltı okumasının PLAN_REQUIRED döndüğünü kendisi doğruluyor.
  - Micros/Opera entegrasyonu STANDARD paket gerektirdiği için BASIC'te duruyor; satış fişleri gelmediğinden teorik maliyet eksik kalıyor.
- **Etki:** 30 günlük denemede girilen kahvaltı, minibar, oda, işletme gideri, ikram ve bütçe verileri deneme bittikten sonra (ücretli BASIC'te de, süresi dolmuşta da) görüntülenemiyor ve dışa aktarılamıyor. Oysa `domain/billing.ts` başlığı "her rakam görünür kalır, hiçbir şey kaybolmaz" diyor. Bu bir güven ve müşteri kaybı riski.
- **Öneri:** Düşürülen modüllerde yalnızca yazma kapatılmalı, okuma ve dışa aktarma açık kalmalı. Deneme süresince hangi modüllerin kapanacağı önceden gösterilmeli.
- **Zorluk:** Küçük–orta.

### BIZ-08 · ORTA · Otomatik siparişler: satın alma siparişi yok, onay yok; süresi dolan kiracılar için gönderim sürüyor
- **Kanıt:** `auto-order.ts runAutoOrders` ve `nightly.ts runNightly`:
  - Salt okunur kiracıları kontrol etmiyor. Süresi dolmuş ama kayıtlı paketi PREMIUM olan bir kiracının tedarikçilerine her gece sipariş e-postası gitmeye devam ediyor.
  - E-postalar satın alma siparişi kaydı oluşturmuyor: sipariş numarası, onay adımı ve sipariş-mal kabul eşleşmesi yok.
  - `replyTo` ayarlanmadığı için tedarikçi yanıtları no-reply adresine gidiyor.
- **Etki:** Onaysız ve izsiz gerçek ticari taahhütler oluşuyor; üstelik ödeme yapmayan kiracılar adına.
- **Öneri:**
  - Salt okunur kiracılar atlanmalı.
  - Her tedarikçi e-postası için ONAYLI (ya da TASLAK + onay) bir sipariş kaydı açılmalı ve numarası e-postada yer almalı.
  - `replyTo`, otelin satın alma adresi olmalı.
- **Zorluk:** Orta. (`runNightly` test kapsamı %0.)

### BIZ-09 · ORTA · Sayımlar kör değil; onaylanan rakam ile işlenen rakam aynı değil
- **Kanıt:**
  - `counts.ts startCount`, sayılan miktarı sistem miktarıyla önceden dolduruyor; ekran sistem miktarını giriş kutusunun yanında gösteriyor.
  - Onay ekranındaki fark, sayım başlatıldığı andaki sistem miktarına göre hesaplanıyor. `postCount` ise sistem miktarını sayım tarihine göre yeniden hesaplıyor.
- **Etki:** Kimsenin dokunmadığı satırlar sessizce "fark yok" olarak işleniyor ve eksikler gizleniyor. Sayım yapan kişi beklenen miktarı görüyor. Onaylayan kişi, işlenecek olandan farklı bir rakamı onaylıyor olabilir.
- **Öneri:** Kör sayım modu: sayılan miktar girilene kadar boş kalmalı ve her satır ya girilmeli ya da "sayılmadı" diye işaretlenmeli. Onay ekranı yeniden hesaplanmış farkı göstermeli.
- **Zorluk:** Orta.

### BIZ-10 · DÜŞÜK–ORTA · Bir ayın yeniden açılması, sonraki kapalı ayları sessizce geçersiz kılıyor
- **Kanıt:**
  - Ay YENİDEN AÇILDI durumundaysa, sonraki kapalı ay kontrolü atlanıyor. Yeniden açılan Eylül'e yapılan bir kayıt, Ekim kapalı kaldığı halde Ekim'in açılış bakiyesini değiştiriyor; Ekim'in anlık görüntüsü ve paketi eskiyor.
  - Aynı muhasebe müdürü dönemi yeniden açıp tekrar kapatabiliyor. Yeniden açma hiç sona ermiyor.
- **Öneri:**
  - Böyle bir kayıtta sonraki kapalı aylar "yeniden kapanış gerekli" olarak işaretlenmeli.
  - YENİDEN AÇILDI durumuna süre veya hatırlatma eklenmeli.
  - İsteğe bağlı: yeniden kapanış için ikinci bir kişinin onayı.
- **Zorluk:** Orta.

### BIZ-11 · DÜŞÜK · Fire ve ikram eşikleri bölünebiliyor ya da hiç yok
- Fire onay eşiği kayıt başına uygulanıyor; büyük bir fire eşiğin altında parçalara bölünerek onaydan kaçırılabiliyor.
- Ödenmez ve ikram kayıtlarında hiç tutar eşiği yok.
- **Öneri:** Kullanıcı ve ürün başına günlük toplam eşik; ikram için tutar eşiği.

### BIZ-12 · DÜŞÜK · Denetim izinde boşluklar
- Sayım satırı düzenlemeleri (`counts.enterCount`) önceki ve sonraki değeri kaydetmiyor; ret sonrası eski girişler kayboluyor.
- Entegrasyondan gelen PMS doluluk verisi üzerine yazılırken önceki ve sonraki değer tutulmuyor.
- Otomatik siparişler yalnızca gönderim günlüğünde iz bırakıyor.

### BIZ-13 · DÜŞÜK · Dışa aktarma toplamları kayan noktalı sayıyla toplanıyor
- Yaklaşık 11 rapor `Number()` ile topluyor; bu, `domain/money.ts` para kuralına aykırı. Demo verisinde görünür fark ölçülmedi.
- **Öneri:** Decimal ile toplamak.

### BIZ-14 · DÜŞÜK · Belge numaraları eşzamanlılığa dayanıklı değil; faturalama bildirimleri elle yapılıyor
- Sipariş, mal kabul ve sayım numaraları "sayı + 1" ile üretiliyor; aynı anda iki kayıt oluşturulursa benzersizlik kısıtı hata veriyor (veri bozulmuyor).
- Faturalama yalnızca proforma bildirim. e-Fatura / e-Arşiv entegrasyonu yok.
- Kiracılara bildirim kesildiğinde, deneme bitmek üzereyken veya süre dolduğunda e-posta gitmiyor.

### BIZ-15 · BİLGİ · Demo verisinde %46 "açıklanamayan" sapma var
- Ölçüm (DHG-IST, Eylül 2026): teorik maliyet 572.820 ₺, gerçekleşen 395.010 ₺, açıklanamayan −265.204 ₺ (teoriğin %−46,3'ü).
- Bir satış sunumunda bu, bozuk bir ürün izlenimi verir. Demo verisindeki tüketim ya da satış karması yeniden ayarlanmalı. **Genel müdür sunumundan önce önemli.**

## 4. Güçlü yönler
- **Temiz çekirdek katmanlama:**
  - Saf `src/domain` katmanı (veritabanı bağımlılığı yok).
  - Yetkilendirmeyi taşıyan servisler; servisler arasında import döngüsü yok.
  - 158 rotanın 150'sine tek tip kimlik doğrulama, CSRF, hata eşleme, istek kimliği ve paket kapısı sağlayan tek bir `api()` sarmalayıcısı.
- **Güçlü defter tasarımı:**
  - Stok, maliyet ve denetim defterleri yalnızca eklemeye açık; bu, veritabanı tetikleyicileriyle zorlanıyor (TRUNCATE dahil).
  - İşlem sonrası bakiye alanları, FIFO katmanları, yalnızca ters kayıtla düzeltme, yineleme anahtarları.
  - Pozisyon başına `FOR UPDATE` kilidi ve `FOR SHARE` / `FOR UPDATE` dönem koruması.
  - Her yerde DECIMAL(20,6) ve Decimal.js.
  - Hesaplar kuruşuna kadar mutabık (QA_AUDIT bölüm 2).
- **Derinlemesine kiracı yalıtımı:** servis kapsamı, `assertHotelRefs`, 40 tabloda tetikleyiciler (boşluklar için DB-04), değiştirilemez otel ve şirket bağı.
- **Faturalama:**
  - Erişim durumu tarihlerden türetiliyor; bayatlayan bir durum kolonu yok.
  - Kesilmiş bildirimler veritabanında değiştirilemez; numaralar danışma kilidiyle üretiliyor.
- **Testler:** gerçek Postgres üzerinde 171 birim ve 306 entegrasyon testi, hepsi yeşil. CI, UTC dışı bir saat diliminde çalışıyor.
- **Ölçeklenebilirlik ve operasyon:**
  - Ölçeklenebilirlik çalışması stres ve staging veri setleriyle belgelenmiş (`docs/PERFORMANCE.md`).
  - Bot verisini parçalara bölerek gönderiyor.
  - Sağlama toplamlı `pg_dump` yedeği, tek işlemde geri yükleme ve `verify-restore`.
  - `/api/health` veritabanı saat dilimini raporluyor.

## 5. Doğrulanamayanlar
- **Gerçek Vercel davranışları:**
  - Sıkıştırılmış veya akış (stream) yanıtların da 413 alıp almadığı.
  - Fluid compute ortamında bağlantı havuzu çekişmesi.
  - Hata webhook'unun yanıttan sonra teslim edilip edilmediği.
  - Cron çalıştırma geçmişi.
- **Canlı veritabanı:**
  - Canlı Neon veritabanının Preview ile paylaşılıp paylaşılmadığı (ARCH-03).
  - Canlı veritabanında platform şirketi olup olmadığı (DB-06).
  - Neon PITR saklama süresi.
- **Windows kurulum programının gerçek davranışı:** yalnızca kod incelendi.
- **FIFO indekslerinin staging ölçeğindeki etkisi:** staging veritabanı eski şemada ve FIFO verisi yok.
- **Next.js görsel optimizasyon açığının bu yapılandırmada istismar edilebilirliği.**
- **İş kararları:** BIZ-01 (düzenlemenin anında onaylanması) ve BIZ-10 (yeniden açma) bilinçli ürün kararları mı, ürün sahibinin onayı gerekiyor.
