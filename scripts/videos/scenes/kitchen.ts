import type { Locator, Page } from "@playwright/test";
import type { Studio, Scene } from "../studio";
import { exports, filterButton, info } from "./common";

/** A summary card (Stat) by its label. */
const stat = (p: Page, label: string): Locator => p.getByText(label, { exact: true }).first().locator("xpath=../..");
/** The row of summary cards a Stat belongs to. */
const stats = (p: Page, label: string): Locator => stat(p, label).locator("xpath=..");
/** A Card by its heading (headings are title-cased, so match case-insensitively). */
const card = (p: Page, title: RegExp): Locator => p.locator("section").filter({ has: p.getByRole("heading", { name: title }) });
/** The date filter: shown with its default range, applied with "Filtrele". */
const dates = (s: Studio) => filterButton(s, "Tarihler ayın 1'inden bugüne gelir; değiştirirseniz “Filtrele”ye basın.");

const recipes: Scene = {
  slug: "recipes",
  path: "/recipes",
  title: "Reçeteler",
  async run(s) {
    const p = s.page;
    await s.say("Reçeteler: her yemeğin standart reçetesi ve bugünkü porsiyon maliyeti.");
    await info(s);
    await s.select(p.locator("#rf-type"), "KAFE", "Reçete türünü seçin, örneğin Kafe…");
    await filterButton(s, "…ve “Filtrele”ye basın.");
    await s.show(card(p, /^\d+ reçete$/i), "Listede maliyet, fiyat, maliyet %, marj ve oluşturma / güncelleme tarihi var.");
    await s.click(p.getByRole("link", { name: "Cappuccino", exact: true }), "Ayrıntı için reçeteye tıklayın.");
    await s.show(p.getByText(/^Oluşturuldu:/).locator(".."), "Oluşturulma, son güncelleme ve yürürlükteki sürüm üstte yazar.");
    await s.show(card(p, /maliyet dökümü/i), "Maliyet dökümü: malzeme miktarı, birim maliyet ve satır maliyeti.");
    await s.show(card(p, /^sürümler$/i), "Sürümler: tarihleri, o anki porsiyon maliyeti ve değişiklik nedeni.");
    await s.select(p.locator("#pi-p"), "Filtre Kahve", "Bir zammın etkisini deneyin: malzemeyi seçin…");
    await s.type(p.locator("#pi-c"), "20", "…yüzdeyi yazın…");
    await s.click(p.getByRole("button", { name: "Hesapla" }), "…ve “Hesapla”ya basın.");
    await s.scroll(card(p, /fiyat değişimi etkisi/i));
    await s.show(card(p, /fiyat değişimi etkisi/i), "Bu malzemeyi kullanan reçetelerin yeni maliyeti ve marjı listelenir.");
    await exports(s, "Reçete kartı PDF veya Excel olarak indirilebilir.");
    await s.say("Reçete maliyetleri teorik tüketimi ve menü mühendisliğini besler.");
  },
};

const buffet: Scene = {
  slug: "buffet",
  path: "/buffet",
  title: "Kahvaltı Maliyet Kontrolü",
  async run(s) {
    const p = s.page;
    await s.say("Kahvaltı maliyeti: ne çıktı, kaç kişi yedi, ne arttı?");
    await info(s);
    await s.show(stats(p, "Kuver başı maliyet"), "Kuver başı maliyet = kahvaltı yiyecek maliyeti ÷ toplam kuver.");
    await s.show(card(p, /kahvaltı günleri/i), "Kuverler iki sütunda: paket dahil ve dahil olmayan.");
    await s.click(p.getByRole("button", { name: "Oluştur" }), "Yeni kayıtta yalnızca öğün ve tarih seçilir: “Oluştur”.");
    await s.type(p.locator("#bc-inc"), "58", "Kuverleri iki kutuya girin: paket dahil ve paket dahil olmayan.");
    await s.type(p.locator("#bc-paid"), "7");
    await s.type(p.locator("#bl-item"), "Beyaz peynir", "Kahvaltıya çıkış: ürün veya yemek seçin, miktar yazın…");
    await s.click(p.getByRole("option", { name: /Beyaz Peynir/i }).first());
    await s.type(p.locator("#bl-qty"), "0,6");
    await s.click(p.getByRole("button", { name: "Kahvaltıya çıkış", exact: true }), "…ve çıkış yapın; ürün depodan maliyetiyle düşer.");
    await s.click(p.getByRole("link", { name: /Kahvaltı sayımı/ }).first(), "Kahvaltıdan sonra “Kahvaltı sayımı”nı açın.");
    const count = p.locator('[data-testid="breakfast-count"]');
    const first = count.getByRole("textbox").first();
    await s.show(first, "Kalanı yazın: Enter alt satıra geçer, T Tüketim, F Fire seçer.");
    await first.focus();
    await first.selectText();
    await p.keyboard.type("0,2", { delay: 150 });
    await p.keyboard.press("t");
    await s.wait(500);
    await p.keyboard.press("Enter");
    await s.wait(500);
    await p.keyboard.type("0,8", { delay: 150 });
    await s.wait(500);
    await p.keyboard.press("f");
    await s.wait(500);
    await s.click(count.getByRole("button", { name: /^Sayımı (yeniden )?kaydet$/ }), "Artan menemen atılacak: Fire. “Sayımı kaydet”e basın.");
    await s.show(p.getByRole("button", { name: "Boş sayım şablonu (PDF)" }), "Kağıtta saymak için boş şablonu (PDF) yazdırın.");
    await s.clear();
    await s.say("Sayımla günün kuver başı maliyeti ve firesi hesaplanır.");
  },
};

const minibar: Scene = {
  slug: "minibar",
  path: "/minibar",
  title: "Minibar",
  async run(s) {
    const p = s.page;
    await s.say("Minibar: oda minibarlarının tüketimi, geliri, kaybı ve dolum ihtiyacı.");
    await info(s);
    await dates(s);
    await s.show(stat(p, "Kayıp"), "“Kayıp”: oda sayımlarında eksik çıkan ürünlerin maliyeti; gizlenmez.");
    await s.show(p.getByText("KAT 1", { exact: false }).first().locator("xpath=../.."), "Oda panosunda turuncu odalar par seviyesinin altında, dolum bekliyor.");
    await s.click(p.getByRole("button", { name: "206", exact: true }), "Bir odaya tıklayın.");
    const panel = p.locator("table").filter({ has: p.getByText("Odada", { exact: true }) });
    await s.select(p.locator("#mb-type"), "Tüketim (ücretlendirilen)", "İşlem türü: tüketim, dolum, iade, fire veya sayım.");
    await s.type(panel.getByRole("textbox").first(), "1", "Miktarı…");
    await s.type(p.locator("#mb-folio"), "206-4471", "…ve folyo numarasını girin.");
    // typing scrolled the narrow room table sideways: back to the item names
    await panel.locator("xpath=..").evaluate((e) => { e.scrollLeft = 0; }).catch(() => undefined);
    await s.click(p.getByRole("button", { name: "Kaydet", exact: true }), "“Kaydet”: maliyet ve gelir odaya işlenir.");
    await s.show(p.getByRole("button", { name: "Par seviyesine doldur" }), "“Par seviyesine doldur” eksikleri depodan tek tıkla tamamlar.");
    await s.show(card(p, /oda dökümü/i), "Oda dökümü: her odanın tüketimi, katkısı ve kaybı; kayıplı satırlar kırmızı.");
    await exports(s);
    await s.say("Minibar hareketleri oda deposunun stoğundan düşer.");
  },
};

const rooms: Scene = {
  slug: "rooms",
  path: "/rooms",
  title: "Oda maliyeti",
  async run(s) {
    const p = s.page;
    await s.say("Oda maliyeti: dolu bir oda gecesinin otele gerçek maliyeti.");
    await info(s);
    await dates(s);
    await s.show(p.locator("main").getByRole("status").first(), "Sarı uyarılar olası çift sayımı ve veri farklarını hatırlatır.");
    await s.show(stats(p, "ADR"), "Doluluk, ADR, RevPAR ve kişi başı oda geliri.");
    await s.show(stat(p, "Satılamayan odaların maliyeti"), "Satılamayan odaların maliyeti: boş kalan odaların taşıdığı yük.");
    await s.show(card(p, /tam oda maliyeti bileşenleri/i), "Tam oda maliyeti bileşenlere ayrılır: kat hizmetleri, işçilik, kanal maliyeti…");
    await s.click(card(p, /gruba göre oda maliyeti/i).getByRole("link", { name: "Kat", exact: true }), "Gruba göre tablo oda tipi, kat veya alan bazında görülebilir.");
    await s.show(card(p, /gruba göre oda maliyeti/i), "Grupların geliri, tam maliyeti ve marjı karşılaştırılır.");
    await exports(s);
    await s.click(p.getByRole("link", { name: "Oda maliyet giderleri" }).first(), "Muhasebede olmayan aylık giderler “Oda maliyet giderleri”nden girilir.");
    await s.show(p.getByRole("textbox", { name: "1. kalem tutarı" }), "Kalemlerin aylık tutarını girin; kısmi dönemlere gün sayısıyla paylaşılır.");
    await s.show(p.getByRole("button", { name: "Ayı kaydet" }), "“Ayı kaydet” ile oda maliyetine yansır. Bordrodaki tutarları tekrar girmeyin.");
  },
};

const operations: Scene = {
  slug: "operations",
  path: "/operations",
  title: "İşletme giderleri",
  async run(s) {
    const p = s.page;
    await s.say("İşletme giderleri: kat hizmetleri, çamaşırhane, işçilik, enerji ve teknik servis.");
    await info(s);
    await dates(s);
    await s.select(p.locator("#ex-cat"), "Kat hizmetleri", "Yeni gider: kategori…");
    await s.select(p.locator("#ex-sub"), "Kimyasallar", "…alt kategori…");
    await s.select(p.locator("#ex-dept"), "Kat Hizmetleri", "…ve departman. Departman boşsa gider otel geneline yazılıp dağıtılır.");
    await s.type(p.locator("#ex-desc"), "Oda temizlik kimyasalları", "Açıklama…");
    await s.type(p.locator("#ex-amount"), "8450", "…ve net tutar.");
    await s.show(p.getByRole("button", { name: "Gideri kaydet" }), "“Gideri kaydet”: gider maliyet defterine tek satır olarak işlenir.");
    await s.click(p.getByRole("link", { name: /^Enerji · / }), "Kategori düğmeleri dönem toplamını gösterir ve listeyi süzer.");
    await s.scroll(card(p, /^giderler \(/i));
    await s.show(card(p, /^giderler \(/i), "Hatalı kayıt silinmez; “Ters kayıt” ile düzeltilir.");
    await s.click(p.getByRole("link", { name: "Enerji", exact: true }), "Her alanın kendi sekmesi var; örneğin Enerji.");
    await s.show(stats(p, "Dolu oda başına"), "Enerji maliyeti dolu oda ve m² başına hesaplanır.");
    await s.scroll(card(p, /^enerji kalemleri$/i));
    await s.show(card(p, /^enerji kalemleri$/i), "Her kalemin faturası, sayaç tüketimi ve birim maliyeti.");
    await s.say("Bu giderler Oda maliyeti ve Maliyet dağıtımı sayfalarında paylaştırılır.");
  },
};

const imports: Scene = {
  slug: "imports",
  path: "/imports",
  title: "İçe aktarma",
  async run(s) {
    const p = s.page;
    await s.say("İçe aktarma: gider, bordro, PMS, ürün kartı ve fiyat listesi dosyaları.");
    await info(s);
    const auto = card(p, /^otomasyon \(micros \/ opera\)$/i);
    await s.show(auto, "Micros ve Opera verilerini, ofisteki Micros bilgisayarında çalışan bot gönderir.");
    await s.say("Bot her gece 05:00'te önceki günü çeker; kapanış bitmemişse 09:00'a kadar 15 dakikada bir yeniden dener.");
    await s.show(auto.getByRole("button", { name: "Micros'u şimdi çalıştır" }), "Gerekirse “Micros'u şimdi çalıştır” ile hemen tetikleyin.");
    await s.show(p.locator("#im-kind"));
    await s.select(p.locator("#im-kind"), "PMS günlük doluluk", "Dosya aktarımında önce veri türünü seçin…");
    await s.click(p.getByText("Şablon", { exact: true }), "…“Şablon” gerekli sütunları gösterir.");
    const box = p.getByRole("textbox", { name: "CSV içeriği" });
    await s.show(box, "Dosyayı seçin ya da CSV içeriğini yapıştırın.");
    await box.fill("business_date,available_rooms,occupied_rooms,out_of_order,out_of_service,guests,room_revenue\n2026-10-14,40,35,0,0,66,176500\n");
    await s.click(p.getByRole("button", { name: "Ön izleme" }), "“Ön izleme” her satırı kontrol eder.");
    await s.scroll(p.getByText(/^\d+ geçerli$/).first().locator(".."));
    await s.show(p.getByText(/^\d+ geçerli$/).first().locator(".."), "Geçerli, geçersiz ve mükerrer satırlar sayılır; aktarım ya hep ya hiç yapılır.");
    await s.show(p.getByRole("button", { name: /satırı aktar$/ }), "Sorun yoksa bu düğmeyle aktarılır; aynı gün ikinci kez alınmaz.");
    await s.scroll(card(p, /aktarma geçmişi/i));
    await s.show(card(p, /aktarma geçmişi/i), "Her dosya geçmişte saklanır; gerekirse “Geri al” ile geri alınır.");
    await s.say("POS satışları ise Satış aktarımı sayfasından alınır.");
  },
};

const menuEngineering: Scene = {
  slug: "menu-engineering",
  path: "/menu-engineering",
  title: "Menü mühendisliği",
  async run(s) {
    const p = s.page;
    await s.say("Menü mühendisliği, kalemleri popülerlik ve birim katkıya göre dört gruba ayırır.");
    await info(s);
    await s.show(p.locator("#departmentId"), "Tek bir satış noktası seçebilirsiniz; burada tümüne bakıyoruz.");
    await filterButton(s);
    await s.show(p.locator("section").filter({ hasText: "Çok satan, yüksek marjlı" }), "Yıldız: çok satar, çok kazandırır. Koruyun.");
    await s.show(p.locator("section").filter({ hasText: "Çok satan, düşük marjlı" }), "Beygir: çok satar, az kazandırır. Porsiyonu ve fiyatı gözden geçirin.");
    await s.show(p.locator("section").filter({ hasText: "Az satan, yüksek marjlı" }), "Bilmece: az satar ama kârlı. Menüde öne çıkarın.");
    await s.show(p.locator("section").filter({ hasText: "Az satan, düşük marjlı" }), "Köpek: az satar, az kazandırır. Değiştirin veya çıkarın.");
    await s.show(card(p, /^ürünler$/i), "Tabloda adet, pay, gelir, maliyet ve marj var; hedefin altındaki marj kırmızı.");
    await s.say("Son sütun, satıştan bu yana reçete maliyetinin ne kadar değiştiğini gösterir.");
    await exports(s);
    await s.say("Maliyetler Reçetelerden, satış adetleri Satış aktarımından gelir.");
  },
};

const savings: Scene = {
  slug: "savings",
  path: "/savings",
  title: "Maliyet tasarrufu",
  async run(s) {
    const p = s.page;
    await s.say("Maliyet tasarrufu: verilerden hesaplanan fırsatlar ve bunlar için açılan aksiyonlar.");
    await info(s);
    await dates(s);
    await s.show(stats(p, "Olası tasarruf (dönem)"), "Olası, beklenen ve gerçekleşen tasarruf; açık ve gecikmiş aksiyonlar.");
    await s.show(card(p, /^fırsatlar$/i), "Her fırsatın tutarı ve dayanağı var: formül ve varsayım açıkça yazılır.");
    const row = p.getByRole("row").filter({ hasText: "Kayıtlı fireyi azaltın" });
    await s.show(row.getByRole("button", { name: "Aksiyon oluştur" }), "“Aksiyon oluştur” ile fırsata yapılacak iş, sorumlu, hedef ve termin atanır.");
    await s.show(card(p, /tasarruf aksiyonları/i), "Aksiyonlarda hedef, gerçekleşen ve fark izlenir; durum satırdan güncellenir.");
    await exports(s);
    await s.say("Fırsatlar fire, satın alma, enerji ve satış kanalı verileriyle yeniden hesaplanır.");
  },
};

const SALES_CSV = [
  "external_id,sale_date,department,pos_code,quantity,net_revenue",
  "MIC-881201,2026-10-13,REST,RST-001,4,3560",
  "MIC-881202,2026-10-13,REST,RST-003,2,2620",
  "MIC-881203,2026-10-13,BAR,BAR-002,6,2880",
  "MIC-881204,2026-10-13,CAFE,CAF-001,12,1080",
  "",
].join("\n");

const sales: Scene = {
  slug: "sales",
  path: "/sales",
  title: "Satış aktarımı",
  async run(s) {
    const p = s.page;
    await s.say("Satış aktarımı POS satışlarını alır; teorik tüketim bu satışlardan hesaplanır.");
    await info(s);
    await s.show(card(p, /aktarma geçmişi/i), "Micros satışları her gece otomatik gelir; her aktarım burada listelenir.");
    await s.show(p.getByText(/^Sütunlar:/), "Elle aktarımda CSV dosyası bu sütunları içermelidir.");
    const file = p.getByLabel("Satış CSV dosyası");
    await s.show(file, "Dosyayı seçin; ön izleme hemen yapılır.");
    await file.setInputFiles({ name: "micros-satis-2026-10-13.csv", mimeType: "text/csv", buffer: Buffer.from(SALES_CSV) });
    await s.wait(1200);
    await s.show(p.getByText(/^\d+ satır$/).first().locator(".."), "Geçerli, geçersiz, mükerrer ve uyarılı satırlar sayılır.");
    await s.show(p.getByRole("button", { name: /satırı kaydet$/ }), "Sorun yoksa bu düğmeyle işlenir; aynı satış iki kez alınmaz.");
    await exports(s);
    await s.say("Reçeteye eşlenmeyen bir POS kodu için kodu ilgili reçeteye ekleyin.");
  },
};

export const kitchenScenes: Scene[] = [recipes, buffet, minibar, rooms, operations, imports, menuEngineering, savings, sales];
