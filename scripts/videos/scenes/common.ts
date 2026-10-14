import type { Studio } from "../studio";

/** The ⓘ next to the title: the page description opens on hover. */
export async function info(s: Studio, text = "Sayfanın ne işe yaradığını başlığın yanındaki ⓘ simgesinde okuyabilirsiniz.") {
  const btn = s.page.getByRole("button", { name: "Bu sayfa hakkında" }).first();
  await s.show(btn, undefined, 500);
  await s.clear();
  await btn.hover();
  await s.say(text, 4200);
  await s.page.mouse.move(5, 700);
  await s.clear();
}

/** Every filter row works the same way: nothing changes until "Filtrele" is pressed. */
export async function filterButton(s: Studio, text = "Filtreleri seçtikten sonra “Filtrele” düğmesine basın; liste ancak o zaman değişir.") {
  await s.click(s.page.getByRole("button", { name: "Filtrele" }).first(), text);
}

/** PDF / Excel / CSV buttons at the top right. */
export async function exports(s: Studio, text = "Ekranda gördüğünüz liste, aynı filtrelerle PDF, Excel veya CSV olarak indirilebilir.") {
  await s.show(s.page.getByRole("link", { name: /^Excel$/ }).first(), text);
  await s.clear();
}
