/** Translated browser tab titles: `export const generateMetadata = pageTitle("Subscription");` (the root layout adds "· HotelCost"). */
import type { Metadata } from "next";
import { getT } from "./server";

export function pageTitle(title: string, description?: string): () => Promise<Metadata> {
  return async () => {
    const t = await getT();
    return description ? { title: t(title), description: t(description) } : { title: t(title) };
  };
}
