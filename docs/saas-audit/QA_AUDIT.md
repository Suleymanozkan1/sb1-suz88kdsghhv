# Test ve Kalite Denetimi (QA_AUDIT)

**Kapsam:** `main` (39083c6). Mevcut testler ayrı bir test veritabanında çalıştırıldı (`hotelcost_test_c`). Hesaplamalar demo veritabanında salt okunur SQL ile bağımsız olarak doğrulandı. Proje dosyalarına dokunulmadı.

## 1. Test çalıştırmaları (ölçüm)

| Takım | Dosya | Test | Sonuç | Süre |
|---|---|---|---|---|
| Birim | 20 | 171 | tümü geçti | 18,7 sn |
| Birim, kapsam ölçümüyle | 20 | 171 | 170 geçti, **1 zaman aşımı** (QA-01) | 28,3 sn |
| Entegrasyon | 35 | 306 | tümü geçti | 296 sn |
| İkisi birlikte (`--testTimeout=30000`) | 55 | 477 | tümü geçti | 320 sn |

En yavaş entegrasyon dosyaları: `demo-dataset` 121 sn (toplam sürenin %41'i), `sec-a-auth` 15 sn, `fifo-recipes-products` 12,9 sn, `excel-export` 12,7 sn.

### Kapsam (`@vitest/coverage-v8`)

**Tanımlı kapsamda (`src/domain` + `src/server/services`):**
- Yalnız birim testleri: satırların %23,7'si
- Yalnız entegrasyon testleri: satırların %91,3'ü, dalların %80,7'si, fonksiyonların %89,5'i

**Tüm `src` için satır kapsamı: %63,2**

| Alan | Satır kapsamı |
|---|---|
| Servisler | %93,0 |
| Kimlik doğrulama | %93,2 |
| Entegrasyonlar | %93,9 |
| Excel | %98,8 |
| Demo üreticisi | %96,1 |
| Tablo dışa aktarımları | **%40,0** |
| API rotaları | **%7,6** (158 rota modülünden yalnızca 11'i bir testte içe aktarılıyor) |
| Sayfalar | **%0,6** (yalnızca uçtan uca testlerle kapsanıyor) |

**Hiç test edilmeyen dosyalar:** `nightly.ts` (gece işi) ve `onboarding.ts` (%0).

### Uçtan uca (e2e) envanteri (çalıştırılmadı)

| Klasör | Senaryo dosyası | Test | Ayrıntı |
|---|---|---|---|
| `tests/e2e` | 9 | 32 | Port 3200, `hotelcost_e2e` veritabanı, chromium + mobil |
| `tests/demo-e2e` | 2 | 18 | Salt okunur kullanıcının yazamadığını da kontrol ediyor |
| `tests/setup-e2e` | 1 | 1 | Veritabanı her çalıştırmada sıfırdan kuruluyor |

Hepsi `retries: 0`, `workers: 1` ile çalışıyor. **Uçtan uca testler CI'da çalıştırılmıyor.**

## 2. Hesaplamaların bağımsız doğrulaması (demo veritabanı, ölçüm)

| Kontrol | Sonuç |
|---|---|
| Stok bakiyesi = stok defteri toplamı (504 bakiye, 22.516 hareket) | 0 miktar farkı, 0 değer farkı |
| FIFO katmanları = bakiye (305 ürün) | Pozitif bakiyelerin hepsi birebir tutuyor. Tek negatif bakiye tasarım gereği (eksiye düşmeye izin veriliyor) katmansız. |
| Stok defteri ↔ maliyet defteri | Tüketim, fire, sayım farkı, personel yemeği ve ikram hareketlerinde toplamlar birebir aynı |
| Envanter devri (tüm veritabanı) | Açılış + alımlar − çıkışlar = kapanış stok değeri; birebir tutuyor |
| Mal kabul | Toplam mal kabul tutarı = defterdeki alım hareketleri. 537 fişten birinde 0,000001 yuvarlama farkı var. |
| Reçete maliyetleri | 61 onaylı reçeteden 60'ı alt reçeteler dahil bağımsız yeniden hesaplandı: fark 0. 61. reçete demodaki bilerek eksik bırakılmış reçete. |
| Teorik ve Gerçekleşen sayfası (DHG-IST, Eylül) ↔ SQL | Açılış, alım, kapanış, gerçekleşen, teorik ve gelir değerlerinin hepsi birebir aynı |
| Dışa aktarma ↔ sayfa | Teorik ve Gerçekleşen CSV'si ile fire CSV'sinin toplamları sayfayla ve veritabanıyla aynı |
| Kahvaltı | Üretim + takviye − iade = defterdeki kahvaltı tüketimi; çöpe giden artıklar doğru biçimde fireye aktarılmış |

**Sonuç:** Hesap motorları (stok defteri, FIFO, mal kabul maliyeti, reçete maliyeti, sapma ayrıştırması) tutarlı ve kuruşuna kadar mutabık.

## 3. Bulgular

### QA-01 · ORTA · Zamana duyarlı bir birim testi kapsam ölçümüyle çalıştırılınca düşüyor
- **Kanıt:** `tests/unit/sec-d-import-limits.test.ts`, satır 96 ("sıkıştırma bombasını reddeder"). Test 110 MB'lık bir veri üretiyor ve varsayılan 5 saniyelik süre sınırına tabi.
- **Ölçüm:**
  - Kapsam ölçümü olmadan 4,15 sn (geçiyor)
  - Tanımlı kapsamla 5 sn'de zaman aşımı
  - Tüm `src` kapsamıyla 19,4 sn
- **Etki:** Yavaş bir CI makinesinde veya `npm run test:coverage` ile kırmızı derleme.
- **Öneri:** Teste kendi süre sınırını vermek (ör. 30 sn) ya da daha küçük veri ve daha düşük limitle test etmek. Zorluk: küçük.

### QA-02 · ORTA · Test veritabanları temizlenmiyor; faturalama testleri diğer testleri etkileyen genel durumu değiştiriyor
- **Kanıt:**
  - Entegrasyon testleri sonunda hiçbir şeyi silmiyor. Ölçüm: `hotelcost_test` veritabanında 1.660 şirket var (100'ü platform şirketi), boyutu 159 MB.
  - `billing.test.ts` platform şirketleri oluşturuyor ve genel `PlanPrice` / `PlatformSetting` tablolarını değiştiriyor.
  - `plans.billingEnabled()` 60 saniyelik bir önbellek kullanıyor ve bir platform şirketi olup olmamasına bakıyor. Bu yüzden diğer test dosyalarında faturalamanın açık mı kapalı mı olduğu, testlerin çalışma sırasına ve veritabanının geçmişine bağlı.
- **Etki:** Test dosyaları arasında gizli bağımlılık oluşuyor. "Faturalama kapalı" varsayan testler, yeniden kullanılan bir veritabanında farklı davranabilir.
- **Öneri:** Testlerin genel kurulum adımında veritabanını boşaltmak (ya da her çalıştırmada ayrı şema kullanmak); faturalama önbelleğini test ortamında sıfırlamak. Zorluk: küçük–orta.

### QA-03 · ORTA · Tarihe bağlı testler ve kalıcı e2e veritabanı: 30 gün sonra patlayacak bir saatli bomba

> **Çapraz inceleme:** kök neden DB-06 ile aynı.
- **Kanıt:**
  - Entegrasyon testlerinde 283 sabit 2026 tarihi var; servisler ise `Date.now()` kullanıyor. Örnekler: gelecek tarih koruması, 30 günlük deneme süresi, gecikme mantığı.
  - Sahte saat (`vi.useFakeTimers`) hiç kullanılmıyor.
  - e2e kurulumu `prisma/seed.ts` dosyasını çalıştırıyor; bu dosya veri varsa hiçbir şey yapmıyor. Kurulumda bir platform şirketi oluşuyor (faturalama açılıyor), test şirketi ise BASIC paket + 30 günlük deneme süresiyle başlıyor.
  - Veritabanı kalıcı olduğu için 30 gün sonra test şirketinin süresi doluyor. Yazma işlemlerinin çoğu 402, STANDARD paket senaryoları (kahvaltı, minibar, odalar, planlama, ikram) ise PLAN_REQUIRED alır.
  - Yerel `hotelcost_e2e` veritabanı güncel şemada bile değil (`trialEndsAt` kolonu yok).
- **Öneri:** e2e ve demo şirketlerini "demo" olarak ya da uzak bir ödeme bitiş tarihiyle oluşturmak; e2e veritabanını her çalıştırmada yeniden kurmak (setup-e2e zaten böyle yapıyor); servislere dışarıdan saat verilebilmesini sağlamak. Zorluk: küçük–orta.
- **Güven:** Kod okumayla doğrulandı. 30. günden sonraki kesin hata biçimleri varsayım.

### QA-04 · ORTA · Servisler iyi test ediliyor ama rotalar, dışa aktarımlar ve gece işleri değil; kapsam eşiği yok
- **Kanıt:** Yukarıdaki kapsam tablosu: API rotaları %7,6, dışa aktarımlar %40, `nightly.ts` %0, `onboarding.ts` %0.
- **Öneri:**
  - Rota düzeyinde bir yetki ve paket matrisi testi (`billing.test.ts` bunun örüntüsünü zaten gösteriyor)
  - `runNightly` testi
  - Dışa aktarma toplamlarının sayfa toplamlarıyla aynı olduğunu doğrulayan testler
  - CI'da `src/server/**` için bir kapsam eşiği
- Zorluk: orta.

### QA-05 · DÜŞÜK · Test süresinin %41'i tek bir dosyada
- **Kanıt:** `demo-dataset.test.ts` 121 sn sürüyor.
- **Öneri:** "Yavaş" olarak etiketlenip gece çalıştırılmalı ya da daha küçük bir profille test edilmeli.

### QA-06 · BİLGİ · Uçtan uca testler ve kapsam eşiği CI'da yok

> **Çapraz inceleme:** TOOL-01 ile birleştirildi.
- **Kanıt:** `.github/workflows/ci.yml` yalnızca tip kontrolü, lint, VBA eşitlik kontrolü, birim ve entegrasyon testlerini çalıştırıyor.
- Ayrıntı için TOOLKIT_INVENTORY TOOL-01'e bakın.

## 4. Kritik iş akışları ve testleri

| İş akışı | Birim | Entegrasyon | Uçtan uca |
|---|---|---|---|
| Stok defteri / FIFO / ortalama maliyet, eşzamanlılık | var | var (çok sayıda) | var |
| Mal kabul ve kabul maliyeti | var (döviz dahil) | var | var |
| Satın alma siparişi oluşturma ve onay | – | var (**görev ayrılığı testi yok**) | – |
| Reçete, alt reçete, onay, düzenleme | var | var | var |
| Satış aktarımı ve stoktan düşüm | – | var | – |
| Sapma ayrıştırması | var | var | var |
| Fire + onay | var | var | var |
| Sayım + onay / ret | – | var | var (demo) |
| Dönem kapama / yeniden açma | – | var | – |
| Kahvaltı / minibar / ikram | var | var | var |
| Oda maliyeti / işletme giderleri | var | var | var |
| Faturalama / paketler / salt okunur mod | var | var (11 test) | **yok** |
| Otomatik sipariş ve e-postası | var | var | kısmen |
| Kiracılar / davetler | – | var | var |
| Dışa aktarma | var | var | yalnızca indirme (değer kontrolü yok) |
| Yetkiler | – | var (11 rol × 14 yetenek = 154 kontrol) | var |

**Hiç testi olmayan kritik akışlar:**
- Gece işi (`runNightly`), süresi dolan şirketlerde ne yaptığı dahil
- Kayıt sonrası başlangıç akışı (onboarding)
- Satın alma, bütçe ve reçete onayında görev ayrılığı (şu an kontrol de yok; ARCHITECTURE_AUDIT BIZ-01/02)
- Stok düzeltmesi onay eşiği (ayar uygulanmıyor; BIZ-03)
- Servis veya arayüz düzeyinde dövizli mal kabul
- Faturalama senaryoları:
  - ödeme sırasında paket değişimi (yükseltme / düşürme)
  - süresi dolduktan sonra kesilen bildirim
  - `setTenantPlan`
  - fatura kesme kilidinin eşzamanlılığı
  - platform konsolu arayüzü
- Ağırlığa göre mal kabul maliyeti dağıtımı (servis düzeyinde)
- Rota bazında sistematik yetki testi: 198 rota işleyicisi var; 49 yetki adından 35'i yalnızca roller üzerinden dolaylı test ediliyor
- Dışa aktarma toplamı = sayfa toplamı (bu denetimde elle doğrulandı, testi yok)
- Gerçek SMTP ile e-posta gönderimi (testler bellek içi gönderici kullanıyor)

**Regresyon riski yüksek noktalar:**
- `ledger.ts`: eksi stok ve FIFO dalları var, ama iyi test edilmiş
- `scripts/recipes-refreeze.ts`: her Vercel dağıtımında çalışıyor ve bir reçete hata verirse dağıtımı durduruyor
- Faturalama önbelleği (QA-02)

## 5. Güçlü yönler
- **Hesap motorları:** Decimal ile kesin para hesabı. Tek kayıt yolu (`postMovement`) bakiye satırını kilitliyor. 22,5 bin harekette tüm mutabakatlar tutuyor.
- **Entegrasyon testleri:** 306 test, her dosya kendi şirketiyle yalıtılmış. CI bunları gerçek Postgres üzerinde ve UTC dışı bir saat diliminde çalıştırıyor.
- **Uçtan uca testler:** Ayrı bir e2e veritabanı ve axe erişilebilirlik kontrolleri var.
- **Dışa aktarma:** CSV'ler formül enjeksiyonunu etkisizleştiriyor.

## 6. Doğrulanamayanlar
- Playwright uçtan uca testleri (kurala uygun olarak çalıştırılmadı)
- Gerçek SMTP gönderimi
- Vercel gece işi ve canlı dağıtımlar
- Micros/Opera botunun gerçek çalışması
- PDF ve Excel içerikleri (yalnızca CSV toplamları karşılaştırıldı)
- Büyük veri hacmindeki davranış (yalnızca kod okumayla değerlendirildi; PERFORMANCE_AUDIT'e bakın)
