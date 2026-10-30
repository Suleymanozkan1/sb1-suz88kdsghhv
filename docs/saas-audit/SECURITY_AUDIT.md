# Güvenlik Denetimi (SECURITY_AUDIT)

**Kapsam:** `main` (39083c6). İncelenenler:
- 158 API rota dosyası (198 işleyici)
- İstek işleyici, kimlik doğrulama, paket ve özellik kapıları
- PR #22 ile gelen abonelik, faturalama, kayıt ve gözlemlenebilirlik kodu
- Kurulum programı, Docker, Vercel yapılandırması
- Önceki güvenlik denetiminin (run-1) bulguları

**Yöntem:** kod okuma. Yerel demo sunucusunda (http://localhost:3300) zararsız canlı denemeler yapıldı; ayrı test veritabanında kanıt betikleri ve mevcut güvenlik testleri çalıştırıldı. Canlı sisteme dokunulmadı, proje dosyaları değiştirilmedi.

## 1. Özet

Yetkilendirme çekirdeği sağlam:
- **Kiracı yalıtımı:** başka otelin kimliğiyle 26 liste rotası, başlık varyantı ve 24 kayıt okuma/yazma denemesi yapıldı. Hepsi 403/404 ya da boş sonuç döndü.
- **Departman yalıtımı:** pastane şefinin mutfak verisine erişimi engellendi.
- **Platform ayrımı:** şirket yöneticisi platform işlemlerine, platform yöneticisi de kiracı verisine erişemiyor.
- **Önceki denetim:** doğrulanmış 32 bulgunun düzeltmesi yerinde duruyor, gerileme yok (bölüm 4).

Dikkat isteyen konular çoğunlukla yeni ticari katmanda (PR #22) ve oturum açma yaşam döngüsünde.

## 2. Bulgular

| No | Başlık | Önem | Güven |
|---|---|---|---|
| SEC-01 | İlk SaaS müşterisi "kurulum sahibi" demo kontrollerine erişebiliyor | YÜKSEK | Kod okuma |
| SEC-06 | Bağımlılıklarda kritik güvenlik açıkları (next 15.5.27) | YÜKSEK | Sürümler doğrulandı, istismar edilebilirlik doğrulanmadı |
| BIZ-01/02/03 | Görev ayrılığı ve onay kontrolleri (iş mantığı, ARCHITECTURE_AUDIT bölüm 3) | YÜKSEK | Kod okuma |
| SEC-02 | Süresi dolan veya düşürülen abonelik, güvenlik amaçlı erişim kaldırmayı engelliyor | ORTA | Testle doğrulandı |
| SEC-03 | Dağıtım (allocation) modülü başka departmanların maaş havuzlarını gösteriyor | ORTA | Canlı doğrulandı |
| SEC-04 | MFA yok, kullanıcı kendi şifresini değiştiremiyor/sıfırlayamıyor | ORTA | Kod okuma |
| SEC-05 | Yerel kurulum/Docker: düz HTTP ve taklit edilebilir IP hız sınırları | ORTA | Canlı doğrulandı |
| BE-01 | Faturalanan otel sayısını kiracı belirleyebiliyor | ORTA | Kod okuma |
| BE-02 | Ağır uç noktalar sınırsız ve sunucuyu kilitliyor | ORTA | Ölçümle doğrulandı |
| NV-12 | Vercel önizleme derlemeleri canlı veritabanını migrate edebilir | ORTA | Kod okuma |
| SEC-07 | Bozuk `Origin` başlığı anonim uç noktalarda 500 hatasına yol açıyor | DÜŞÜK | Canlı doğrulandı |
| SEC-08 | Hata günlüklerinde ve harici webhook'ta olası kişisel veri | DÜŞÜK | Varsayım |
| SEC-09 | Şirket geneli ayarlar otel düzeyi yetkiyle değişiyor; video adresleri | DÜŞÜK | Kod okuma |
| BE-03 | Hata yanıtları tutarsız | DÜŞÜK | Kod okuma |
| BE-04 | Gece işi tüm kiracıları sırayla, süre bütçesi olmadan işliyor | DÜŞÜK | Kod okuma |
| BE-05 | Docker imajı root olarak çalışıyor ve tüm derleme aşamasını taşıyor | DÜŞÜK | Kod okuma |

### SEC-01 · YÜKSEK · İlk SaaS müşterisi "kurulum sahibi" demo kontrollerine erişebiliyor: başka kiracıların demosunu silme ve süresiz ücretsiz Premium
- **Kanıt:**
  - `src/server/setup/index.ts` `assertInstallationOwner`: veritabanında demo ve platform dışında tam olarak bir şirket varsa, o şirketin `admin:users` yetkili yöneticisini "kurulum sahibi" sayıyor. Kurulumun kendi sunucusunda mı olduğu, yoksa faturalamanın açık olduğu bir SaaS mı olduğu kontrol edilmiyor.
  - `DELETE /api/setup/demo` → `purgeDemoOrganizations` tüm demo şirketlerini şifre sormadan siliyor.
  - `startDemoLoad` yeni demo şirketleri oluşturuyor ve demo kullanıcılara sahibin şifresini veriyor.
  - `src/server/plans.ts` `tenantAccess`: demo şirketler her zaman PREMIUM, deneme süresi yok, salt okunur mod yok.
- **Senaryo:** canlı veritabanında platform şirketi, operatörün demo şirketleri ve ilk ödeme yapan müşteri var. Müşteri yöneticisi `DELETE /api/setup/demo` ile operatörün satış demosunu siler. Ardından kendi şifresiyle yeni demo şirketleri oluşturur ve süresiz ücretsiz Premium kullanır.
- **Doğrulama:** demo/platform dışı tek bir şirketin yöneticisiyle `GET /api/setup/demo` çağrısı 403 yerine 200 döner.
- **Etki:**
  - Operatörün satış demosu bir müşteri tarafından yok edilebilir.
  - Faturalama modeli atlatılabilir. Pencere ikinci müşteri gelince kapanır, ama o sırada oluşturulan demo şirketler sonsuza kadar Premium kalır.
  - **Bu, kasım ayında canlıya çıkışta tam olarak yaşanacak durum.**
- **Öneri:**
  - Faturalama açıkken `/api/setup/demo` kapatılmalı ya da yalnızca platform operatörüne açılmalı.
  - Silme işlemi, yalnızca sahibin kendi oluşturduğu demo şirketlerle sınırlanmalı.
  - Silme öncesinde şifre yeniden sorulmalı.
- **Zorluk:** Küçük.

### SEC-06 · YÜKSEK · Bağımlılıklarda kritik güvenlik açıkları
- **Kanıt (`npm audit`, salt okunur):** 3 kritik, 7 yüksek, 6 orta.
  - **next 15.5.27:**
    - GHSA-2464-fhr4-w9xw: SVG ile görsel optimizasyon API'sinde kimlik doğrulamasız uzaktan kod çalıştırma (kritik)
    - GHSA-p3m5-59mp-jv5r: Server Actions hizmet reddi (yüksek)
  - **nodemailer 10.0.16:** alıcı enjeksiyonu (orta). Tedarikçi e-postaları zod ile doğrulandığı için pratik risk düşük.
  - **zod 3.25.76:** büyük koleksiyonlarda bellek tüketimi. 5 MB gövde sınırı riski sınırlıyor; düzeltme yalnızca zod 4'te var.
  - Ayrıca sharp 0.34.5 ve postcss.
  - Yalnızca geliştirme ortamında: vitest, tinypool (kritik), vite. Ancak Docker imajı geliştirme bağımlılıklarını da taşıyor (BE-05).
- **Uygulanabilirlik:**
  - `public/` altında SVG yok, `images` yapılandırması yok, `"use server"` eylemi yok. Bu yüzden next açıkları büyük olasılıkla istismar edilemez.
  - Bu bir **varsayım**; yükseltme ucuz olduğu için ertelenmemeli.
- **Öneri:**
  - next ve nodemailer yamaları hemen uygulanmalı (küçük).
  - zod 4 geçişi planlanmalı (orta).
  - Docker çalışma aşamasına yalnızca üretim bağımlılıkları kurulmalı.

### SEC-02 · ORTA · Süresi dolan veya düşürülen abonelik, güvenlik amaçlı erişim kaldırmayı engelliyor; iptal niyetli anahtarlar sonradan yeniden canlanıyor
- **Kanıt:**
  - `handler.ts` salt okunur muafiyet listesinde `/api/admin/*` ve `/api/integrations/*` yok.
  - `src/lib/features.ts` tüm `/api/integrations` önekini (anahtar silme dahil) ve `/api/auth/api-token` rotasını pakete bağlıyor.
- **Ölçüm (test veritabanında kanıt betiği):**
  - Süresi dolmuş şirkette:
    - Kullanıcıyı pasifleştirme **402** döndü ve kullanıcının oturumu açık kaldı.
    - Entegrasyon anahtarını silme **402** döndü.
  - BASIC pakete düşürülen şirkette anahtar silme ve API anahtarı iptali **403 PLAN_REQUIRED** döndü.
  - Paket geri yüklenince, iptal edilemeyen bot anahtarı yeniden **200** döndü.
- **Etki:** Ödemesi geciken bir otel, işten çıkan bir çalışanın erişimini kapatamıyor ve sızan bir ofis bilgisayarı bot anahtarını iptal edemiyor. Faturalama durumu bir güvenlik açığına dönüşüyor.
- **Öneri:** Erişimi azaltan işlemler salt okunur moddan ve paket kapılarından muaf tutulmalı: kullanıcı pasifleştirme, şifre sıfırlama, davet iptali, entegrasyon anahtarı iptali, API anahtarı iptali.
- **Zorluk:** Küçük.

### SEC-03 · ORTA · Dağıtım (allocation) modülü başka departmanların maaş havuzlarını gösteriyor
- **Kanıt:** `src/server/services/allocation.ts` içindeki `listRules`, `previewAllocation`, `previewPeriodAllocation` ve `listRuns` yalnızca `opex:view` yetkisine bakıyor, departman kapsamına bakmıyor.
- **Canlı deneme (yalnızca Yiyecek-İçecek departmanlarına yetkili `fbm@test.local`):**
  - `/api/opex/reports/housekeeping` → **403**. Önceki 8 numaralı bulgunun düzeltmesi çalışıyor.
  - `/api/allocation/runs` → **200**: Odalar, Kat Hizmetleri ve Çamaşırhane dağıtımları listeleniyor.
  - `/api/table-export/allocation?format=csv` → **200**: Teknik Servis personel havuzu da dahil.
  - İlgili olarak `planning.ts` `listBudgets`, `budget:view` yetkisi olan herkese otel geneli bütçe toplamlarını (işçilik dahil) döndürüyor.
- **Etki:** Departman müdürleri, yönetmedikleri departmanların maaş havuzlarını görebiliyor. Önceki denetimde düzeltilen gizlilik sorununun aynısı, yeni bir yerde.
- **Öneri:** Dağıtım okumaları tahmin ve senaryo analizinde olduğu gibi tüm departmanlara yetkili rollere bırakılmalı ya da satırlar `actor.departmentIds` ile süzülmeli. Regresyon testi eklenmeli.
- **Zorluk:** Küçük.

### SEC-04 · ORTA · MFA yok, kullanıcı kendi şifresini değiştiremiyor veya sıfırlayamıyor
- **Kanıt:**
  - Kodda MFA/TOTP, "şifremi unuttum" ve kullanıcının kendi şifresini değiştirmesi yok. Şifreleri yöneticiler ya da davet sırasında belirleniyor.
  - Şifre kuralı yalnızca en az 10 karakter.
  - Oturum süresi 12 saat sabit; boşta kalma zaman aşımı yok, eşzamanlı oturum sınırı yok.
  - Başarısız girişler denetim izine yazılmıyor; başarılı girişte IP kaydı yok.
  - Faturayı ödenmiş işaretleyen, paket değiştiren ve kiracı askıya alan **platform yöneticisi yalnızca şifreyle korunuyor**.
- **Etki:** Oltalamayla ele geçirilen bir platform yöneticisi şifresiyle ücretsiz paket verilebilir ya da tüm kiracılar askıya alınabilir. Kaba kuvvet denemelerini fark edecek bir iz de yok.
- **Öneri:**
  - En azından platform ve şirket yöneticileri için TOTP.
  - Kullanıcının kendi şifresini değiştirebilmesi ve bu işlemin diğer oturumlarını kapatması.
  - SMTP varsa e-postayla şifre sıfırlama.
  - Başarılı ve başarısız girişlerin IP ile denetim izine yazılması.
- **Zorluk:** Orta.

### SEC-05 · ORTA · Yerel kurulum/Docker: düz HTTP ve taklit edilebilir IP hız sınırları
- **Kanıt:**
  - `installer/setup.ts` `HOSTNAME=0.0.0.0` ve `INSECURE_COOKIES=1` ayarlıyor. Oturum çerezi Secure bayrağı olmadan, şifrelenmemiş olarak otel ağında taşınıyor.
  - docker-compose `3000:3000` portunu doğrudan açıyor.
  - Vercel dışında `clientIp`, X-Forwarded-For başlığının en sağdaki değerini alıyor. Önde bir vekil sunucu yoksa bu değeri istemci belirleyebiliyor.
- **Canlı deneme:**
  - Aynı e-postaya her seferinde farklı X-Forwarded-For ile 40 giriş denemesi: **40 × 401, hiç 429 yok**.
  - Kontrol olarak sabit X-Forwarded-For ile: 8 × 401, ardından 429.
- **Kalan koruma:** yalnızca e-posta başına 15 dakikada 50 deneme sınırı, yani hesap başına günde yaklaşık 4.800 tahmin. Aynı sınır, sahte IP'lerle gerçek kullanıcıyı kilitlemeye de izin veriyor (kod okumayla).
- **Etki:** Misafir Wi-Fi'ı ile aynı ağı paylaşabilen otel ağlarında oturumlar dinlenebilir; kaba kuvvet koruması göründüğünden zayıf.
- **Öneri:**
  - Kurulum programına TLS sağlayan bir ters vekil eklenmeli (ör. Caddy) ya da uygulama yalnızca localhost'a bağlanmalı.
  - `TRUSTED_PROXY_HOPS` ayarlanmalı.
  - Hesap başına katı kilit yerine artan bekleme süresi uygulanmalı.
- **Zorluk:** Orta.

### BE-01 · ORTA · Faturalanan otel sayısını kiracı belirleyebiliyor
- **Kanıt:**
  - `billing.ts` `createBillingInvoice`, bildirim kesildiği andaki aktif otel sayısını kullanıyor.
  - `tenancy.ts` içindeki otel oluşturma ve etkinleştirmede hiçbir faturalama kontrolü yok.
  - `markBillingInvoicePaid` şirketin paketini faturadaki paketle değiştiriyor. Bu yüzden eski bir bildirimin ödenmesi daha sonra yapılmış bir yükseltmeyi geri alabiliyor.
- **Senaryo:**
  1. Kiracı otellerini askıya alır.
  2. Bildirim daha az otel üzerinden kesilir.
  3. Ödemeden sonra oteller yeniden açılır veya yenileri eklenir.
  4. Bir sonraki bildirime kadar fark faturalanmaz.
- **Etki:** Gelir kaybı; otel başı fiyat modeli uygulanmıyor.
- **Öneri:** Dönem içindeki en yüksek aktif otel sayısı faturalanmalı ya da ödenen sayının üstünde otel açılması engellenmeli (yükseltme istenmeli). Operatör, bildirim kesmeden önce sayıları görmeli.
- **Zorluk:** Orta.
- Ayrıca bkz. ARCHITECTURE_AUDIT BIZ-05/06 (paket değişiminin zamanlaması, kıst hesap).

### BE-02 · ORTA · Ağır uç noktalar sınırsız ve sunucuyu kilitliyor
- **Kanıt:** Hız sınırı yalnızca giriş, davet, kurulum ve `/api/export/*` uç noktalarında var. Şunlarda hiç sınır yok:
  - `table-export/[key]` (PDF/XLSX)
  - `reports/management-pack`
  - `imports/*`
  - `integrity/check|rebuild`
  - `recipes/refresh-prices`
  - `auto-order/run`
- **Ölçüm:**
  - Salt okunur kullanıcıyla Ocak–Ekim stok hareketleri PDF'i **5,2 sn** sürdü ve 700 KB üretti.
  - Bu tek istek sırasında ilgisiz bir `/login` isteği **2,96 sn**'ye çıktı. Aynı anda başka denetçiler de sunucuyu kullanıyordu; sayı gösterge niteliğinde.
- **Etki:** Tek süreçli kurulumlarda (kurulum programı, Docker) birkaç paralel dışa aktarma tüm kullanıcıları bekletir. Vercel'de ise fonksiyon süresi maliyeti doğar.
- **Öneri:** Sayfa dışa aktarmalarına ve yönetim paketine kullanıcı başı hız sınırı konmalı; büyük PDF'ler XLSM işleri gibi kuyruğa alınmalı.
- **Zorluk:** Küçük.

### NV-12 · ORTA · Vercel önizleme derlemeleri canlı veritabanını migrate edebilir
- **Kanıt:**
  - `vercel-build` her derlemede `prisma migrate deploy` ve `recipes-refreeze` çalıştırıyor.
  - `scripts/check-build-env.mjs`, tek veritabanının Production, Preview ve Development ortamlarının hepsine bağlanmasını öneriyor.
  - Önceki denetimin doğrulanamayan 12 numaralı maddesiydi ve hâlâ geçerli.
- **Etki:** Bir dalın önizlemesi, henüz birleştirilmemiş bir migrasyonu canlı veritabanına uygulayabilir.
- **Öneri:** Önizlemeler için ayrı bir veritabanı (Neon dalı) kullanılmalı ya da migrate yalnızca `VERCEL_ENV=production` iken çalışmalı.
- **Zorluk:** Küçük.

### DÜŞÜK önem
- **SEC-07 · Bozuk `Origin` başlığı 500'e yol açıyor.**
  - Login, davet kabulü ve kurulum `new URL(origin)` çağrısını korumasız yapıyor.
  - `Origin: null` ile 500 dönüyor; her seferinde yığın izi günlüğe yazılıyor ve hata webhook'una gönderiliyor.
  - Çıkış (logout) rotasında köken kontrolü yok.
  - Öneri: işleyicideki `sameOrigin()` fonksiyonu kullanılmalı.
- **SEC-08 · Hata günlüklerinde ve harici webhook'ta olası kişisel veri.**
  - Ham hata mesajı ve 8 satır yığın izi harici sohbet webhook'una gidiyor.
  - Prisma hataları sorgu argümanlarını (ad, e-posta, tutar) içerebiliyor.
  - Öneri: webhook'a yalnızca mesaj kodu ve istek kimliği gönderilmeli.
- **SEC-09 · Şirket geneli ayarlar otel düzeyi yetkiyle değişiyor.**
  - Faturalama profili, paket talebi ve eğitim videoları, tek bir otelin `admin:users` yetkisiyle şirket genelinde değiştirilebiliyor.
  - Eğitim videosu adresi olarak `/relative` ve `http://` kabul ediliyor. Göreli bir adres, sayfayı açan her kullanıcının tarayıcısına aynı kökenden bir GET isteği (ör. ağır bir dışa aktarma) yaptırabilir.
  - Öneri: yalnızca `https://` YouTube/Vimeo/medya adreslerine izin verilmeli.
- **BE-03 · Hata yanıtları tutarsız.**
  - Bot API'si doğrulama hatalarını 400 ile döndürüyor (diğer rotalar 422) ve mesajlar çevrilmiyor.
  - Gece işi rotası `UNAUTHORIZED` kodunu kullanıyor, diğerleri `UNAUTHENTICATED`.
  - Veritabanı tetikleyici metinleri ham olarak dönüyor.
- **BE-04 · Gece işi tüm kiracıları sırayla, süre bütçesi olmadan işliyor.**
  - SMTP zaman aşımları varsayılan değerlerde (2 ve 10 dakika).
  - Yavaş bir SMTP sunucusu sonraki kiracıların otomatik siparişlerini sessizce atlatabilir.
- **BE-05 · Docker imajı root olarak çalışıyor.**
  - İmaj tüm derleme aşamasını taşıyor: kaynak kod, testler, geliştirme bağımlılıkları.
  - Migrasyon, uygulama başlatılırken çalışıyor.

### Bilgi notları
- `/api/health` herkese açık; veritabanı saat dilimini, gecikmeyi ve bölgeyi gösteriyor. Sağlık kontrolü için kabul edilebilir.
- API JSON yanıtlarında `Cache-Control: no-store` yok (sayfalarda var). Risk düşük.
- `billingOverview`, kiracıya ham fatura satırlarını gösteriyor: platform kullanıcı kimliği, ödeme referansı, iptal nedeni.

## 3. Arka uç envanteri
- **Rotalar:** 158 rota dosyası, 198 işleyici.
  - 189'u `api()` sarmalayıcısını kullanıyor: oturum, köken kontrolü, 5 MB gövde sınırı, paket kapısı, salt okunur kapısı.
  - 3'ü `botApi` kullanıyor: entegrasyon anahtarı, 10 MB sınır.
  - 7'si özel: login, setup, davet, logout, health, gece işi (`CRON_SECRET` ile zamanlamaya dayanıklı karşılaştırma).
- **Yetkilendirme:** `api()` kullanan her işleyicide ya rota düzeyinde yetki (yaklaşık 60) ya da servis düzeyinde `authorize` / `guard` var. Tarama ve elle takip bunu doğruladı.
- **Oturumlar:**
  - 32 baytlık rastgele anahtar, veritabanında yalnızca SHA-256 olarak saklanıyor.
  - Çerez HttpOnly, SameSite=Lax; üretimde Secure.
  - Rol, şifre veya otel değişiminde, kiracı askıya alındığında ve kullanıcı pasifleştirildiğinde tüm oturumlar kapanıyor.
  - Girişte yeni anahtar üretiliyor.
- **Dosyalar:**
  - İçe aktarmalarda satır, sütun, birleşik hücre ve açılmış boyut sınırları var.
  - CSV çıktısında formül enjeksiyonu engelleniyor (`csvSafe`).
  - İndirme dosya adları otel kodundan üretiliyor.
- **Ham SQL:** tüm `$queryRaw` çağrıları etiketli şablon kullanıyor. `$queryRawUnsafe` yalnızca sabit tablolardan tanımlayıcı üretiyor. Enjeksiyon bulunmadı.
- **XSS:** tek `dangerouslySetInnerHTML` (sipariş e-postası önizlemesi) tamamen kaçışlanmış.
- **SSRF:** sunucu tarafında yalnızca ortam değişkenindeki `ERROR_WEBHOOK_URL` çağrılıyor; saldırı yüzeyi yok.
- **Başlıklar:** her istek için ayrı nonce kullanan CSP (`strict-dynamic`), `frame-ancestors 'none'`, HSTS, nosniff, `poweredByHeader:false`.
- **Gizli bilgiler:** desen taramasında depoya işlenmiş gerçek gizli bilgi bulunmadı. Testteki neon adresi bir yer tutucu.

## 4. Önceki denetimin yeniden doğrulanması (run-1)

**Doğrulanmış 32 bulgu:** düzeltmelerin hepsi yerinde, gerileme yok. Test veritabanında 115/115 entegrasyon ve 33/33 birim güvenlik testi geçti; ayrıca kod üzerinde nokta kontrolleri yapıldı.

Notlar:
- 8 numaralı bulgu (opex maaş sızıntısı) opex raporlarında düzeltilmiş. Ancak aynı sızıntı türü dağıtım modülünde yeniden ortaya çıkıyor (SEC-03).
- 3 ve 20 numaralı bulgularda (hız sınırı, X-Forwarded-For) doğrudan dışa açık kurulumlarda kalan bir risk var (SEC-05).
- 32 numaralı bulgu (e-posta sahiplenme) platform düzeyinde serbest bırakma ile hafifletilmiş; sahiplenmenin kendisi tasarım gereği hâlâ mümkün.

**Doğrulanamayan 12 madde:**

| No | Konu | Hâlâ geçerli mi? |
|---|---|---|
| 0 | `.dockerignore` gizli dosyaları imaja alıyor | **Hayır.** Artık dışarıda bırakıyor; imaj yine de tüm derleme bağlamını taşıyor (BE-05). |
| 3 | compose 5432 portunu dışarı açıyor | **Hayır.** Yalnızca 127.0.0.1'e bağlı. |
| 5 | Kurulum programı derleyen makinenin `.env` dosyasını taşıyor | **Evet.** `build-windows.sh` standalone çıktıyı kopyalıyor ve Next yüklenen env dosyalarını oraya ekliyor. |
| 7 | Kurulum programı önceden yerleştirilmiş bir `config.json` dosyasına güveniyor | **Evet.** Doğrulama yok; `appPort` hizmet XML'ine kaçışsız yazılıyor. |
| 8 | Windows'ta 0o600 dosya izni etkisiz | **Evet.** `icacls` yalnızca pgdata ve günlükler için uygulanıyor. |
| 9 | Bot SYSTEM hesabıyla, kısıtlanmamış klasörden çalışıyor | **Evet.** Micros/Opera şifreleri düz metin `.env` içinde. |
| 10 | Bot arşivi bağlantıları izliyor | **Hayır.** lstat/realpath kontrolü var. |
| 12 | Vercel önizlemeleri ortak veritabanını migrate ediyor | **Evet** (NV-12). |
| 16 | `FORCE=1` geri yükleme iptal edilmiş anahtarları canlandırıyor | **Evet.** Geri yükleme sonrası iptal adımı yok. |
| 25 | Tek kiracı gece işini kilitleyebiliyor | **Kısmen** (BE-04). |
| 39 | Satış-reçete eşleşmesi departmanı yok sayıyor | **Hayır.** Düzeltilmiş. |
| 43 | XLSX sıkıştırma bombası | **Hayır.** Test geçiyor. |

## 5. Güçlü yönler
- **Katmanlı yetkilendirme:** rota yetkisi gövde okunmadan önce kontrol ediliyor, her servis yeniden yetkilendiriyor, sorgular `{ id, hotelId }` ile kapsanıyor. Canlı denemelerde SEC-03 dışında kiracı veya departman sızıntısı bulunmadı.
- **Platform ayrımı:** platform yöneticisi kiracı verisini okuyamıyor; platform işlemleri kiracının denetim izine yazılıyor.
- **Faturalama bütünlüğü:**
  - Fatura tutarları veritabanı tetikleyicileriyle donduruluyor.
  - Fatura numaralandırması danışma kilidiyle yapılıyor.
  - Ödeme ve iptal işlemleri satır kilidiyle yapılıyor.
- **Testler:** güvenlik regresyon testleri (sec-a…d) mevcut ve geçiyor.

## 6. Doğrulanamayanlar
- SEC-01'in uçtan uca canlı denemesi (tek gerçek kiracılı bir veritabanı gerektiriyor)
- next ve sharp açıklarının istismar edilebilirliği (istismar denenmedi)
- Canlı Vercel ortam değişkenleri:
  - `CRON_SECRET`, `SETUP_TOKEN` ve `TRUSTED_PROXY_HOPS` ayarlı mı
  - Canlı demoda `superadmin@test.local` belgelenmiş şifreyle açık mı (`docs/VERCEL.md:64`)
- Windows kurulum programının gerçek ACL'leri ve derlenmiş pakette `.env` olup olmadığı
- Gerçek SMTP davranışı
