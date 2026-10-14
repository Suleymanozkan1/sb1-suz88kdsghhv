import type { Locator } from "@playwright/test";
import { H, type Scene, type Studio, type Target } from "../studio";
import { exports, filterButton, info } from "./common";

/**
 * The studio rings an element right after `scrollIntoViewIfNeeded`, but the app scrolls smoothly, so a far element was
 * measured mid-scroll and the ring landed beside it. Scroll first (and wait for it), then let the studio act.
 */
async function reveal(s: Studio, t: Target) {
  const l = (typeof t === "string" ? s.page.locator(t) : t).first();
  const b = await l.boundingBox().catch(() => null);
  if (!b || (b.y >= 0 && b.y + Math.min(b.height, 260) <= H - 110)) return;
  await s.clear();
  await l.evaluate((e) => {
    // room below the last element, so it can be scrolled above the caption bar
    document.body.style.paddingBottom = "200px";
    const r = e.getBoundingClientRect();
    const top = r.height > 380 ? r.top - 70 : r.top - (window.innerHeight - r.height) / 2 + 40;
    window.scrollTo({ top: Math.max(0, window.scrollY + top), behavior: "smooth" });
  });
  await s.wait(1100);
}
function steady(s: Studio): Studio {
  return {
    ...s,
    show: async (t, text, ms) => { await reveal(s, t); await s.show(t, text, ms); },
    click: async (t, text) => { await reveal(s, t); await s.click(t, text); },
    type: async (t, value, text) => { await reveal(s, t); await s.type(t, value, text); },
    select: async (t, label, text) => { await reveal(s, t); await s.select(t, label, text); },
  };
}
/** scrolls wide tables back to their first column (ringing a far-right cell scrolls them sideways) */
async function resetX(s: Studio) {
  await s.page.evaluate(() => document.querySelectorAll("*").forEach((e) => { if (e.scrollLeft) e.scrollTo({ left: 0, behavior: "smooth" }); }));
  await s.wait(500);
}
/** a summary card (Stat) by its label: the innermost rounded box holding the label */
const stat = (s: Studio, label: string) => s.page.locator("div.rounded-xl").filter({ has: s.page.getByText(label, { exact: true }) }).last();
/** a Card by its heading text */
const card = (s: Studio, title: string | RegExp) => s.page.locator("section").filter({ has: s.page.locator("h2", { hasText: title }) }).last();
/** picks a product in a ProductPicker combobox */
async function pick(s: Studio, input: Locator, query: string, name: string, text: string) {
  await s.type(input, query, text);
  await s.wait(900);
  await s.click(s.page.getByRole("option", { name: new RegExp(name) }).first());
}
/** "1,234 kg" → 1.234 */
const num = (txt: string) => Number(txt.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".")) || 0;
const trNum = (n: number, digits: number) => n.toFixed(digits).replace(".", ",");

const dashboard: Scene = {
  slug: "dashboard",
  path: "/",
  title: "Gösterge paneli",
  async run(studio) {
    const s = steady(studio);
    const p = s.page;
    await s.say("Gösterge paneli; dönemin maliyetini, olması gereken maliyeti ve farkın nedenini özetler.");
    await info(s);
    await s.show(p.locator("#fb-from"), "Dönem ayın 1'inden bugüne gelir; tarihleri değiştirip “Filtrele”ye basabilirsiniz.");
    await s.show(stat(s, "Gerçekleşen maliyet"), "Gerçekleşen maliyet stok hareketlerinden, teorik maliyet satılanların reçetelerinden gelir.");
    await s.show(card(s, /Gerçekleşen Neden Teorikten/i), "Bu kart farkı nedenlerine ayırır; kalan “Açıklanamayan” tutar kontrolün asıl odağıdır.");
    await s.show(p.getByRole("table").first(), "Altında açıklanamayan farkı en yüksek malzemeler var: sayımda ilk bakılacak yer.");
    await s.click(p.locator('a[href="/inventory?level=CRITICAL"]').first(), "Stok durumu kutuları tıklanabilir: “Kritik” kritik seviyedeki ürünleri açar.");
    await s.show(p.getByRole("table").first(), "Stok sayfası doğrudan kritik ürünlerle açıldı.");
    await s.go("/");
    await s.show(card(s, /En Çok Fire Veren/i), "Altta en çok fire veren ürünler, fiyat değişimleri ve uyarılar; başlıklar ayrıntıya götürür.");
    await exports(s, "Rakamlar aynı dönemle PDF, Excel veya CSV olarak indirilebilir.");
    await s.say("Tüm rakamlar ortak maliyet motorundan gelir ve Teorik - Gerçekleşen raporuyla tutar.");
  },
};

const variance: Scene = {
  slug: "variance",
  path: "/variance",
  title: "Teorik - Gerçekleşen",
  async run(studio) {
    const s = steady(studio);
    const p = s.page;
    await s.say("Bu rapor, reçeteye göre olması gereken tüketimi stoktan gerçekleşen tüketimle karşılaştırır.");
    await info(s);
    await s.select(p.locator("#group"), "Yiyecek", "Tarihler ayın 1'inden bugüne gelir; departman veya kategori seçebilirsiniz, örneğin yiyecek.");
    await filterButton(s);
    await s.show(stat(s, "Açıklanamayan"), "Kartlar gerçekleşen ve teorik maliyeti, kayıtlı fireyi ve açıklanamayan farkı verir.");
    await s.show(card(s, /Stok Mutabakatı/i), "Mutabakat: dönem başı stok + alımlar − dönem sonu stok = gerçekleşen kullanım.");
    await s.show(card(s, /Sapma Dağılımı/i), "Sapma dağılımı farkı fiyat, fire, personel yemeği, ödenmez / ikram, büfe ve minibar gibi nedenlere ayırır.");
    await s.show(p.locator("li", { hasText: "Açıklanamayan" }).last(), "Kalan “Açıklanamayan” tutar incelenecek kısımdır; bir suçlama değil, bir göstergedir.");
    await s.scroll(p.getByRole("columnheader", { name: /Açıklanamayan tutar/i }).first());
    await s.show(p.getByRole("columnheader", { name: /Açıklanamayan tutar/i }).first(), "Malzeme tablosunun son sütunu farkın tutarıdır: kırmızı fazla, yeşil eksik tüketim.");
    await exports(s, "Liste aynı filtrelerle PDF, Excel veya CSV olarak indirilebilir.");
    await s.say("Kapanış stoku ancak dönem sonunda onaylı sayım varsa fizikseldir; düzenli sayım bu yüzden önemlidir.");
  },
};

const ledger: Scene = {
  slug: "inventory-ledger",
  path: "/inventory/ledger",
  title: "Stok hareketleri",
  async run(studio) {
    const s = steady(studio);
    const p = s.page;
    await s.say("Stok hareketleri, her giriş ve çıkışın değiştirilemez kaydıdır: alım, tüketim, fire, transfer ve sayım farkı.");
    await info(s);
    await s.select(p.locator("#lf-wh"), "Mutfak Deposu", "Tarihler ayın 1'inden bugüne gelir; depo, hareket tipi veya ürün seçebilirsiniz.");
    await filterButton(s);
    await s.show(p.getByRole("table").first(), "Her satırda tarih, hareket tipi, miktar, birim maliyet, toplam ve kaydın kaynağı yer alır.");
    await s.click(p.getByRole("table").first().getByRole("link", { name: "Yumurta", exact: true }).first(), "Ürün adına tıklayınca yalnızca o ürünün hareketleri listelenir: stoğun neden değiştiği adım adım izlenir.");
    await s.show(p.getByRole("button", { name: "Silme talebi" }).first(), "Hatalı bir kayıt silinmez: “Silme talebi” yöneticinin onayına gider ve ters kayıtla düzeltilir.");
    await resetX(s);
    await s.click(p.getByRole("link", { name: /detaylı/ }).first(), "“Detaylı” sekmesinde satışlar adisyon bazında ayrı satırlar olarak görünür.");
    await s.show(p.getByRole("table").first(), "Satış tüketimini kontrol ederken hangi adisyondan geldiğini burada görebilirsiniz.");
    await exports(s, "Liste aynı filtrelerle PDF, Excel veya CSV olarak indirilebilir.");
    await s.say("Diğer sayfalardaki stok rakamlarının tamamı bu hareketlerden hesaplanır.");
  },
};

const counts: Scene = {
  slug: "inventory-counts",
  path: "/inventory/counts",
  title: "Stok sayımları",
  async run(studio) {
    const s = steady(studio);
    const p = s.page;
    await s.say("Bu sayfada sayım föyü oluşturur, sayılan miktarları girer ve sayımı onaya gönderirsiniz.");
    await info(s);
    await s.select(p.locator("#nc-wh"), "Bar Deposu", "Sayılacak depoyu seçin; sayım tarihi olarak bugünkü iş günü gelir.");
    await s.click(p.getByRole("button", { name: "Sayım föyü oluştur" }), "“Sayım föyü oluştur” depodaki ürünleri sistem miktarlarıyla getirir.");
    await s.wait(800);
    const sheet = p.locator("section").filter({ has: p.getByRole("button", { name: "Onaya gönder" }) }).first();
    await s.show(sheet, "Föy taslak olarak açıldı: her satırda ürün, sistemdeki miktar ve sayılan miktar alanı var.");
    const inputs = sheet.getByRole("textbox", { name: /^Sayılan / });
    const n = Math.min(2, await inputs.count());
    for (let i = 0; i < n; i++) {
      const input = inputs.nth(i);
      const cell = input.locator("xpath=ancestor::tr[1]").locator("td").nth(1);
      const unit = (await cell.innerText()).trim().split(/\s+/).pop() ?? "";
      const system = num(await cell.innerText());
      const counted = unit === "pc" ? Math.max(0, Math.floor(system) - (i === 0 ? 1 : 0)) : system * (i === 0 ? 0.95 : 1);
      await s.type(input, trNum(counted, unit === "pc" ? 0 : 3), i === 0 ? "Sayılan miktarı yazın; fark siz yazarken hesaplanır: eksik kırmızı, fazla yeşil." : undefined);
    }
    await s.type(sheet.getByRole("textbox", { name: /^Neden / }).first(), "Kırık / hasarlı", "Fark için kısa bir neden yazmak, onaylayan yöneticinin işini kolaylaştırır.");
    await s.click(sheet.getByRole("button", { name: "Kaydet" }), "“Kaydet” girdiklerinizi saklar; sayıma sonra devam edebilirsiniz.");
    await s.show(sheet.getByRole("button", { name: "Onaya gönder" }), "Sayım bitince “Onaya gönder”e basın: stok ancak yetkili yönetici onaylayınca değişir.");
    await exports(s, "Föyü sayımdan önce PDF veya Excel olarak indirip yazdırabilirsiniz.");
    await s.show(p.getByRole("link", { name: /Onaylanmış sayımlar/ }), "Onaylanan sayımların farkları “Sayım sonuçları” sayfasında listelenir.");
  },
};

const countResults: Scene = {
  slug: "inventory-counts-results",
  path: "/inventory/counts/results",
  title: "Sayım sonuçları",
  async run(studio) {
    const s = steady(studio);
    const p = s.page;
    // this month has no approved count yet: open last month's count of the kitchen store straight away
    const kitchen = await p.locator("#cr-wh option", { hasText: "Mutfak Deposu" }).getAttribute("value");
    await s.go(`/inventory/counts/results?${new URLSearchParams({ warehouseId: kitchen ?? "", from: "2026-09-01", to: await p.locator("#fb-to").inputValue() })}`);
    await s.say("Sayım sonuçları, onaylı sayımlarda sistem miktarı ile sayılan miktar arasındaki farkı ve tutarını gösterir.");
    await info(s);
    await s.show(p.locator("#fb-from"), "Tarihler ayın 1'inden bugüne gelir; geçen ayın sayımı için başlangıcı 1 Eylül yaptık.");
    await s.show(p.locator("#cr-wh"), "Depoyu seçip “Filtrele”ye basın; “Tüm depolar” seçeneği de vardır.");
    await s.show(stat(s, "Onaylanmış sayımlar"), "Kartlar sayım sayısını, fark çıkan ürünleri, eksik, fazla ve toplam farkı özetler.");
    await s.click(p.getByRole("link", { name: /^Eksik/ }).first(), "Kartlar tıklanabilir: “Eksik” yalnızca eksik çıkan satırları gösterir.");
    await s.show(p.getByRole("table").first(), "Her satırda sistem ve sayılan miktar, fark, fark tutarı ve sayımcının yazdığı neden var.");
    await s.show(card(s, /Dönem İçinde Stok Değeri/i), "Altta depo bazında dönem içi stok değeri: giren, tüketilen, fire ve sayım farkı.");
    await exports(s, "Liste aynı filtrelerle PDF, Excel veya CSV olarak indirilebilir.");
    await s.click(p.getByRole("table").first().getByRole("link").first(), "Ürün adına tıklayınca sayımdan önceki bir ayın stok hareketleri açılır.");
    await s.say("Böylece farkın hangi hareketten kaynaklandığını Stok hareketleri sayfasında inceleyebilirsiniz.");
  },
};

const purchasing: Scene = {
  slug: "purchasing",
  path: "/purchasing",
  title: "Satın alma ve mal kabul",
  async run(studio) {
    const s = steady(studio);
    const p = s.page;
    await s.say("Satın alma sayfası, tedarikçi faturalarından oluşan mal kabullerini gösterir.");
    await info(s);
    await s.select(p.locator("#supplierId"), "Karadeniz Süt Ürünleri", "Tarihler ayın 1'inden bugüne gelir; tedarikçi veya kaynağa göre süzebilirsiniz.");
    await filterButton(s, "“Filtrele”ye basın; her mal kabulde fatura no, depo, satırlar (miktar × birim fiyat), KDV ve toplam görünür.");
    await s.click(p.locator("summary", { hasText: "Elle mal kabul" }), "Faturalar normalde Micros'tan gelir; gelmeyen bir fatura için “Elle mal kabul”ü açıp tedarikçi, depo ve fatura numarasını girin.");
    await s.select(p.locator("#rc-sup"), "Karadeniz Süt Ürünleri");
    await s.type(p.locator("#rc-inv"), "KARA-20261014-116");
    await pick(s, p.locator("#p-line-0"), "Yoğurt", "Yoğurt", "Satırda ürünü arayıp seçin; ardından miktarı ve net birim fiyatı yazın.");
    await s.type(p.locator("#q-line-0"), "4");
    await s.type(p.locator("#pr-line-0"), "135,50");
    await s.show(p.getByRole("button", { name: "Mal kabulü işle" }), "“Mal kabulü işle” ürünleri stoğa maliyetiyle ekler ve fiyat geçmişini günceller.");
    await exports(s, "Liste aynı filtrelerle PDF, Excel veya CSV olarak indirilebilir.");
    await s.say("Mal kabuller stok değerini besler; sayfanın altındaki fiyat değişimleri de bunlardan çıkar.");
  },
};

const orders: Scene = {
  slug: "purchasing-orders",
  path: "/purchasing/orders",
  title: "Sipariş önerileri",
  async run(studio) {
    const s = steady(studio);
    const p = s.page;
    await s.say("Sipariş önerileri, tüketim geçmişine göre hangi üründen ne kadar sipariş vereceğinizi hesaplar.");
    await info(s);
    const row = p.getByRole("row").filter({ hasText: "Maydanoz" }).first();
    await s.show(row.locator("td").nth(4), "“Önerilen” miktar, satın alma birimine yuvarlanmış sipariş miktarıdır…", 3600);
    await s.show(row.locator("td").nth(5), "…hesabı yanda açıkça yazılır: tüketim + emniyet stoku + tedarik süresi − stok − açık sipariş.");
    await s.click(p.getByRole("link", { name: /Otomatik sipariş/ }), "“Otomatik sipariş” sekmesinde her ürün için bir kural tanımlanır.");
    await s.show(p.getByRole("table").first(), "Stok sipariş noktasına düşünce sipariş miktarı tedarikçiye e-postayla gider; kuralları önerilerden de doldurabilirsiniz.");
    // the template sits at the very bottom of the page: open it first, then ring its text
    await p.locator('[data-testid="order-email-template"] summary').click();
    await s.show(p.locator("#oe-b"), "En altta, tedarikçiye giden sipariş e-postasının şablonunu düzenleyebilirsiniz.");
    await s.click(p.getByRole("link", { name: "Tedarikçiler", exact: true }), "“Tedarikçiler” sekmesinde firma adı, adres, e-posta, telefon ve teslim süresi tutulur.");
    await s.show(p.getByRole("textbox", { name: "Teslim süresi (gün)" }).first(), "Teslim süresi, öneri hesabındaki tedarik süresi talebini belirler.");
    await exports(s, "Her sekmedeki liste PDF, Excel veya CSV olarak indirilebilir.");
    await s.say("Sipariş gelince mal kabulünü “Satın alma” sayfasında yaparsınız; stok ve öneriler kendiliğinden güncellenir.");
  },
};

const products: Scene = {
  slug: "products",
  path: "/products",
  title: "Ürünler",
  async run(studio) {
    const s = steady(studio);
    const p = s.page;
    await s.say("Ürün kartları; her ürünün kategorisini, birimlerini, tedarikçisini ve maliyetini tutar.");
    await info(s);
    await s.type(p.locator("#pf-q"), "peynir");
    await filterButton(s, "Ad, stok kodu, marka veya kategoriyle arayıp “Filtrele”ye basın.");
    await s.show(p.getByRole("columnheader", { name: /Birimler/ }), "Birimler sütunu satın alma → stok → reçete dönüşümünü gösterir; örneğin 1 kutu = 5 kg.");
    await s.show(p.getByRole("columnheader", { name: /Güncel maliyet/ }), "Güncel maliyet stok hareketlerinden gelir; yoksa kırmızı “eksik” etiketi çıkar.");
    await resetX(s);
    await s.type(p.locator("#pf-name"), "Labne Peyniri", "Ürünler normalde Micros'tan çekilir; olmayan bir ürünü “Yeni ürün (elle)” formuyla ekleyin.");
    await s.select(p.locator("#pf-cat"), "Yiyecek › Peynir");
    await s.select(p.locator("#pf-pu"), "box");
    await s.type(p.locator("#pf-conv"), "2", "Kategoriyi, birimleri, dönüşümü (1 kutu = 2 kg) ve varsayılan tedarikçiyi girin.");
    await s.select(p.locator("#pf-sup"), "Karadeniz Süt Ürünleri");
    await s.show(p.getByRole("button", { name: "Ürün oluştur" }), "Stok kodu boş kalırsa otomatik üretilir; son olarak “Ürün oluştur”a basılır.");
    await exports(s, "Liste aynı filtrelerle PDF, Excel veya CSV olarak indirilebilir.");
    await s.say("Ürün kartındaki birimler ve tedarikçi; reçete, sayım ve satın alma sayfalarında kullanılır.");
  },
};

const waste: Scene = {
  slug: "waste",
  path: "/waste",
  title: "Fire",
  async run(studio) {
    const s = steady(studio);
    const p = s.page;
    await s.say("Fire sayfasında atılan ürünleri kaydeder ve maliyetini izlersiniz.");
    await info(s);
    await s.select(p.locator("#departmentId"), "Mutfak", "Tarihler ayın 1'inden bugüne gelir; departman seçerek o bölümün firelerini görün.");
    await filterButton(s);
    await s.show(stat(s, "İşlenen fire maliyeti"), "Kartlar fire maliyetini ve nedene / departmana göre dağılımı verir.");
    await s.select(p.locator("#wf-d"), "Mutfak");
    await pick(s, p.locator("#wp-w-0"), "Domates", "Domates", "Yeni fire için formda departmanı seçin, ürünü adıyla arayın…");
    await s.type(p.locator("#wq-w-0"), "0,8");
    await s.select(p.locator("#wt-w-0"), "bozulmuş", "…miktarı, fire türünü ve kısa bir gerekçeyi yazın.");
    await s.type(p.locator("#wr-w-0"), "Ezilmiş, kullanılamaz");
    await s.click(p.getByRole("button", { name: "Fire kaydet" }), "“Fire kaydet”: kayıt maliyetiyle stoktan düşülür; yüksek tutarlılar önce yönetici onayına gider.");
    await exports(s, "Liste aynı filtrelerle PDF, Excel veya CSV olarak indirilebilir.");
    await s.say("Fire tutarı, Teorik - Gerçekleşen raporunda farkın bilinen nedenlerinden biri olarak ayrıca gösterilir.");
  },
};

const comps: Scene = {
  slug: "comps",
  path: "/comps",
  title: "Ödenmez ve İkram",
  async run(studio) {
    const s = steady(studio);
    const p = s.page;
    await s.say("Ödenmez ve ikram, kimsenin ödemediği tüketimdir.");
    await info(s);
    await s.show(p.locator("#kind"), "Ödenmez: yatırımcı, genel müdür gibi yetkililerin tüketimi. İkram: satış görüşmesinde çay gibi bir nedenle sunulan.");
    await s.click(p.locator("summary", { hasText: "Elle giriş" }), "Kayıtlar Micros ve Opera'dan otomatik gelir; gelmeyen bir kayıt için yedek olarak “Elle giriş” kullanılır.");
    await s.select(p.locator("#cf-reason"), "Genel müdür", "Türü, nedeni, kişiyi, departmanı ve sunulanı girin; genel müdür için açıklama gerekmez.");
    await s.type(p.locator("#cf-person"), "Genel müdür ve misafiri");
    await s.select(p.locator("#cf-dept"), "Restoran");
    await s.select(p.locator("#cr-c-0"), "Izgara Levrek (RST-003)");
    await s.type(p.locator("#cq-c-0"), "2");
    const save = p.getByRole("button", { name: "Kaydet", exact: true }).first();
    await s.scroll(save);
    await s.click(save, "“Kaydet”: reçetedeki malzemeler stoktan düşülür, ancak satış geliri yazılmaz.");
    await s.show(card(s, /Kayıtları/), "Kartlar ve liste maliyet bedeliyle gösterir; kaynak sütunu Micros, Opera ya da elle girişi belirtir.");
    await exports(s, "Liste aynı filtrelerle PDF, Excel veya CSV olarak indirilebilir.");
    await s.say("Bu maliyet, Teorik - Gerçekleşen sapma dağılımında ayrı bir satırdır.");
  },
};

export const stockScenes: Scene[] = [dashboard, variance, ledger, counts, countResults, purchasing, orders, products, waste, comps];
