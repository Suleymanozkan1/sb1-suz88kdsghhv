/** The automatic-ordering tab's search and "only at reorder point" filter; the page and its export use the same rule. */
export function filterRules<R extends { product: string; category: string; supplier: string; due: boolean }>(rules: R[], q: string | null | undefined, onlyDue: boolean): R[] {
  const f = (q ?? "").trim().toLocaleLowerCase("tr-TR");
  return rules.filter((r) => (!onlyDue || r.due) && (!f || `${r.product} ${r.category} ${r.supplier}`.toLocaleLowerCase("tr-TR").includes(f)));
}
