# Proje Genel Görünümü (PROJECT_OVERVIEW)

**HotelCost**, otel grupları için çok kiracılı bir maliyet kontrol SaaS'ı. Kapsadığı alanlar:
- Yiyecek-içecek maliyeti
- FIFO stok defteri
- Reçeteler
- Fire
- Kahvaltı
- Minibar
- Oda maliyeti
- İşletme giderleri
- Bütçe
- Dönem kapanışı
- Onaylar
- Raporlar ve PDF/Excel dışa aktarımı
- Micros/Opera entegrasyonu
- Abonelik ve faturalama

Bu belge `main` dalının 39083c6 commit'indeki durumu, kodla doğrulanmış olarak anlatır.

## 1. Teknoloji yığını

| Katman | Teknoloji |
|---|---|
| Çalışma ortamı | Node 22 (Dockerfile, CI, Windows kurulum programı 22.22.0) |
| Uygulama | Next.js 15.5.27 (App Router), React 19.1.9, TypeScript 5.9.3, Tailwind 3.4.17 |
| Veri | Prisma 6.19.3 + PostgreSQL. Ortamlara göre Postgres sürümü: compose 16, kurulum programı 16.14, CI 17 |
| Kütüphaneler | zod 3.25.76, decimal.js 10.6, exceljs 4.4, jszip, cfb (VBA projesi), pdfkit 0.17.2, nodemailer 10.0.16, bcryptjs 3, lucide-react |
| Test ve kod kalitesi | vitest 3.2.7 (birim + entegrasyon), Playwright 1.56.1 + axe-core, eslint 9 |
| Micros botu | `integrations/micros-bot` altında ayrı paket: Playwright 1.56.1, exceljs, zod, tsx |

## 2. Boyutlar (ölçüldü)

| Kalem | Sayı |
|---|---|
| API rota dosyası | 158 (198 işleyici); 8'i tasarım gereği `api()` sarmalayıcısını kullanmıyor |
| Sayfa | 51 (45'i `(app)` altında) |
| Servis | 41 |
| Saf hesap modülü (`src/domain`) | 21 (veritabanı bağımlılığı yok) |
| Prisma modeli / enum | 92 / 27 (şema 2.259 satır) |
| Migrasyon | 30 |
| Kaynak kod | yaklaşık 39.900 satır TS/TSX; Türkçe sözlükler 28 dosyada 5.166 satır |
| Yetki / rol şablonu | 48 yetki / 12 rol şablonu |

**Testler:**

| Tür | Dosya | Test |
|---|---|---|
| Birim | 20 | 171 |
| Entegrasyon | 35 | 306 |
| Uçtan uca (e2e) | 11 | yaklaşık 30 |
| Demo e2e | 2 | yaklaşık 17 |
| Kurulum e2e | 1 | 1 |
| Micros botu | 4 | yaklaşık 73 |

**Rol şablonları:** admin, cost_controller, fb_manager, accounting_manager, purchasing_manager, chef, breakfast_chef, pastry_chef, rooms_division, viewer, warehouse, super_admin.

## 3. Dizin yapısı

**Kök dizin:**
- `src/`: uygulama
- `prisma/`: `schema.prisma`, `migrations/`, `seed.ts`
- `tests/`: unit, integration, e2e, demo-e2e, setup-e2e
- `integrations/micros-bot/`: ofis bilgisayarında çalışan bot. Playwright ile Oracle Micros ve Opera raporlarını çeker, uygulamaya gönderir.
- `installer/`: Windows kurulum programı. NSIS paketi, `setup.ts` (kurulum, başlatma, durdurma, yedekleme, demo, kaldırma), WinSW hizmeti.
- `scripts/`:
  - yedekleme ve geri yükleme (`ops/`)
  - demo, stres ve performans betikleri
  - `recipes-refreeze.ts`, `gen-vba.ts`, `check-build-env.mjs`, `first-company.ts`
  - `videos/` (eğitim videosu kaydı)
- `docs/`: ACCEPTANCE, DEMO_DATA, INTEGRATIONS, MULTI_TENANCY, OPERATIONS, PERFORMANCE, VERCEL, WINDOWS_INSTALL
- `public/`: 30 eğitim videosu dahil
- `Dockerfile`, `docker-compose.yml`
- `vercel.json`: bölge `fra1`, her gün 04:00 UTC'de `/api/cron/nightly`
- `.github/workflows/ci.yml`: Postgres 17 üzerinde, `TZ=Europe/Istanbul` ile tip kontrolü, lint, birim ve entegrasyon testleri ve VBA eşitlik kontrolü. Uçtan uca testler, npm audit ve bot testleri CI'da yok.

**`src` içindeki önemli klasörler:**
- `src/app/(app)/**`: modül başına sunucu tarafında çizilen sayfalar ve yanlarındaki istemci bileşenleri.
- `src/app/api/**`: REST rotaları. En büyük gruplar: yönetim 15, kahvaltı 12, platform 11, işletme giderleri 7, entegrasyon 6, dışa aktarma 6.
- `src/server/http/handler.ts`: `api()` sarmalayıcısı. Şunları yapar:
  - köken (CSRF) kontrolü
  - oturum veya API anahtarı doğrulaması
  - otel seçimi ve yetki ön kontrolü
  - paket/abonelik kapısı
  - 5 MB gövde sınırı
  - hata eşleme, istek kimliği ve erişim günlüğü
- `src/server/auth/*`:
  - `session.ts`: saydam olmayan oturum anahtarı, SHA-256 olarak saklanıyor, 12 saat, hız sınırları Postgres'te
  - `actor.ts`: `authorize`, `requireHotel`, `requireDepartment`
  - `scope.ts`: otel referansları ve depo kapsamı
  - `permissions.ts`: yetki kataloğu ve rol şablonları
- `src/server/services/*.ts`: iş mantığı. Her servis kendi yetkilendirmesini yapar.
- `src/domain/*`: saf hesaplar. Para (Decimal), birimler, FIFO ve ortalama maliyet, reçete maliyeti, mal kabul maliyeti, sapma, fire, faturalama, iş günü.
- `src/server/excel/*`: VBA gömülü `.xlsm` çalışma kitabı.
- `src/server/table-export/*`: sayfa tablolarının CSV/XLSX/PDF çıktıları (30 rapor tanımı).
- `src/server/reports/pack-pdf.ts`: yönetim paketi PDF'i.
- `src/server/integrations/*`: veri alım sözleşmesi ve bot doğrulaması.
- `src/server/demo/*`: demo ve staging veri üreticisi. Üretim paketinde de yer alıyor.
- `src/server/plans.ts`, `src/lib/features.ts`: hangi paketin hangi özellikleri açtığı.
- `src/server/log.ts`: JSON satırı günlükçü ve isteğe bağlı hata webhook'u.
- `src/server/nightly.ts`: gece işi. `src/server/mail.ts`: e-posta gönderimi.
- `src/i18n/*`: İngilizce metinler anahtar, Türkçe sözlükler `tr/*.ts` dosyalarında.

## 4. Modüller

- **Ana veri:** ürünler, kategoriler, birimler ve dönüşümler, tedarikçiler.
- **Satın alma:**
  - satın alma talepleri ve siparişleri
  - kabul maliyetli mal kabul
  - tedarikçi faturaları ve fiyat geçmişi
  - otomatik sipariş kuralları ve e-postayla sipariş
- **Stok defteri:** FIFO katmanları ve tüketimleri, bakiyeler, transfer, düzeltme, ters kayıt.
- **Sayımlar**
- **Reçeteler:** sürümler, onay, dondurulmuş maliyet görüntüsü, alt reçeteler.
- **Satış aktarımı ve reçete tüketimi**
- **Teorik ve Gerçekleşen (sapma)**
- **Fire ve onay**
- **Ödenmez ve İkram**
- **Kahvaltı (büfe)**
- **Minibar**
- **Oda maliyeti**
- **İşletme giderleri:** gider, demirbaş, sayaç, çamaşırhane.
- **PMS doluluk ve rezervasyon**
- **Gider dağıtımı**
- **Planlama:** bütçe, hedefler, tahmin, senaryo analizi, tasarruf.
- **Dönemler ve kapanış**
- **Onaylar**
- **Denetim izi**
- **Uyarılar ve içgörüler**
- **Veri kalitesi ve hesap bütünlüğü**
- **Kontrol takvimi**
- **Raporlar ve dışa aktarma**
- **Yönetim ve çok kiracılık:** kiracılar, oteller, kullanıcılar, davetler.
- **Faturalama, abonelik ve paketler**
- **Başlangıç rehberi**
- **Entegrasyonlar:** anahtarlar, çalıştırmalar, talepler, veri alımı.

## 5. Veri modeli (92 model, özet)

**Kiracılık ve kimlik:**
- Organization (paket, demo, platform, deneme bitişi, ödeme bitişi, faturalama alanları), Hotel ile 1–n.
- Organization 1–n User; her kullanıcının bir rolü (Role) ve o rolün bir yetki dizisi var.
- Kullanıcı–otel ilişkisi UserHotelAccess, kullanıcı–departman ilişkisi UserDepartmentAccess üzerinden (n–m).
- Session: anahtar özeti; Excel API anahtarları `api:` önekiyle saklanıyor.
- UserInvite.
- Faturalama: BillingInvoice, PlanPrice, PlatformSetting, PlanRequest.

**Otel yapısı:**
- Department (ağaç yapısı, satış noktası bayrağı) → CostCenter (ağaç yapısı).
- Warehouse (departmana bağlanabilir).
- CostPeriod: otel × ay. Durumlar: AÇIK, ÖN KAPANIŞ, KAPALI, YENİDEN AÇILDI.

**Ana veri:**
- ProductCategory (ağaç yapısı, grup) → Product (otel bazında benzersiz stok kodu, varsayılan FIFO) → UnitConversion.
- Supplier, SupplierPrice (değiştirilemez fiyat geçmişi).
- AutoOrderRule → AutoOrderSend, OrderEmailTemplate.

**Satın alma:** PurchaseRequest(Item), PurchaseOrder(Item), GoodsReceipt(Item) (kabul maliyeti ve yineleme anahtarıyla), Invoice(Item).

**Defterler:**
- **StockTransaction:** yalnızca ekleme yapılabiliyor (tetikleyiciyle). İşlem sonrası bakiye alanları, tek ters kayıt bağlantısı ve yineleme anahtarı içeriyor.
- **StockBalance:** depo × ürün.
- **FifoLayer** → **FifoConsumption**.
- **CostTransaction:** yalnızca ekleme yapılabiliyor.
- **CostSnapshot:** dönem kapanışında alınan görüntü.

**Reçeteler:**
- Recipe (yumuşak silme) → RecipeVersion (durum, geçerlilik tarihleri, dondurulmuş maliyet JSON'u).
- RecipeIngredient: ürün veya alt reçete. Sürüm onaylandıktan sonra tetikleyiciyle dondurulur.

**Satış:** SalesImport → SaleLine (otel × departman × harici kimlik benzersiz; satış anındaki teorik maliyet dondurulmuş).

**Fire ve üretim:** WasteRecord, YieldRecord, ProductionBatch.

**Sayım:** StockCount → StockCountLine, CountApprover.

**Yönetişim:** Approval, AuditLog (yalnızca ekleme), Alert, CalculationRun.

**Otele özgü:**
- Kahvaltı: BuffetSession → BuffetLine, CoverCount.
- Minibar: MinibarPar, MinibarMovement.
- Oda: Room, RoomCostItem, OccupancyImport, Reservation.
- İşletme: Expense, Asset, Meter → MeterReading, LaundryLog, Employee.
- Ödenmez ve İkram: CompReason → CompRecord → CompLine.

**Planlama:** Budget → BudgetLine, CostTarget, SavingAction, CostAllocationRule, AllocationRun, CalendarTask → CalendarCompletion.

**Altyapı:** ImportBatch, ExportJob (dosya veritabanında bytea olarak), RateLimitBucket, Report, IntegrationKey / Run / Request, DemoScenario, Attachment, Notification.

**Para ve miktar:** her yerde DECIMAL(20,6). Kurlar (20,8), birim çarpanları (20,9). Kodda Decimal.js; JSON'da metin olarak taşınıyor.

## 6. Çok kiracılık modeli

- **Ortak veritabanı ve şema.** Her operasyonel satırda `hotelId` var. Hiyerarşi Organization → Hotel; platform şirketinin oteli yok.
- **İstek başına bağlam:** kiracı, oturumdan çözülüyor (kullanıcının şirketi, otelleri, departmanları).
  - `api()` oteli şu kaynaklardan seçiyor: `?hotelId`, `x-hotel-id` başlığı veya `hc_hotel` çerezi.
  - Servisler `authorize(actor, perm, {hotelId, departmentId})` ile yeniden kontrol ediyor.
  - Her sorgu `{id, hotelId}` ile kapsanıyor.
- **Veritabanında derinlemesine savunma:**
  - 40 tabloda "aynı otel" tetikleyicileri.
  - Kullanıcı–otel ve kullanıcı–departman yetkilerinde "aynı şirket" tetikleyicileri.
  - Otelin şirketinin değiştirilemezliği.
  - Defterlerin ve denetim izinin değiştirilemezliği, TRUNCATE korumaları.
  - Yalnızca demo şirketler için bir temizleme kapısı.
  - Kapsam boşlukları için ARCHITECTURE_AUDIT DB-04'e bakın.

## 7. Kimlik doğrulama ve yetkilendirme

- **Giriş:** e-posta ve bcrypt (maliyet 10). Postgres tabanlı sabit pencereli hız sınırları: IP başına, e-posta+IP başına, e-posta başına.
- **Oturum:** 32 baytlık rastgele anahtar, HttpOnly ve SameSite=Lax çerez. Yalnızca SHA-256 özeti saklanıyor; ömrü 12 saat.
- **Kişisel API anahtarları (`hc_…`):** yalnızca `/api/export/full-cost` için, Excel VBA yenilemesi amacıyla.
- **Entegrasyon anahtarları (`hck_…`):** otel başına, bot için.
- **CSRF ve CSP:** değişiklik yapan isteklerde köken kontrolü; her istek için ayrı nonce kullanan CSP.
- **RBAC:** şirket başına rol satırları ve yetki dizileri; departman kapsamı ("tüm departmanlar" ya da açıkça verilen departmanlar). Sayfa kapıları (`requirePageAccess`) ve servis kontrolleri birlikte çalışıyor.
- **Paket/abonelik kapısı:** `api()` içinde merkezi. Abonelik süresi dolduğunda salt okunur mod.
- **İlk kurulum (`/setup`):** SETUP_TOKEN veya yeterince güçlü veritabanı şifresiyle korunuyor. Davet anahtarları özetlenmiş olarak saklanıyor.

## 8. Entegrasyonlar

- **Micros/Opera botu** → `POST /api/integrations/ingest`. Türler ve işlenme biçimleri:

  | Tür | İşlenme |
  |---|---|
  | Satış fişleri (checks) | `commitSales` |
  | Faturalar (invoices) | `postGoodsReceipt` |
  | Kuverler (covers) | — |
  | Minibar | `recordMovement` |
  | Doluluk (occupancy) | — |
  | Ürünler (products) | `createProduct` |
  | Ödenmez ve İkram (comps) | `ingestComps` |

  Veriler parçalanarak gönderiliyor (500 fiş, 200 fatura). İsteğe bağlı çekimler IntegrationRequest ve `/runs/next` üzerinden; çalıştırma günlüğü IntegrationRun'da.
- **SMTP (nodemailer):** otomatik tedarikçi siparişleri (Premium).
- **Excel `.xlsm`:** HTTPS üzerinden yenilenen VBA (TSV sözleşmesi).
- **Hata bildirimi:** `ERROR_WEBHOOK_URL` (Slack / Teams / Discord).
- **Vercel cron:** günlük gece işi.

## 9. Dağıtım hedefleri

**Vercel:**
- `vercel-build` adımları sırasıyla:
  1. ortam kontrolü
  2. `prisma generate`
  3. VBA üretimi
  4. `prisma migrate deploy`
  5. reçete dondurmalarının yenilenmesi
  6. `next build`
- Veritabanı Neon. Süre sınırları: dışa aktarma işi, veri alımı ve gece işi 300 sn; çalışma kitabı ve PDF 120 sn.

**Docker:**
- Çok aşamalı derleme (node:22-bookworm-slim); çalışma aşamasına tüm `/app` kopyalanıyor.
- Başlatma komutu: `prisma migrate deploy && next start`.
- Postgres 16 yalnızca 127.0.0.1'e bağlı.

**Windows kurulum programı:**
- NSIS paketi; içinde Next standalone, Node 22, gömülü PostgreSQL 16 ve WinSW hizmeti var.
- Veri `C:\ProgramData\HotelCost` altında.
- Kurulum tekrar çalıştırılabilir (veritabanı oluşturma, migrasyon, ilk şirket).
- Yedek, `pgdata` klasörünün soğuk kopyası.
- Yerel ağda HTTP için `INSECURE_COOKIES=1`.

## 10. Kritik iş akışları ve onları yürüten kod

1. **Satın alma → mal kabul → stok → reçete tüketimi → sapma**
   - `purchasing.ts`: sipariş oluşturma ve onay.
   - `postGoodsReceipt` tek bir işlemde (transaction) şunları yapıyor: kabul maliyeti hesabı, satır başına defterde ALIM kaydı, FIFO katmanı, tedarikçi fiyatı ve fiyat artışı uyarısı, sipariş güncellemesi ve denetim kaydı.
   - Bot da bu akışı veri alımı üzerinden kullanıyor.
   - Satış: `sales.ts`. Gün × satış noktası × malzeme başına, reçete sürümünün dondurulmuş maliyetinden TÜKETİM kaydı oluşturuluyor; geri alma işlemi bunları ters kayıtla geri alıyor.
   - Sapma: `variance.ts:theoreticalVsActual`.
2. **Onaylı fire:** `waste.ts`, maliyeti eşikle karşılaştırıyor.
   - Eşiğin altı: doğrudan FİRE kaydı.
   - Eşiğin üstü: onay talebi. `approvals.ts:decideApproval` onay verilince kaydı işliyor.
3. **Sayımlar:** `counts.ts`. Akış: başlat → giriş → gönder → onay → `postCount` (sayım farkı kaydı).
4. **Dönem kapanışı:** `period.ts`.
   - `assertPostable`: her kayıtta kullanılır; dönem satırlarını paylaşımlı kilitler.
   - `setPeriodStatus`: kontrol listesi, mutabakat, kapanış görüntüsü.
   - `reopenPeriod`: dönemi yeniden açar.
5. **Kahvaltı:** `buffet.ts`. Gün açma, kuver girişi, üretim ve takviye çıkışları, kahvaltı sayımı, kapanış (artıklar fireye aktarılır), sayım şablonu PDF'i.
6. **Ödenmez ve İkram:** `comps.ts`. Reçete iş gününe göre açılır ve İKRAM olarak düşülür; silmede ters kayıt yapılır. Bot verisi `ingestComps` ile, nedenler varsayılan listeden gelir.
7. **Faturalama ve abonelik:**
   - Erişim durumu tarihlerden türetiliyor: DENEME / AKTİF / GECİKMİŞ / SÜRESİ DOLMUŞ, 7 gün ek süreyle.
   - Paket kapısı `plans.ts` içinde, `handler.ts` uyguluyor.
   - `billing.ts`: danışma kilidiyle yıllık bildirim numarası, ödeme ile `paidThrough` uzatma, iptal, deneme uzatma, paket talepleri.
   - Kesilmiş bildirimler veritabanı tetikleyicisiyle değiştirilemez.
8. **Arka plan dışa aktarma:** `/api/export/jobs` → kuyruk ve `after()` ile çalışma. Dosya 24 saat bytea olarak saklanıyor.
9. **Gece işi:** `/api/cron/nightly` → `runNightly`. Otel başına otomatik siparişler sırayla çalıştırılıyor.
