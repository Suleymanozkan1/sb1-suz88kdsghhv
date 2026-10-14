import { redirect } from "next/navigation";

/** The count summary is part of "Count results" (feedback r3 §10: one results screen); old links land there. */
export default async function CountSummaryPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  redirect(`/inventory/counts/results?${new URLSearchParams(Object.entries({ warehouseId: "all", from: sp.from, to: sp.to }).filter((e): e is [string, string] => !!e[1]))}`);
}
