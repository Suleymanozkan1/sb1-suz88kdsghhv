# HotelCost Micros / Opera Botu

Bu küçük program otelde, **Micros yönetim (back office / raporlama) tarafının kurulu olduğu ofis bilgisayarında**
çalışır. Bu bilgisayar sürekli açıktır; bot kasa (POS) cihazlarına bağlanmaz, yalnızca raporlama ekranlarını okur.
Her gece **05:00'te** (ayarlanabilir), gece kapanışından (night audit) sonra:

1. **Oracle Micros** web arayüzüne kullanıcı adı / şifre ile girer (Playwright ile gerçek bir Chromium tarayıcı kullanır),
2. bir önceki iş gününün verilerini otelin gösterdiği raporlardan okur (hangi raporlar: `reports.json`, bkz. 5. bölüm):
   - **Satışlar (çekler / adisyonlar)** — hangi üründen kaç adet satıldı: ürün kodu, ürün adı, miktar, net tutar; satış noktası (revenue center), çek no, kapanış saati. HotelCost satışları reçeteye göre stoktan düşer,
   - **Ödenmez ve ikram** — ödenmez (on-house) / ikram (hospitality) olarak kapatılan çekler ve kalemleri (rapor `reports.json`'da tanımlanınca; o zamana kadar atlanır). Bu çekler satış olarak ayrıca gönderilmez,
   - **Satınalma faturaları** — tedarikçi, fatura no, tarih, depo, kalemler (ürün, miktar, birim, birim fiyat, KDV %),
   - **Cover sayıları** — satış noktası ve öğüne göre kişi sayısı (ör. satılan kahvaltılar),
3. **Opera** (isteğe bağlı) ekranından gece kapanışı istatistiklerini (satılabilir / dolu oda, misafir sayısı, oda geliri, dolu oda numaraları) ve odalara yazılan **minibar** hareketlerini okur,
4. verileri HotelCost'un biçimine çevirip **HotelCost**'a gönderir ve çalışmanın sonucunu (başarılı / hatalı + açıklama) HotelCost'a bildirir.

Gece kapanışı bazen gecikir: 05:00'te o günün satış raporu henüz boşsa bot bunu "gece kapanışı bitmemiş" sayar,
hiçbir şey göndermeden **15 dakikada bir yeniden dener** ve en geç **09:00'daki** son denemede rapor hâlâ boşsa durumu
HotelCost'a hata olarak bildirir. Başarılı bir gün aynı gün tekrar çalıştırılmaz.

Ayrıca HotelCost'ta bir kullanıcı **"Şimdi çalıştır"** düğmesine bastığında bot bunu birkaç dakika içinde görür ve hemen çalışır.

Resmî bir Micros API'si olmadığı için bot ekranları bir insan gibi okur. Bu yüzden ekranların hangi öğelerinin okunacağı
(**seçiciler / selectors**) otelin kendi Micros/Opera sürümüne göre bir kez ayarlanmalıdır — aşağıya bakın.

---

## 1. Kurulum

Nereye kurulur: Micros yönetim / raporlama ekranlarının açıldığı, **sürekli açık ofis bilgisayarına** (bilgisayarın
uyku moduna geçmemesi ve Windows güncellemesinden sonra kendiliğinden açılması için güç ayarlarını kontrol edin).
Kasa (POS) cihazlarına kurulmaz.

Gerekenler: Windows 10/11 veya Linux, **Node.js 20 veya üstü** (https://nodejs.org → LTS), Micros ve Opera web
adreslerine erişebilen bir ağ, internet üzerinden HotelCost'a (https) erişim.

```bash
# klasörü bilgisayara kopyalayın (ör. C:\hotelcost\micros-bot veya /opt/hotelcost/micros-bot), sonra o klasörde:
npm ci                              # bağımlılıkları kurar (package-lock.json'daki sürümlerle)
npx playwright install chromium     # botun kullandığı Chromium tarayıcısını indirir (bir kez)
copy .env.example .env              # Linux: cp .env.example .env
```

Sonra `.env` dosyasını doldurun (bkz. 2. bölüm) ve kontrol edin:

```bash
npx tsx src/cli.ts check-config            # ayarlar, eksik seçiciler, HotelCost ve Micros erişimi
npx tsx src/cli.ts check-config --login    # ayrıca Micros / Opera'ya giriş yapmayı dener
```

> Bilgisayarda Chromium indirilemiyorsa (kapalı ağ) kurulu Chrome veya Edge kullanılabilir: `.env` içine
> `BROWSER_CHANNEL=chrome` veya `BROWSER_CHANNEL=msedge` yazın.

> Geliştirici notu: bot HotelCost deposunun içinde (`integrations/micros-bot/`) duruyorsa ve `npm ci` çalıştırılamıyorsa,
> deponun kök klasöründeki `node_modules` kullanılabilir (playwright, tsx, exceljs, zod orada var):
> kök klasörden `npx tsx integrations/micros-bot/src/cli.ts check-config`.

## 2. Ayarlar (`.env`)

Şifreler ve API anahtarı **yalnızca** `.env` dosyasında (veya ortam değişkenlerinde) durur; kodda veya seçici
dosyalarında asla yer almaz. Tüm ayarlar `.env.example` içinde açıklamalıdır. En önemlileri:

| Ayar | Açıklama | Varsayılan |
|---|---|---|
| `MICROS_URL`, `MICROS_USERNAME`, `MICROS_PASSWORD` | Micros web adresi ve bot için açılmış kullanıcı | — |
| `OPERA_URL`, `OPERA_USERNAME`, `OPERA_PASSWORD` | Opera (boşsa doluluk ve minibar okunmaz) | — |
| `HOTELCOST_URL`, `HOTELCOST_API_KEY` | HotelCost adresi ve otelin entegrasyon anahtarı | — |
| `TIMEZONE` | Otelin saat dilimi | `Europe/Istanbul` |
| `NIGHT_AUDIT_CUTOFF` | Gece kapanışının bittiği saat; iş günü bu saatte biter. HotelCost'taki "İş günü bitişi" ayarı her yoklamada gelir ve bunun yerine geçer; buradaki değer yalnızca ilk bağlantıya kadar kullanılır | `03:30` |
| `RUN_AT` | Gece çalışmasının saati (yerel). Night audit ~03:30'da alınır ama bazen gecikir; en sağlıklı saat 04:30–05:00. Kapanıştan sonra olmalı | `05:00` |
| `RETRY_MINUTES` | Rapor henüz boşsa (gece kapanışı bitmemiş) kaç dakikada bir yeniden denensin; `0` = denenmez | `15` |
| `RETRY_UNTIL` | Son deneme saati; bu saatteki deneme sonuncudur, rapor hâlâ boşsa HotelCost'a hata olarak bildirilir | `09:00` |
| `REPORTS_FILE` | Rapor tanımları (hangi raporlar, sütun başlıkları) | `reports.json` |
| `POLL_MINUTES` | "Şimdi çalıştır" isteklerini kontrol aralığı (dk) | `2` |
| `CATCH_UP` | Bilgisayar RUN_AT'te kapalıysa açılınca o günün çalışmasını yap | `true` |
| `HEADLESS` | `false` → tarayıcı penceresi görünür (seçici ayarlarken) | `true` |
| `TIMEOUT_MS` | Bir ekran öğesi için en fazla bekleme | `30000` |
| `INVOICE_SOURCE` | `web` (Micros satınalma ekranı) veya `file` (CSV/XLSX klasörü) | `web` |
| `INVOICE_IMPORT_DIR` | `file` modunda dosyaların bırakılacağı klasör | `./invoice-import` |
| `CHECKS_CHUNK_SIZE` | Bir istekte gönderilen en fazla çek | `500` |
| `MICROS_SELECTORS`, `OPERA_SELECTORS` | Seçici dosyaları | `selectors/micros.json`, `selectors/opera.json` |
| `IGNORE_HTTPS_ERRORS` | Micros/Opera kendinden imzalı sertifika kullanıyorsa `true` | `false` |
| `RUNS_DIR`, `STATE_DIR`, `LOG_LEVEL` | Çalışma kayıtları, durum dosyası, log seviyesi | `./runs`, `./state`, `info` |

**İş günü:** Otel günü gece kapanışında biter. Bot varsayılan olarak "kapanışa göre dün"ü okur: 7 Ekim 05:00'te
çalışırsa 6 Ekim'i, 7 Ekim 02:00'de çalışırsa (6 Ekim'in kapanışı henüz bitmemiş) 5 Ekim'i okur. `--day` ile değiştirilebilir.

**Gece zamanlaması (daemon):**
- `RUN_AT` (05:00) geldiğinde o günün çalışması başlar; okunacak iş günü ilk denemede belirlenir ve tüm denemelerde aynı kalır.
- `reports.json`'da `"waitForData": true` olan rapor (varsayılan: satışlar / çekler) boş gelirse gece kapanışı bitmemiş
  sayılır: o sistemden (Micros / Opera) hiçbir şey gönderilmez ve HotelCost'a bildirilmez, yalnız loga yazılır
  (`night audit not finished yet … attempt 1, next try at 05:15`). `RETRY_MINUTES` sonra yalnız bekleyen sistem yeniden denenir.
- `RETRY_UNTIL` (09:00) saatindeki (veya bir sonraki denemesi bu saati geçecek olan) deneme son denemedir: rapor hâlâ
  boşsa `checks FAILED: report not ready …` olarak bildirilir, diğer veri türleri yine gönderilir. HotelCost'ta veri gelene
  kadar "henüz veri gelmedi" uyarısı görünür.
- Başarılı (veya son denemesi yapılmış) bir gün aynı gün tekrar çalışmaz; bilgisayar yeniden başlasa da (`state/meta.json`) kalınan yerden devam eder.
- Giriş hatası, ekran değişikliği gibi hatalar yeniden denenmez (hemen bildirilir); düzeltince "Şimdi çalıştır" kullanın.
- Bilgisayar 05:00'te kapalıysa açıldığında çalışır (`CATCH_UP=true`); `RETRY_UNTIL` geçmişse tek (son) deneme yapılır.
- "Şimdi çalıştır" istekleri beklemeden hemen çalışır; gece denemeleri arasında da gelebilir.

## 3. Çalıştırma

```bash
npx tsx src/cli.ts run                                   # varsayılan iş günü, tüm veri türleri
npx tsx src/cli.ts run --day=2026-10-06                  # belirli bir gün (tekrar göndermek güvenlidir)
npx tsx src/cli.ts run --only=checks,covers              # yalnız bazı türler: checks, comps, invoices, covers, minibar, occupancy
npx tsx src/cli.ts run --only=products                   # Micros'taki tüm ürün kartları (gece çalışmasında okunmaz)
npx tsx src/cli.ts run --day=2026-10-06 --dry-run        # HotelCost'a göndermez, JSON'u ekrana yazar
npx tsx src/cli.ts daemon                                # sürekli mod: her gece RUN_AT (rapor boşsa yeniden dener) + "Şimdi çalıştır" istekleri
npx tsx src/cli.ts check-config [--login]                # ayar kontrolü
```

Çıkış kodları: `0` başarılı, `1` çalışma hatalı / ayar sorunu, `2` hatalı komut.

Aynı günü tekrar çalıştırmak **güvenlidir**: HotelCost çekleri "çek no + gün", faturaları "tedarikçi + fatura no",
minibar hareketlerini "folyo/hareket no" ile tanır ve daha önce gelenleri atlar (mesajda "duplicates" olarak görünür).
Bot da gönderdiklerini `state/sent.json` dosyasına yazar (yalnız bilgi amaçlı).

### Sürekli çalıştırma (önerilen: `daemon`)

"Şimdi çalıştır" düğmesinin çalışması için botun **daemon** modunda sürekli açık olması gerekir.

**Windows — Görev Zamanlayıcı (Task Scheduler):**
1. Görev Zamanlayıcı → *Görev Oluştur*. Ad: `HotelCost Micros Bot`. *Kullanıcı oturum açmış olsun veya olmasın çalıştır*
   seçin (bot için ayrı bir Windows kullanıcısı önerilir).
2. *Tetikleyiciler*: **Başlangıçta** (At startup).
3. *Eylemler*: Program: `C:\hotelcost\micros-bot\deploy\run-daemon.cmd`, Başlangıç konumu: `C:\hotelcost\micros-bot`.
4. *Ayarlar*: "Görev başarısız olursa yeniden başlat: her 1 dakikada, 999 kez"; "Görev şundan uzun sürerse durdur" **kapalı**.
   Aynı şey komut satırıyla:
   `schtasks /Create /TN "HotelCost Micros Bot" /TR "C:\hotelcost\micros-bot\deploy\run-daemon.cmd" /SC ONSTART /RU SYSTEM`

   Daemon yerine yalnız gece çalışması istenirse (Şimdi çalıştır olmadan):
   `schtasks /Create /TN "HotelCost Micros Gece" /TR "cmd /c cd /d C:\hotelcost\micros-bot && npx tsx src\cli.ts run >> logs\run.log 2>&1" /SC DAILY /ST 05:00`
   (bu modda yeniden deneme yoktur: rapor boşsa o gün eksik kalır — daemon önerilir)

**Linux — systemd:** `deploy/micros-bot.service` dosyasını düzenleyip `/etc/systemd/system/` altına kopyalayın,
`sudo systemctl enable --now micros-bot`. Log: `journalctl -u micros-bot -f`.

**pm2 (Windows veya Linux):** `npm i -g pm2`, sonra `pm2 start deploy/ecosystem.config.cjs && pm2 save`
(Linux'ta açılışta başlatmak için `pm2 startup`; Windows'ta `pm2-installer` paketi).

## 4. Loglar, ekran görüntüleri, HotelCost'taki kayıt

- Her çalışma HotelCost'a bildirilir: **STARTED** → **SUCCEEDED** ("checks 412, invoices 9, covers 2") veya **FAILED**
  (her hatanın açıklamasıyla, ör. `login failed (Micros): ...`, `checks FAILED: screen changed: selector #checkList not found on checks screen (checks.list)`).
  Micros ve Opera ayrı çalışma (run) olarak bildirilir.
- Bir veri türündeki hata diğerlerini durdurmaz: ör. çek ekranı değiştiyse faturalar ve cover yine gönderilir, çalışma FAILED olarak işaretlenir.
- `runs/<runId>/run.log` — o çalışmanın ayrıntılı logu.
- `runs/<runId>/<ekran>-<zaman>.png` ve `.html` — hata anındaki ekran görüntüsü ve sayfanın HTML'i (seçici düzeltirken çok işe yarar).
  30 günden eski çalışma klasörleri otomatik silinir.
- Daemon'un genel logu: Windows'ta `logs\daemon.log`, systemd'de journal, pm2'de `logs/daemon.*.log`.

Sık görülen mesajlar:

| Mesaj | Anlamı / yapılacak |
|---|---|
| `login failed (Micros): ...` | Şifre değişmiş / kullanıcı kilitli. `.env` içindeki şifreyi güncelleyin. |
| `screen changed: selector X not found on Y screen (Y.key)` | Micros güncellendi veya seçici yanlış. Ekran görüntüsüne bakıp `selectors/*.json` içinde `Y.key` değerini düzeltin. |
| `selector not configured: Y.key is still a TODO placeholder` | Seçici dosyasında doldurulmamış alan var. |
| `checks FAILED: report not ready: no checks for business day … still empty at 09:00` | Gece kapanışı 09:00'a kadar bitmedi (veya o gün gerçekten satış yok). Kapanış bitince "Şimdi çalıştır". |
| `screen changed: column "Adet" (qty) not found on checks screen (columns: …)` | Rapordaki sütun başlığı değişti. `reports.json` içinde başlığı düzeltin (mesajda bulunan başlıklar yazar). |
| `timeout: ...` | Ekran çok yavaş açıldı veya ağ sorunu. `TIMEOUT_MS` artırılabilir. |
| `network error: ERR_CONNECTION_REFUSED` | Micros/Opera adresine ulaşılamıyor (sunucu kapalı / adres yanlış). |
| `HotelCost 401` | API anahtarı yanlış veya iptal edilmiş. |

## 5. Rapor tanımları (`reports.json`)

Hangi Micros / Opera raporlarının okunacağını **otel gösterecek**. Gösterdiğinde kodu değiştirmeden `reports.json`
doldurulur (başka bir dosya için `REPORTS_FILE`). Dosya bot her başladığında ve her çalışmada doğrulanır; hatalı bir
ayar varsa bot Türkçe bir mesajla durur (`check-config` hepsini listeler).

Dosya sistem (`micros`, `opera`) ve veri türüne göre bloklardan oluşur:

| Veri türü | Ne için | Sütun alanları |
|---|---|---|
| `micros.checks` | Satışlar: hangi üründen kaç adet satıldı → reçeteye göre stoktan düşer | `itemCode`, `itemName`, `qty`, `amount` |
| `micros.comps`, `opera.comps` | Ödenmez (ON_HOUSE) / ikram (HOSPITALITY) kapatılan çekler ve kalemleri | `checkNo`, `outlet`, `kind`, `reason`, `person`, `note`, `itemCode`, `itemName`, `qty` |
| `micros.invoices` | Satınalma faturaları (`INVOICE_SOURCE=web`) | `itemCode`, `itemName`, `qty`, `unit`, `unitPrice`, `taxRatePct` |
| `micros.covers` | Satış noktası / öğün başına kişi sayısı | `outlet`, `meal`, `covers` |
| `micros.products` | Ürün kartları ("Ürünleri çek") | `name`, `code`, `unit`, `packSize`, `packUnit`, `taxRatePct`, `category`, `createdAt` |
| `opera.occupancy` | Gece kapanışı istatistikleri | — (değerler `selectors/opera.json` `statistics`) |
| `opera.minibar` | Minibar hareketleri | `room`, `itemCode`, `itemName`, `qty`, `reference`, `postedAt` |

Her blokta:
- `reportName` — raporun Micros / Opera raporlamasında görünen adı (loglarda ve hata mesajlarında geçer).
- `menuPath` — rapora giden menü yolu, ör. `Raporlar > Satış > Menü Ürün Satışları`. Tıklamaların kendisi
  `selectors/*.json` içindeki aynı adlı bloğun `steps` adımlarıdır (bkz. 6. bölüm).
- `format` — `screen` (rapor ekrandan okunur; şimdilik tek seçenek).
- `waitForData` — `true`: rapor boşsa gece kapanışı bitmemiş sayılır, gece çalışması yeniden dener. Varsayılan yalnız satışlarda açık.
- `columns` — **rapordaki sütun başlığı → alan**, ör. `"qty": "Adet"`. Başlık büyük/küçük harf, Türkçe karakter ve
  noktalama farkı gözetmeden eşleştirilir; sütunun yeri değişse de bulunur. Başlık bulunamazsa çalışma
  `screen changed: column "Adet" (qty) not found on checks screen (columns: …)` mesajıyla hata verir. `null` bırakılan
  alan seçici dosyasındaki CSS seçicisiyle okunur (rapor tanımları gelmeden önceki davranış). Başlıkla okumak için
  satırların başlık satırı olan bir HTML tablosunda (`<table>`) olması gerekir.
- Yalnız `comps`: `kindMap` — rapordaki tür metni → `ON_HOUSE` (ödenmez) / `HOSPITALITY` (ikram), ör.
  `{ "Ödenmez": "ON_HOUSE", "İkram": "HOSPITALITY" }` (metnin içinde geçmesi yeter); rapor tek tür gösteriyorsa
  `defaultKind`. Çek no / satış noktası yalnız çekin ilk satırında yazıyorsa alt satırlara taşınır; eksi miktarlar
  (iptal) aynı kalemden düşülür.

**Ödenmez / ikram raporu**, `reportName` doldurulana kadar **okunmaz** (her çalışmada değil, bot başlarken bir kez
loga yazılır). Doldurunca seçici dosyasındaki `comps` bloğunu da doldurun. Aynı çek satış raporunda da çıkıyorsa
(çek no + satış noktası) satış olarak gönderilmez, yalnız ödenmez / ikram olarak gider.

**Otel raporları gösterince doldurulacak yer tutucular** (`TODO: otel gösterecek …`; `check-config` listeler):
- `micros.checks` — satış raporunun adı, menü yolu (sütun başlıkları isteğe bağlı)
- `micros.comps` — ödenmez / ikram raporunun adı, menü yolu, sütun başlıkları, `kindMap` metinleri (veya `defaultKind`)
- `micros.invoices`, `micros.covers`, `micros.products` — ekran / rapor adları ve menü yolları
- `opera.occupancy`, `opera.minibar` — rapor adları ve menü yolları
- `opera.comps` — Opera'da ödenmez / ikram raporu varsa (yoksa bloğu `null` yapın)

Tam doldurulmuş bir örnek: testlerde kullanılan `reports.mock.json`.

## 6. Seçicileri (selectors) güncelleme

Her ekranın okunacak öğeleri ve oraya nasıl gidileceği iki JSON dosyasındadır; kodu değiştirmeye gerek yoktur:

- `selectors/micros.json` — `login`, `checks` (çekler), `invoices` (satınalma faturaları), `covers`, `products`
  (ürün kartları: HotelCost'ta **Ürünler → Ürünleri çek** ile istenir; son çekimden bu yana eklenenler okunur,
  gece çalışmasında okunmaz), `comps` (ödenmez / ikram; `reports.json`'da tanımlanınca)
- `selectors/opera.json` — `login`, `statistics` (gece kapanışı istatistikleri, dolu odalar), `minibar`, `comps`

`reports.json`'da bir alana sütun başlığı verildiyse o alanın CSS seçicisi gerekmez (TODO kalabilir).

`TODO` ile başlayan her değer doldurulmalıdır; kullanılmayan alanlar `null` yapılır. `check-config` doldurulmamış
alanları listeler. Tam doldurulmuş bir örnek için test için yazılmış `selectors/micros.mock.json` ve
`selectors/opera.mock.json` dosyalarına bakın.

### Seçiciyi bulmak

1. **Playwright codegen** (en kolayı): `npx playwright codegen https://micros-adresi/` — açılan tarayıcıda giriş yapıp
   ekranda gezinin; tıkladığınız / üzerine geldiğiniz her öğenin seçicisi yan pencerede görünür
   (*Pick locator* düğmesi ile bir öğeye tıklayınca seçicisi kopyalanır). Gezinme adımları (`steps`) için de
   kaydedilen `goto` / `click` / `fill` adımlarını kullanabilirsiniz.
2. **Tarayıcı geliştirici araçları**: Chrome/Edge'de öğeye sağ tık → *İncele*; HTML'de öğeye sağ tık →
   *Copy → Copy selector*. Mümkünse kısa ve kalıcı seçiciler seçin: `#checkList`, `table.report`, `[data-field=checkNo]`.
   Otomatik üretilen uzun zincirler (`div:nth-child(3) > div > span`) ekran biraz değişince bozulur.
3. Bulduğunuz seçiciyi doğrulamak için geliştirici araçları *Console*'unda `document.querySelectorAll("SEÇİCİ")` yazın.

Kurallar:
- Üst düzey seçiciler (ör. `list`, `detail.checkNo`, adım seçicileri) CSS veya Playwright seçicisi olabilir
  (`text=Göster`, `role=button[name="Göster"]`).
- `row`, `rowLink` ve satır sütunları (`detail.line.*`, `columns.*`) **CSS** olmalıdır ve satıra göre yazılır
  (ör. `td:nth-child(3)`, `td.qty`). `row` ve `rowLink` listeye (`list` / `table`) göredir.
- `steps` içindeki yollar (`goto`) `MICROS_URL` / `OPERA_URL`'e göre çözülür; `http...` ile başlayan tam adres de yazılabilir.
  Kullanılabilecek değişkenler: `{date}` (iş günü, dosyadaki `dateFormat` biçiminde, ör. 06.10.2026), `{day}` (2026-10-06), `{yyyy}`, `{mm}`, `{dd}`.
- Adım türleri: `{"goto": "/yol"}`, `{"click": "seçici"}`, `{"fill": "seçici", "value": "{date}"}`,
  `{"select": "seçici", "value": "Etiket"}`, `{"press": "seçici", "key": "Enter"}`, `{"waitFor": "seçici"}`, `{"wait": 1000}`.
- `numberFormat`: `tr` (1.234,56) veya `en` (1,234.56). `dateFormat` / `dateTimeFormat`: `DD.MM.YYYY`, `DD.MM.YYYY HH:mm` gibi.
- `noData`: o gün kayıt yoksa görünen mesajın seçicisi. Ayarlıysa ve liste boş gelirse bot bunu "satır seçicisi yanlış"
  olarak değerlendirir (sessizce 0 göndermez).
- `open`: `link` (satırdaki bağlantının adresine gider, hızlı) veya `click` (bağlantı yoksa satıra tıklar, okur, geri döner).
- `skipItemNamePattern` / `skipOutletPattern`: "Toplam" gibi satırları atlamak için düzenli ifade.

Seçici ayarlarken `.env` içinde `HEADLESS=false` yapıp `npx tsx src/cli.ts run --dry-run --only=checks` ile botun ne
yaptığını izleyebilir, sonucu ekranda JSON olarak görebilirsiniz (HotelCost'a gönderilmez).

### Ekran bazında okunan alanlar

| Ekran | Okunanlar |
|---|---|
| `login` | `username`, `password`, `submit`, `loggedIn` (yalnız girişten sonra görünen öğe), `error` (hatalı şifre mesajı) |
| `checks` | liste: `list`, `row`, `rowLink`, `noData`, `nextPage`; çek: `checkNo`, `outlet` (revenue center), `closedAt`; satırlar: `lineRow` + `itemCode`, `itemName`, `qty`, `amount` (indirim sonrası net, KDV hariç) |
| `invoices` | liste aynı; fatura: `supplierName`, `invoiceNo`, `invoiceDate`, `warehouse`, `total` (KDV dahil genel toplam, isteğe bağlı — kalemler tutmazsa HotelCost faturayı reddeder); kalemler: `itemCode`, `itemName`, `qty`, `unit`, `unitPrice`, `taxRatePct` |
| `covers` | `table`, `row`, `columns.outlet`, `columns.meal` (yoksa `defaultMeal`), `columns.covers` |
| `products` | `steps` (`{since}` = son çekim tarihi), `table`, `row`, `noData`, `columns.name`, `code`, `unit`, `packSize` + `packUnit` (kilo / gramaj, ör. 830 gr), `taxRatePct`, `category`, `createdAt` |
| `statistics` (Opera) | `fields.availableRooms`, `occupiedRooms`, `guests`, `roomRevenue`, `outOfOrder` (OOO), `outOfService` (OOS); `rooms` (dolu oda listesi, isteğe bağlı) |
| `minibar` (Opera) | `table`, `row`, `columns.room`, `itemCode`, `itemName`, `qty`, `reference` (folyo/hareket no), `postedAt` |
| `comps` (Micros / Opera) | `table`, `row`, `noData`, `columns.checkNo`, `outlet`, `kind`, `reason`, `person`, `note`, `itemCode`, `itemName`, `qty` |

## 7. Faturaları dosyadan okuma (`INVOICE_SOURCE=file`)

Satınalma bir masaüstü programındaysa veya rapor almak ekran okumaktan kolaysa: faturaları CSV veya XLSX olarak
`INVOICE_IMPORT_DIR` klasörüne bırakın (ör. satınalma programının günlük dışa aktarımı). Bot klasördeki tüm dosyaları
okur, gönderir ve başarılı gönderimden sonra dosyaları `processed/<iş günü>/` altına taşır.

Bir satır = bir fatura kalemi; aynı tedarikçi + fatura no'lu satırlar tek fatura olur. İlk satır başlıktır; başlıklar
Türkçe veya İngilizce olabilir (büyük/küçük harf, Türkçe karakter ve boşluk önemsiz):

| Alan | Kabul edilen başlıklar | Zorunlu |
|---|---|---|
| Tedarikçi | Tedarikçi, Firma, Cari, Supplier, Vendor | evet |
| Fatura no | Fatura No, Belge No, Invoice No | evet |
| Fatura tarihi | Fatura Tarihi, Tarih, Invoice Date, Date | evet |
| Ürün | Ürün, Ürün Adı, Stok Adı, Malzeme, Açıklama, Item Name, Product | evet |
| Miktar | Miktar, Adet, Qty, Quantity | evet |
| Birim | Birim, Ölçü Birimi, Unit | evet |
| Birim fiyat (KDV hariç) | Birim Fiyat, Fiyat, Unit Price, Price | evet |
| Depo | Depo, Ambar, Warehouse, Store | hayır |
| Stok kodu | Stok Kodu, Ürün Kodu, Malzeme Kodu, Kod, Item Code | hayır |
| KDV % | KDV, KDV Oranı, KDV %, VAT, Tax Rate | hayır |

Tarih: `06.10.2026`, `6.10.2026`, `06/10/2026`, `2026-10-06` veya Excel tarih hücresi. Sayılar: `1.234,56` veya `1234.56`
(dosya başına otomatik algılanır). CSV ayırıcı `;` `,` veya sekme; kodlama UTF-8 veya Windows-1254 (Türkçe Excel).
Örnek: `test/fixtures/faturalar-ornek.csv`. Hatalı satırlar atlanır ve HotelCost'taki çalışma mesajında uyarı olarak görünür.

## 8. Güvenlik

- Bot için Micros ve Opera'da **yalnızca okuma yetkisi olan ayrı bir kullanıcı** açın; kişisel hesap kullanmayın.
- `.env` dosyasını yalnız botu çalıştıran kullanıcı okuyabilsin (Linux: `chmod 600 .env`; Windows: dosya özellikleri → Güvenlik).
  `.env` asla e-postayla gönderilmez, git'e konmaz.
- Şifreler ve API anahtarı loglara, ekran görüntüsü dosya adlarına veya HotelCost'a gönderilen mesajlara yazılmaz (bot bunları maskeler).
- `runs/` klasöründeki ekran görüntüleri ve HTML dosyaları satış verisi içerebilir; klasörü paylaşmadan önce bakın.
- HotelCost API anahtarı otele özeldir; çalınma şüphesinde HotelCost'ta iptal edip yenisini `.env`'e yazın.
- HotelCost adresi `https://` olmalıdır. `IGNORE_HTTPS_ERRORS=true` yalnızca otel iç ağındaki Micros/Opera için kullanılmalıdır.

## 9. Geliştirme ve testler

```bash
npm test            # birim testleri + uçtan uca testler (sahte Micros/Opera + sahte HotelCost, gerçek Chromium)
npm run typecheck
npm run mock:micros # sahte Micros'u http://127.0.0.1:4010 adresinde başlatır (kullanıcı bot / s3cret-micros)
```

- `test/mock-micros/` — giriş formu, çek listesi (sayfalı) ve çek detayları, fatura listesi ve detayları, cover raporu,
  Opera istatistik / oda / minibar sayfaları olan küçük bir Node http sunucusu.
- `test/mock-hotelcost/` — istekleri kaydeden sahte HotelCost API'si. Bot HotelCost deposunun içindeyse gövdeleri
  sunucunun gerçek zod sözleşmesiyle (`src/server/integrations/contract.ts`) doğrular.
- Sözleşmenin bot içindeki kopyası: `src/contract.ts` (sunucudaki sözleşme değişirse güncellenmelidir).

Kod yapısı:

```
src/cli.ts                    komutlar: run / daemon / check-config
src/runner.ts                 bir çalışma: giriş → ekranları oku → doğrula → gönder → bildir
src/daemon.ts                 gece zamanlaması (05:00, rapor boşsa yeniden deneme) + "Şimdi çalıştır" yoklaması
src/reports.ts                rapor tanımları (reports.json): yükleme, doğrulama
src/config.ts                 .env / ortam değişkenleri
src/hotelcost/client.ts       HotelCost API (parçalı gönderim, yeniden deneme)
src/screens/micros/*.ts       login, checks, invoices, covers, products
src/screens/opera/*.ts        statistics (doluluk), minibar
src/screens/comps.ts          ödenmez / ikram raporu (Micros veya Opera)
src/invoices/                 fatura kaynağı arayüzü (web / file) ve CSV-XLSX okuyucu
src/browser/                  tarayıcı, seçici dosyası, ortak ekran yardımcıları
selectors/*.json              ekran seçicileri (otele göre doldurulur)
reports.json                  hangi raporlar okunur, sütun başlıkları (otel raporları gösterince doldurulur)
```
