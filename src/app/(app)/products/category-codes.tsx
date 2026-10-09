"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";

interface Cat { id: string; code: string; name: string; group: string; parent: string | null; accountCode: string | null }

/** Chart-of-accounts codes of the product categories (hesap planı, e.g. 150.01) — optional, for matching with accounting. */
export function CategoryAccountCodes({ categories, canEdit }: { categories: Cat[]; canEdit: boolean }) {
  const t = useT();
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(categories.map((c) => [c.id, c.accountCode ?? ""])));
  const [state, setState] = useState<Record<string, { busy?: boolean; err?: string; ok?: boolean }>>({});
  async function save(c: Cat) {
    setState((s) => ({ ...s, [c.id]: { busy: true } }));
    try {
      await call("PATCH", `/api/products/categories/${c.id}`, { accountCode: values[c.id] ?? "" });
      setState((s) => ({ ...s, [c.id]: { ok: true } }));
      router.refresh();
    } catch (e) {
      setState((s) => ({ ...s, [c.id]: { err: e instanceof Error ? e.message : t("Failed") } }));
    }
  }
  return (
    <Table label={t("Categories and account codes")}>
      <thead><tr><Th>{t("Group")}</Th><Th>{t("Category")}</Th><Th>{t("Code")}</Th><Th>{t("Account code")}</Th></tr></thead>
      <tbody className="divide-y divide-ink-100">
        {categories.map((c) => {
          const st = state[c.id] ?? {};
          const changed = (values[c.id] ?? "") !== (c.accountCode ?? "");
          return (
            <tr key={c.id}>
              <Td>{t(c.group)}</Td>
              <Td>{c.parent ? `↳ ${c.name}` : <strong>{c.name}</strong>}</Td>
              <Td className="font-mono text-xs">{c.code}</Td>
              <Td>
                {canEdit ? (
                  <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); void save(c); }}>
                    <Input aria-label={t("Account code of {name}", { name: c.name })} value={values[c.id] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [c.id]: e.target.value }))} placeholder={t("e.g. 150.01")} className="w-32" maxLength={32} />
                    {changed && <Button size="sm" type="submit" disabled={st.busy}>{t("Save")}</Button>}
                    {st.ok && !changed && <span className="text-xs text-green-700">{t("Saved")}</span>}
                    {st.err && <span className="text-xs text-red-700">{st.err}</span>}
                  </form>
                ) : (c.accountCode ?? "—")}
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}
