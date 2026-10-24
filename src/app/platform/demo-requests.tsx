"use client";

import { Badge, Card, Empty, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";
import { useRun } from "@/lib/use-run";
import { useT } from "@/i18n/client";
import { dateTime } from "@/lib/format";

export interface DemoRequestRow { id: string; name: string; company: string; email: string; phone: string | null; rooms: number | null; message: string | null; handledAt: string | null; createdAt: string }

/** Demo requests from the product page; "handled" is a toggle for the operator's own follow-up. */
export function DemoRequests({ rows }: { rows: DemoRequestRow[] }) {
  const t = useT();
  const { busy, run } = useRun();
  return (
    <Card title={t("Demo requests ({n} open)", { n: rows.filter((r) => !r.handledAt).length })} padded={false}>
      {rows.length === 0 ? <div className="p-4"><Empty title={t("No demo requests yet")} /></div> : (
        <Table label={t("Demo requests")}>
          <thead><tr><Th>{t("Date")}</Th><Th>{t("Hotel or company")}</Th><Th>{t("Contact")}</Th><Th align="right">{t("Rooms")}</Th><Th>{t("Message")}</Th><Th /></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {rows.map((r) => (
              <tr key={r.id} className={r.handledAt ? "text-ink-500" : ""}>
                <Td className="whitespace-nowrap">{dateTime(r.createdAt)}</Td>
                <Td className="font-medium">{r.company}</Td>
                <Td><div>{r.name}</div><a href={`mailto:${r.email}`} className="text-xs text-brand-700 hover:underline">{r.email}</a>{r.phone && <div className="text-xs">{r.phone}</div>}</Td>
                <Td align="right">{r.rooms ?? "-"}</Td>
                <Td className="max-w-xs text-xs">{r.message ?? ""}</Td>
                <Td className="whitespace-nowrap text-right">
                  {r.handledAt ? <Badge tone="green">{t("Handled")}</Badge> : null}
                  <button className="ml-2 text-xs text-brand-700 hover:underline" disabled={busy} onClick={() => void run(() => call("PATCH", `/api/platform/demo-requests/${r.id}`), t("Saved"))}>{r.handledAt ? t("Reopen") : t("Mark handled")}</button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
