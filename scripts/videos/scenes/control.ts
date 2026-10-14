import type { Locator, Page } from "@playwright/test";
import type { Scene, Studio } from "../studio";
import { exports, filterButton, info } from "./common";

/** A card (`<section>` with an `<h2>` title) by its title. */
const card = (p: Page, title: RegExp) => p.locator("section").filter({ has: p.getByRole("heading", { level: 2, name: title }) }).first();

/** Answers the next window.prompt / confirm with `text` (the dialog itself is not in the recording). */
const answer = (p: Page, text: string) => p.once("dialog", (d) => void d.accept(text));

const visible = async (l: Locator) => (await l.count()) > 0 && (await l.first().isVisible());

/** Scrolls an element to the middle of the screen (clear of the caption) and rings it. */
async function focus(s: Studio, target: Locator, text?: string) {
  await s.scroll(target);
  await s.show(target, text);
}

const approvals: Scene = {
  slug: "approvals",
  path: "/approvals",
  title: "Onaylar",
  async run(s) {
    const p = s.page;
    await s.say("Onaylar sayfası, sınırı aşan fireleri, sayım farklarını ve silme taleplerini karar için tek yerde toplar.");
    await info(s);
    const pending = card(p, /^Bekleyen/i);
    await s.show(pending, "“Bekleyen” listesinde her talebin zamanı, türü, talep eden kişi ve gerekçesi görünür.");
    const row = pending.getByRole("row").filter({ has: p.getByRole("button", { name: "Onayla" }) }).first();
    if (await visible(row)) {
      await s.show(row.getByRole("cell").nth(4), "Ayrıntıda ürün, miktar ve tutar yazar; kaydı açmadan karar verebilirsiniz.");
      await s.show(row.getByRole("button", { name: "Reddet" }), "“Reddet” için gerekçe zorunludur; reddedilen fire stoktan düşülmez.");
      answer(p, "Şef ile kontrol edildi, fire uygun.");
      await s.click(row.getByRole("button", { name: "Onayla" }), "Talep uygunsa “Onayla”ya basın ve isterseniz kısa bir not ekleyin.");
    }
    await s.say("Kendi talebinizi onaylayamazsınız: talep eden ile karar veren her zaman farklı kişidir.");
    await s.show(card(p, /^Son kararlar/i), "“Son kararlar” listesinde kimin, ne zaman, hangi notla karar verdiği saklanır.");
    await exports(s);
    await s.say("Onaylanan fire stoktan düşer; bekleyen talepler ay sonu kapanış kontrol listesinde de görünür.");
  },
};

const periods: Scene = {
  slug: "periods",
  path: "/periods",
  title: "Maliyet dönemleri",
  async run(s) {
    const p = s.page;
    await s.say("Her ay bir maliyet dönemidir; dönem açıkken stok, fire, gider ve satış kayıtları o aya yazılır.");
    await info(s, "Durumların ve renklerin anlamı başlığın yanındaki ⓘ simgesinde yazar.");
    const cur = card(p, /^\d{4}-\d{2} ·/);
    await s.show(cur.locator("header").first(), "Kartta dönemin durumu yazar: Açık, Ön kapanış, Kapalı veya Yeniden açılmış.");
    await s.show(cur.getByRole("table"), "Ay sonu kontrol listesi kapanış adımlarını tek tek kontrol eder; yıldızlı satırlar zorunludur.");
    await s.say("Kırmızı: zorunlu bir adım eksik. Sarı: kontrol edilecek bir konu var. Yeşil: her şey tamam.");
    await s.show(cur.getByRole("button", { name: "Ön kapanış" }), "Ön kapanışta yalnızca yönetici, maliyet kontrolörü ve muhasebe son düzeltmeleri girebilir.");
    await s.show(cur.getByRole("button", { name: "Dönemi kapat" }), "“Dönemi kapat” ayı kilitler: kayıt girilemez, sonuçlar sabit bir görüntü olarak saklanır.");
    await s.clear();
    await s.say("Kırmızı dönem ancak gerekçeyle kapatılır; kapalı ay da yalnızca yazılı gerekçeyle yeniden açılır.");
    await exports(s);
    await s.say("Kapanan ayın raporları “Raporlar” arşivinde saklanır; açma ve kapamalar denetim kaydına yazılır.");
  },
};

const review: Scene = {
  slug: "review",
  path: "/review",
  title: "Maliyet Değerlendirmesi",
  async run(s) {
    const p = s.page;
    const m = p.locator("main");
    await s.say("Bu sayfa dönemin en büyük fiyat artışlarını, firelerini, kritik stoğunu ve reçete değişikliklerini bir arada gösterir.");
    await info(s);
    const from = p.locator("#fb-from");
    await s.show(from, "Tarih aralığı ayın 1'inden bugüne gelir; haftalık bakış için başlangıcı değiştirin.");
    await from.fill("2026-10-08");
    await s.wait(700);
    await filterButton(s);
    await s.click(m.getByRole("link").filter({ hasText: /^Fire/i }).first(), "Üstteki kartlar tıklanabilir: “Fire” kartı fire veren ürünlerin tam listesini açar.");
    await s.show(card(p, /En Çok Fire/i), "En pahalı fireler en üstte; ürün adı Fire sayfasını aynı tarihlerle açar.");
    await s.click(p.getByRole("link", { name: "Özete dön" }), "“Özete dön” ile özete geri dönün.");
    const inc = card(p, /En Çok Maliyet Artışı/i);
    await s.show(inc.getByRole("link", { name: /^Tümünü gör/ }), "Özette her liste ilk 5 satırı gösterir; “Tümünü gör” listenin tamamını açar.");
    await exports(s);
    const crit = card(p, /Kritik Stok/i);
    const rows = crit.getByRole("table").getByRole("row");
    const kritik = rows.filter({ hasText: /Kritik$/ }).getByRole("link").first();
    const link = (await visible(kritik)) ? kritik : rows.getByRole("link").first();
    await s.scroll(crit);
    await s.click(link, "Kritik stoktaki bir ürüne tıklayın: Stok sayfası o ürünle süzülmüş olarak açılır.");
    await s.wait(1200);
    await s.say("Bu sayfayı haftalık maliyet toplantısında kullanın; her satır sizi ilgili sayfaya götürür.");
  },
};

const calendar: Scene = {
  slug: "calendar",
  path: "/calendar",
  title: "Kontrol takvimi",
  async run(s) {
    const p = s.page;
    await s.say("Kontrol takvimi, ayın tekrarlayan maliyet kontrollerini hafta hafta listeler.");
    await info(s);
    await s.show(p.locator("#cal-month"), "Başka bir ay için ayı seçip “Filtrele”ye basın.");
    await s.click(p.locator("main").getByRole("link").filter({ hasText: /^Gecikmiş/i }).first(), "Kartlar geciken, tamamlanan ve açık kontrolleri sayar; tıklayınca liste süzülür.");
    await s.click(p.getByRole("link", { name: "Tümünü göster" }));
    const week = (n: number) => p.locator("section").filter({ has: p.getByRole("heading", { level: 2, name: new RegExp(`^${n}\\. hafta`) }) }).first();
    await s.show(week(1).locator("header").first(), "1. hafta ayın 1–7. günleri, 2. hafta 8–14. günleridir; bir ay en fazla 5 haftadır.");
    await s.show(week(1).getByRole("link", { name: /Kontrol listesi \(PDF\)/ }), "Her haftanın kontrol listesi PDF olarak yazdırılabilir.");
    // a control that can still be signed off: this week's first, else the weeks around it
    const signable = (n: number) => week(n).getByRole("row").filter({ has: p.getByRole("button", { name: "Tamamla" }) }).first();
    let w = 2;
    for (const n of [2, 1, 3]) if (await visible(signable(n))) { w = n; break; }
    const row = signable(w);
    if (await visible(row)) {
      await focus(s, row.getByRole("cell").nth(4), "“Sistemdeki kanıt” bulunan kaydı gösterir, ama kontrolü kendiliğinden tamamlamaz.");
      const title = ((await row.getByRole("cell").nth(1).textContent()) ?? "").trim();
      answer(p, "Kayıtlar gözden geçirildi, sorumluyla konuşuldu.");
      await s.click(row.getByRole("button", { name: "Tamamla" }), "Kontrolü yapınca “Tamamla”ya basın; isterseniz kısa bir not yazın.");
      const done = week(w).getByRole("row").filter({ hasText: title }).filter({ hasText: /\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}/ }).first();
      await focus(s, (await visible(done)) ? done : week(w), "Tamamlanan kontrol haftasında kalır; tamamlanma tarihi ve kimin yaptığı yanında yazar.");
    } else {
      await s.say("Kontrolü yapınca satırdaki “Tamamla”ya basın: kontrol haftasında kalır, yanında tamamlanma tarihi yazar.");
    }
    await focus(s, card(p, /Kontrol görevi ekle/i), "En alttan yeni bir tekrarlayan kontrol, sorumlu rolüyle birlikte eklenir.");
    await exports(s);
    await s.say("Ay sonu kapanışı “Maliyet dönemleri” sayfasındaki kontrol listesiyle birlikte izlenir.");
  },
};

const reports: Scene = {
  slug: "reports",
  path: "/reports",
  title: "Raporlar ve paket",
  async run(s) {
    const p = s.page;
    await s.say("Raporlar sayfası aylık yönetim maliyet paketini hazırlar ve üretilen her raporu arşivde saklar.");
    await info(s);
    const pack = card(p, /Aylık Yönetim Maliyet Raporu Paketi/i);
    await s.show(p.getByLabel("Paket ayı"), "Paketin ayını seçin; varsayılan olarak geçen ay gelir.");
    await s.click(pack.getByRole("button", { name: /Yönetim paketini indir/ }), "“Yönetim paketini indir” özet, Y&İ, odalar, işçilik, enerji, fire, stok ve sapmayı tek PDF'te toplar.");
    await p.getByRole("button", { name: /Yönetim paketini indir/ }).waitFor({ timeout: 90_000 });
    await p.waitForLoadState("networkidle").catch(() => undefined);
    await s.say("Paket, ekranlar ve Excel ile aynı maliyet motorundan hazırlanır; rakamlar birbirini tutar.");
    const archive = card(p, /^Arşiv/i);
    await s.show(archive, "Hazırlanan her rapor arşive düşer: dönem, filtreler, hazırlayan, veri sürümü ve dönem özeti (hash).");
    const verify = archive.getByRole("button", { name: "Doğrula" }).first();
    if (await visible(verify)) {
      await s.click(verify, "“Doğrula”, raporun bugün de aynı sonuçla üretilip üretilmediğini kontrol eder.");
      await s.show(archive.getByRole("row").nth(1).getByRole("cell").last(), "Rakamlar değişmediyse “yeniden üretilebilir” yazar; kapalı aylar için bu bir güvencedir.");
    } else {
      await s.say("Kapalı aylarda “Doğrula” düğmesi, raporun aynı sonuçla yeniden üretilip üretilmediğini kontrol eder.");
    }
    await exports(s, "Arşiv listesinin kendisi de PDF, Excel veya CSV olarak indirilebilir.");
    await s.say("Ay kapanınca dönemin anlık görüntüsü de burada saklanır; Excel tam maliyet raporu “Excel raporu” sayfasındadır.");
  },
};

const dataQuality: Scene = {
  slug: "data-quality",
  path: "/data-quality",
  title: "Veri kalitesi",
  async run(s) {
    const p = s.page;
    await s.say("Veri kalitesi merkezi, maliyet rakamlarına ne kadar güvenilebileceğini gösterir; tahminler asla kesin rakam gibi sunulmaz.");
    await info(s);
    await s.show(p.locator("main a").filter({ hasText: /Doğruluk puanı/i }).first(), "Doğruluk puanı ve güven düzeyi, aşağıdaki kontrollerin özetidir.");
    await s.show(p.locator("main a").filter({ hasText: /Satış eşleştirme/i }).first(), "Reçete, maliyet, satış eşleştirme ve sayım güncelliği yüzdeleri de tıklanabilir.");
    const checks = p.locator("#checks");
    await s.scroll(checks);
    await s.show(checks, "Her kontrol bir karttır: yeşil rakam sorun yok, sarı rakam incelenecek kayıt sayısıdır.");
    const target = checks.getByRole("link").filter({ hasText: /Listeyi göster/ }).filter({ hasText: /Stok Sayımı/i }).first();
    const pick = (await visible(target)) ? target : checks.getByRole("link").filter({ hasText: /Listeyi göster/ }).first();
    await s.click(pick, "Bir karta tıklayın: kayıtları hemen altında listelenir.");
    const detail = p.locator("#detail");
    await detail.waitFor();
    await focus(s, detail.getByRole("table"), "Listede kayıt, sorunun ne olduğu ve düzeltileceği yer yan yana yazar.");
    await s.show(detail.getByRole("table").getByRole("row").nth(1).getByRole("link").last(), "Son sütundaki bağlantı sizi doğrudan düzeltmenin yapılacağı sayfaya götürür.");
    await s.click(detail.getByRole("link", { name: "Kapat" }), "“Kapat” listeyi gizler.");
    await exports(s, "Kontrollerin sonucu PDF veya Excel olarak indirilip ay sonu dosyasına eklenebilir.");
    await s.say("Sorunlar düzeldikçe puan yükselir; ay kapanışından önce bu sayfanın yeşil olması hedeflenir.");
  },
};

const excel: Scene = {
  slug: "excel",
  path: "/excel",
  title: "Excel raporu",
  async run(s) {
    const p = s.page;
    await s.say("Excel raporu, tüm maliyet operasyonunu tek bir makrolu Excel çalışma kitabında (.xlsm) verir.");
    await info(s);
    await s.select(p.locator("#x-group"), "Yiyecek", "Tarih aralığı ayın 1'inden bugüne gelir; isterseniz kategori, departman ya da depo seçin.");
    await s.show(p.getByRole("button", { name: /\.xlsm indir/ }), "“.xlsm indir” dosyayı hemen indirir; açılış sayfasındaki düğmeyle tüm raporlar hazırdır.");
    await s.click(p.getByRole("button", { name: "Arka planda oluştur" }), "Uzun dönemlerde “Arka planda oluştur”u kullanın: siz çalışırken sunucu dosyayı hazırlar.");
    const jobs = p.getByRole("region", { name: /Arka plan raporları/i });
    const download = jobs.getByRole("link", { name: "İndir" }).first();
    await download.waitFor({ timeout: 90_000 }).catch(() => undefined);
    await s.show((await visible(download)) ? download : jobs, "Hazır olunca dosya buradan indirilir ve 24 saat saklanır.");
    await s.show(p.getByRole("button", { name: "Anahtar oluştur" }), "Excel'den yenileme için 30 gün geçerli bir API anahtarı alınır; anahtar yalnızca bir kez gösterilir.");
    await focus(s, card(p, /Son raporlar/i), "Alınan her Excel raporu tarihi, hazırlayanı ve mutabakat sonucuyla arşivlenir.");
    await s.say("Excel'deki rakamlar ekrandakilerle aynı maliyet motorundan gelir; yetkiniz olmayan departmanlar dosyaya girmez.");
  },
};

const audit: Scene = {
  slug: "audit",
  path: "/audit",
  title: "Denetim kaydı",
  async run(s) {
    const p = s.page;
    await s.say("Denetim kaydı, sistemdeki her değişikliği kimin, ne zaman ve neden yaptığıyla saklar.");
    await info(s);
    const table = p.getByRole("table").first();
    await s.show(table.getByRole("row").first(), "Her satırda zaman, kullanıcı, işlem, kayıt türü, önceki ve sonraki değer ile gerekçe yer alır.");
    await s.say("Kayıtlar yalnızca eklenir; veritabanı düzenlemeyi ve silmeyi reddeder. Denetçi için güvenilir bir izdir.");
    const waste = table.getByRole("link", { name: "WasteRecord" }).first();
    const link = (await visible(waste)) ? waste : table.getByRole("link").first();
    await s.click(link, "Kayıt türüne tıklayın: o kaydın bütün geçmişi tek listede süzülür.");
    await s.show(p.getByRole("table").first(), "Artık yalnızca o kayda ait işlemler, önceki ve sonraki değerleriyle listelenir.");
    await s.click(p.getByRole("link", { name: "Filtreyi temizle" }), "“Filtreyi temizle” ile tüm kayıtlara dönersiniz.");
    await exports(s);
    await s.say("Dönem açma-kapama, onaylar ve ayar değişiklikleri de buraya yazılır; şüpheli bir rakamın kaynağını buradan izleyin.");
  },
};

const integrity: Scene = {
  slug: "integrity",
  path: "/integrity",
  title: "Hesaplama bütünlüğü",
  async run(s) {
    const p = s.page;
    await s.say("Hesaplama bütünlüğü, maliyet motorunun güvenlik kontrolüdür: bakiyeler, FIFO katmanları ve maliyet defteri birbirini tutuyor mu?");
    await info(s);
    await s.click(p.getByRole("button", { name: "Bütünlük kontrolünü çalıştır" }), "“Bütünlük kontrolünü çalıştır” tüm ilişkileri baştan kontrol eder; hiçbir veriyi değiştirmez.");
    const run = p.locator("#run section").first();
    await run.waitFor({ timeout: 60_000 });
    await p.waitForLoadState("networkidle").catch(() => undefined);
    await s.wait(600);
    await s.show(run.getByRole("table"), "Sonuçta her kontrol ayrı satırdadır: Başarılı, Uyarı veya Hata, yanında bulgu sayısı.");
    const finding = run.getByRole("link").filter({ hasText: /Aç/ }).first();
    if (await visible(finding)) {
      await focus(s, finding, "Her bulgu kaydın kendisine bağlanır: beklenen ve bulunan değer yan yana yazar, “Aç” kaydı açar.");
    } else {
      await s.say("Bir bulgu çıkarsa kaydın bağlantısı, beklenen ve bulunan değerle birlikte satırın altında listelenir.");
    }
    await s.show(p.getByRole("button", { name: /Bakiyeleri defterden/ }), "“Bakiyeleri defterden yeniden oluştur” yalnızca türetilmiş bakiyeleri düzeltir; defterler değişmez.");
    await s.clear();
    await s.say("Her çalıştırma sayfanın altındaki listede saklanır; eski bir kontrolün sonucu tarihine tıklanarak açılır.");
    await exports(s);
    await s.say("Ay kapanışından önce bu kontrolü çalıştırın: raporlar ancak defterler tutarlıysa güvenilirdir.");
  },
};

const admin: Scene = {
  slug: "admin",
  path: "/admin",
  title: "Yönetim",
  async run(s) {
    const p = s.page;
    await s.say("Yönetim sayfasında kullanıcılar, oteller, departmanlar, depolar, kategoriler ve otel ayarları yönetilir.");
    await info(s);
    await s.show(card(p, /Bu Otelin Kullanıcıları/i), "Kullanıcılar sekmesinde her kişinin rolü, departmanları ve otelleri görünür; rol, yetkileri belirler.");
    await s.click(p.getByRole("tab", { name: "Otel ayarları" }), "“Otel ayarları” sekmesinde otelin eşikleri belirlenir.");
    await s.show(p.locator("#s-wa"), "Fire ve sayım farkı için onay sınırını aşan kayıtlar Onaylar sayfasına düşer.");
    await s.click(p.getByRole("tab", { name: "Eğitim videoları" }), "“Eğitim videoları” sekmesi her sayfanın “Nasıl kullanılır?” videosunu yönetir.");
    const videos = card(p, /Eğitim videoları/i);
    await s.show(videos.locator("input").first(), "Alan boşken sayfanın hazır videosu oynar; kendi YouTube ya da Vimeo adresinizi yazarsanız o gösterilir.");
    await s.clear();
    await s.say("Formun altındaki “Ayarları kaydet” ile adresler şirketin tüm otellerinde geçerli olur.");
    await s.say("Buradaki her değişiklik denetim kaydına yazılır; deftere bağlı hiçbir kayıt silinmez, yalnızca pasife alınır.");
  },
};

export const controlScenes: Scene[] = [approvals, periods, review, calendar, reports, dataQuality, excel, audit, integrity, admin];
