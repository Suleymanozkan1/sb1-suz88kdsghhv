import type { Scene } from "../studio";
import { exports, filterButton, info } from "./common";

export const inventory: Scene = {
  slug: "inventory",
  path: "/inventory",
  title: "Stok",
  async run(s) {
    const p = s.page;
    await s.say("Stok sayfası, her ürünün dönem başı, giriş, çıkış ve güncel stok miktarını ve değerini gösterir.");
    await info(s);
    await s.show(p.locator("#fb-from"), "Tarih aralığı varsayılan olarak ayın 1'inden bugüne kadar gelir.");
    await s.select(p.locator("#group"), "Yiyecek", "Ürün grubunu seçin…");
    await filterButton(s);
    await s.show(p.getByRole("table").first(), "Tablo artık yalnızca yiyecek ürünlerini gösteriyor.");
    await s.click(p.getByRole("link", { name: /Kritik/ }).first(), "Üstteki kartlar tıklanabilir: “Kritik” kartı, kritik seviyedeki ürünleri listeler.");
    await s.show(p.getByRole("table").first(), "Kritik ürünler, sipariş önerisi için öncelikli takip edilmelidir.");
    await s.show(p.locator("#mv-product"), "Sayfanın ortasındaki form ile stok hareketi (çıkış, transfer, düzeltme) kaydedilir.");
    await s.show(p.locator("#mv-type"), "Önce ürünü, hareket tipini ve depoyu seçin; ardından miktarı girip “Kaydet”e basın.");
    await exports(s);
    await s.say("Her hareket stok defterine işlenir; ayrıntısını “Stok hareketleri” sayfasında görebilirsiniz.");
  },
};
