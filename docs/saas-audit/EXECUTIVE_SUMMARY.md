# Yönetici Özeti

**Ürün:** HotelCost, otel maliyet kontrolü SaaS.
**Kapsam:** `main` 39083c6. Denetim 30 Ekim 2026'da yapıldı.
**Hedefler:** GM demosu Kasım başında, lansman Kasım sonunda.

## Kısa sonuç

Ürünün çekirdeği sağlam. Maliyet ve stok hesapları kuruşu kuruşuna tutuyor, testler geniş ve hepsi geçiyor, kiracı izolasyonu veritabanı düzeyinde korunuyor. Önceki güvenlik denetiminin 32 bulgusunun hepsi kapalı.

**Lansmanı riske atan sorunlar operasyon ve iş kuralı tarafında.** Bunlar:
- faturalama varsayılanları;
- Vercel dağıtım ayarları;
- dışa aktarma boyut sınırı;
- birkaç iç kontrolün kâğıt üzerinde kalması.

Çoğu küçük işlerdir. İkisi yalnızca bir yapılandırma kontrolüyle başlıyor.

**Değerlendirme:**
- **GM demosu: hazır**, dört küçük düzeltmeyle (bkz. "GM demosu").
- **Lansman: koşullu hazır.** Dört P0 maddesi kapanmalı ve 23 Kasım'dan önce faturalama kontrolü yapılmalı.

## Genel sağlık

| Alan | Durum | Özet |
|---|---|---|
| Hesap doğruluğu | 🟢 İyi | Tüm mutabakatlar tam tuttu (stok, FIFO, reçete, sapma, dışa aktarma toplamları). |
| Testler | 🟢 İyi | 477 test geçti (171 birim, 306 entegrasyon). Servis kapsamı %93; rota kapsamı %7,6. Uçtan uca testler CI'da yok. |
| Güvenlik | 🟡 Orta | Kritik bulgu yok. Yüksek: SEC-01 (ücretsiz Premium) ve Next.js yaması. Orta: 2 yetki boşluğu, MFA ve şifre sıfırlama yok. |
| Mimari ve dağıtım | 🟠 Riskli | Önizleme derlemeleri canlı veritabanını migrate edebiliyor. Büyük dışa aktarmalar Vercel'in 4,5 MB sınırını aşıyor. |
| Veritabanı | 🟠 Riskli | Faturalama migrasyonu mevcut kiracılara 30 günlük deneme süresi başlattı. Eşzamanlı yazmalarda numara çakışması ve kilitlenme var. |
| İş kuralları | 🟠 Riskli | Düzeltme onay eşiği hiç uygulanmıyor. Satın almada görev ayrılığı yok. Reçete düzenlemesi kendini onaylıyor (ürün kararı). |
| Performans | 🟡 Orta | Normal ekranlar hızlı. Büyük otel ölçeğinde tam dışa aktarma ve toplu POS aktarımı süre ve bellek sınırlarını zorluyor. |
| Arayüz ve erişilebilirlik | 🟢/🟡 | axe taramasında ciddi veya kritik ihlal yok. Gösterge paneli telefonda yatay kayıyor. Bazı İngilizce metinler ve menü çıkmazları var. |

**Bulgu sayıları (çapraz incelemeden sonra, birleştirilmiş):**

| Ciddiyet | Sayı |
|---|---|
| KRİTİK | 0 (2 koşullu) |
| YÜKSEK | 9 |
| ORTA | 37 |
| DÜŞÜK | 23 |
| BİLGİ | 2 |

Toplam 71 numaralı bulgu var. Belgelerde bunlara ek olarak kimliği olmayan küçük notlar da bulunuyor.

## Kritik ve yüksek bulgular

Doğrulanmış kritik bulgu yok. Aşağıdaki iki madde canlı ortam kontrolünün sonucuna göre **kritik** olabilir.

| # | Kimlik | Bulgu | Neden önemli | Tahmin |
|---|---|---|---|---|
| 1 | **DB-06** | Faturalama migrasyonu mevcut kiracılara 30 günlük deneme verdi. | Platform şirketi olan bir canlı veritabanında, ödeme tarihi girilmemiş her müşteri **yaklaşık 23 Kasım**'da salt okunur moda düşer. Kapatma anahtarı (`BILLING_ENFORCEMENT=off`) zaten var. Canlıda kontrol edilmeli. | 1 saat + Küçük |
| 2 | **ARCH-03** | Her Vercel derlemesi, önizlemeler dahil, `prisma migrate deploy` çalıştırıyor. | Preview ortamı canlı Neon'a bağlıysa, her dal canlı şemayı gözden geçirilmeden değiştirir. | Küçük |
| 3 | **SEC-01** | İlk SaaS müşterisinin yöneticisi demo şirketleri yükleyebiliyor. | Her zaman PREMIUM olan demo şirketleri ve oteller faturalamayı atlatıyor. | Küçük |
| 4 | **ARCH-02** | `next@15.5.27` için kritik ve yüksek danışma notları var. | İstismar yolu bu kurulumda kapalı görünüyor, ama yama sürümü hazır. | Küçük |
| 5 | **ARCH-01** | Excel ve tam maliyet dışa aktarmaları tek yanıtta dönüyor. | 2–3 aydan uzun ya da büyük otel dışa aktarmaları Vercel'de 413 alır. | Orta |
| 6 | **BIZ-03** | "Şu tutarın üstündeki düzeltmeler onaya gitsin" ayarı hiç uygulanmıyor. | Müşteriye görünen bir kontrol aslında yok. 50.000'lik düzeltme onaysız işlendi. | Küçük–orta |
| 7 | **BIZ-02** | Satın alma ve bütçede oluşturan kişi kendi kaydını onaylayabiliyor. | Temel iç kontrol eksik. Rol şablonları müşteri tarafından değiştirilemiyor. | Küçük + Orta |
| 8 | **PERF-01** | Tam maliyet dışa aktarımı stres ölçeğinde 62–85 sn ve 4,4 GB bellek kullanıyor. | Büyük otellerde zaman aşımı. | Büyük |
| 9 | **PERF-03** | 3.000 POS satırı 33 sn ve 24 bin sorgu sürüyor. | Büyük otelin günlük aktarımı süre sınırına yaklaşıyor ve diğer yazmaları kilitliyor. | Küçük + Büyük |
| 10 | **BIZ-01** *(ORTA, ürün kararı)* | Reçete düzenlemesi kendini onaylıyor. | "Reçeteler onaydan geçer" deniyorsa, dördüncü göz kontrolü yok. | Karar + Orta |

## En önemli 10 iyileştirme

1. **DB-06:** Canlıda faturalama durumu kontrol edilmeli. Müşterilerin `paidThrough` alanı ayarlanmalı ya da `BILLING_ENFORCEMENT=off` yapılmalı. Son tarih 23 Kasım.
2. **ARCH-03:** Migrasyon yalnızca `VERCEL_ENV=production` iken çalışmalı. Önizlemelere ayrı Neon dalı verilmeli. Canlı migrasyondan önce anlık görüntü alınmalı.
3. **SEC-01:** Demo yükleme uç noktaları faturalama açıkken kapatılmalı ya da yalnızca platform yöneticisine açılmalı.
4. **ARCH-02:** Next.js 15.5.28 ve bağımlılık yamaları; CI'a `npm audit` ve Dependabot.
5. **ARCH-01:** Dosyalar Blob/S3 üzerinden imzalı adresle verilmeli. O zamana kadar tarih aralığı sınırlanmalı.
6. **BIZ-03:** Düzeltme onay eşiği uygulanmalı ya da ayar kaldırılmalı.
7. **BIZ-02:** Sipariş, bütçe ve reçete onayında oluşturan kişi onaylayamamalı. Ardından rol düzenleme eklenmeli.
8. **SEC-02 ve SEC-03:** Abonelik dolsa da erişim kaldırılabilmeli. Dağıtım modülü departman kapsamına alınmalı.
9. **DB-01 ve PERF-03:** Numaralandırma servisi, kilitlenmede yeniden deneme, POS aktarımının parçalara bölünmesi ve toplu yazma.
10. **TOOL-01:** CI'a uçtan uca testler, güvenlik taraması ve kapsam eşiği eklenmeli.

## GM demosu

GM'in görebileceği her şey bu hafta düzeltilebilir. Toplam yaklaşık bir gün sürer.

- **FE-01:** Gösterge paneli telefonda 236 px yatay kayıyor. `Card` bileşenine tek bir sınıf eklemek yetiyor.
- **DEMO-01:** `docs/VERCEL.md` çalışan demo şifrelerini, platform konsolu hesabı dahil, yayınlıyor. Demo adresi herkese açıksa şifreler değiştirilmeli.
- **BIZ-15:** Demo verisi %46 "açıklanamayan" sapma gösteriyor. Bir maliyet kontrolcüsü bunu ilk soruyu sorduğu yer olarak görür. Demo üreticisi ayarlanmalı.
- **UX-03:** Şef rollerinde menüde görünen ama "yetkiniz yok" diyen sayfalar var.

Bunlardan sonra canlı demo yeniden yüklenmeli. Bu işlem onayınızı gerektirir.

## Doğrulanamayanlar

Aşağıdakiler canlı ortam erişimi gerektirdiği için varsayım olarak kaldı. Her birinin nasıl doğrulanacağı ARCHITECTURE_AUDIT ve MASTER_ACTION_PLAN belgelerinde yazılı.

- Canlı veritabanında platform şirketi ve ödeme tarihi olmayan müşteri olup olmadığı (DB-06).
- Vercel Preview ortamının canlı Neon'a bağlı olup olmadığı (ARCH-03).
- 4,5 MB sınırının canlıda 413 ürettiği (ARCH-01). Boyutlar ölçüldü, sınır Vercel belgesinden alındı.
- Neon PITR saklama süresi (DB-05).
- Gerçek büyük otel hacimleri. Ölçekler staging verisinden tahmin edildi.

## Belgeler

| Belge | İçerik |
|---|---|
| [PROJECT_OVERVIEW](PROJECT_OVERVIEW.md) | Teknoloji, modüller, veri modeli, kiracılık, dağıtım, iş akışları |
| [ARCHITECTURE_AUDIT](ARCHITECTURE_AUDIT.md) | ARCH, DB ve BIZ bulguları |
| [SECURITY_AUDIT](SECURITY_AUDIT.md) | SEC, BE ve NV bulguları; önceki 32 bulgunun durumu |
| [PERFORMANCE_AUDIT](PERFORMANCE_AUDIT.md) | Ölçümler ve PERF bulguları |
| [UI_UX_AUDIT](UI_UX_AUDIT.md) | FE ve UX bulguları; axe sonuçları |
| [QA_AUDIT](QA_AUDIT.md) | Test çalıştırmaları, kapsam, mutabakatlar, QA bulguları |
| [TOOLKIT_INVENTORY](TOOLKIT_INVENTORY.md) | Değerlendirilen araçlar ve öneriler |
| [MASTER_ACTION_PLAN](MASTER_ACTION_PLAN.md) | Çapraz inceleme sonuçları, P0–P3 yol haritası, takvim, onaylar |

Denetim yalnızca belgeleme yaptı. Kaynak kod, şema, yapılandırma ve canlı ortam değiştirilmedi; hiçbir bulgu düzeltilmedi.
