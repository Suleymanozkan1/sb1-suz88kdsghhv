/**
 * The open-buffet Turkish breakfast of the demo hotels (feedback r3 §4): what is issued every day, how much per cover
 * and what happens to the remainder at the breakfast count. Shared by the demo generator and the local seed, so both
 * show the same breakfast. Names are the generator's English keys (catalog-tr.ts translates them); quantities are in
 * the stock unit per cover, prices (catalog.ts level, early 2026) in TRY per stock unit.
 */
import type { CatalogItem } from "./catalog";

/** Breakfast products that are not in the general catalogue, by catalogue category. */
export const BREAKFAST_PRODUCTS: Record<string, CatalogItem[]> = {
  CHEESE: [["Lor Cheese", "kg", "box", 2, 140, 100], ["String Cheese", "kg", "box", 2, 360, 100]],
  MEAT: [["Beef Salami", "kg", "pack", 1, 480, 100]],
  VEG: [["Green Pepper", "kg", "case", 5, 60, 90]],
  BRKF: [["Sour Cherry Jam", "kg", "can", 5, 170, 100], ["Apricot Jam", "kg", "can", 5, 165, 100], ["Poğaça", "pc", null, null, 14, 100], ["Village Bread", "pc", null, null, 45, 100]],
};

export type BreakfastMode = "CONSUMPTION" | "WASTE";

export interface BreakfastBuffetItem {
  /** catalogue name (English key) of the product, or the dish's name */
  name: string;
  /** catalogue category of the product (where the generator / seed finds or creates it) */
  cat: string;
  /** stock unit (kg of a dish) per cover eaten */
  perCover: number;
  /** remainder at the count: back to stock (Tüketim) or thrown away (Fire) */
  mode: BreakfastMode;
  /** share of the days it is on the buffet (1: every day) */
  chance: number;
}

/** 21 items every day and up to 7 of the rotating ones: 21-28 items a day. */
export const BREAKFAST_BUFFET: BreakfastBuffetItem[] = [
  { name: "White Cheese", cat: "CHEESE", perCover: 0.04, mode: "CONSUMPTION", chance: 1 },
  { name: "Kaşar", cat: "CHEESE", perCover: 0.03, mode: "CONSUMPTION", chance: 1 },
  { name: "Tulum Cheese", cat: "CHEESE", perCover: 0.012, mode: "CONSUMPTION", chance: 1 },
  { name: "Lor Cheese", cat: "CHEESE", perCover: 0.01, mode: "CONSUMPTION", chance: 1 },
  { name: "String Cheese", cat: "CHEESE", perCover: 0.012, mode: "CONSUMPTION", chance: 1 },
  { name: "Black Olives", cat: "BRKF", perCover: 0.025, mode: "CONSUMPTION", chance: 1 },
  { name: "Green Olives", cat: "BRKF", perCover: 0.02, mode: "CONSUMPTION", chance: 1 },
  { name: "Tomato", cat: "VEG", perCover: 0.06, mode: "WASTE", chance: 1 },
  { name: "Cucumber", cat: "VEG", perCover: 0.05, mode: "WASTE", chance: 1 },
  { name: "Green Pepper", cat: "VEG", perCover: 0.02, mode: "WASTE", chance: 1 },
  { name: "Eggs", cat: "DAIRY", perCover: 1, mode: "WASTE", chance: 1 },
  { name: "Sucuk", cat: "MEAT", perCover: 0.025, mode: "WASTE", chance: 1 },
  { name: "Smoked Turkey", cat: "CHICKEN", perCover: 0.02, mode: "CONSUMPTION", chance: 1 },
  { name: "Honey", cat: "BRKF", perCover: 0.025, mode: "CONSUMPTION", chance: 1 },
  { name: "Kaymak", cat: "DAIRY", perCover: 0.015, mode: "CONSUMPTION", chance: 1 },
  { name: "Butter", cat: "DAIRY", perCover: 0.025, mode: "CONSUMPTION", chance: 1 },
  { name: "Strawberry Jam", cat: "BRKF", perCover: 0.015, mode: "CONSUMPTION", chance: 1 },
  { name: "Simit", cat: "BRKF", perCover: 0.35, mode: "WASTE", chance: 1 },
  { name: "Village Bread", cat: "BRKF", perCover: 0.25, mode: "WASTE", chance: 1 },
  { name: "Black Tea", cat: "TEA", perCover: 0.008, mode: "CONSUMPTION", chance: 1 },
  { name: "Buffet Menemen", cat: "DISH", perCover: 0.08, mode: "WASTE", chance: 1 },
  { name: "Beef Salami", cat: "MEAT", perCover: 0.012, mode: "CONSUMPTION", chance: 0.5 },
  { name: "Sour Cherry Jam", cat: "BRKF", perCover: 0.012, mode: "CONSUMPTION", chance: 0.4 },
  { name: "Apricot Jam", cat: "BRKF", perCover: 0.012, mode: "CONSUMPTION", chance: 0.4 },
  { name: "Tahini", cat: "BRKF", perCover: 0.01, mode: "CONSUMPTION", chance: 0.5 },
  { name: "Molasses", cat: "BRKF", perCover: 0.01, mode: "CONSUMPTION", chance: 0.5 },
  { name: "Poğaça", cat: "BRKF", perCover: 0.3, mode: "WASTE", chance: 0.6 },
  { name: "Yoghurt", cat: "DAIRY", perCover: 0.05, mode: "CONSUMPTION", chance: 0.4 },
  { name: "Watermelon", cat: "FRUIT", perCover: 0.12, mode: "WASTE", chance: 0.5 },
  { name: "Orange Juice", cat: "BEV", perCover: 0.15, mode: "WASTE", chance: 0.6 },
  { name: "Whole Milk", cat: "DAIRY", perCover: 0.08, mode: "CONSUMPTION", chance: 0.5 },
  { name: "Croissant Frozen", cat: "BRKF", perCover: 0.25, mode: "WASTE", chance: 0.2 },
  { name: "Corn Flakes", cat: "BRKF", perCover: 0.015, mode: "CONSUMPTION", chance: 0.2 },
];

export const BREAKFAST_MAX_ITEMS = 28;

/** The hot dish of the buffet, per 1 kg (recipe units): about 74 TRY/kg at catalogue prices. */
export const BREAKFAST_DISH = { name: "Buffet Menemen", code: "BF-MENEMEN", lines: [["Eggs", 9, "pc"], ["Tomato", 450, "g"], ["Green Pepper", 150, "g"], ["Butter", 30, "g"]] as Array<[string, number, "pc" | "g"]> };

/** One day's buffet: the daily items and the rotating ones the day's draws pick (at most BREAKFAST_MAX_ITEMS). */
export function breakfastOfDay(rnd: () => number): BreakfastBuffetItem[] {
  const out: BreakfastBuffetItem[] = [];
  for (const it of BREAKFAST_BUFFET) {
    const draw = it.chance < 1 ? rnd() : 0;
    if (draw < it.chance && out.length < BREAKFAST_MAX_ITEMS) out.push(it);
  }
  return out;
}

/** A deterministic random stream for the breakfast draws (mulberry32, like the generator's). */
export function breakfastRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
