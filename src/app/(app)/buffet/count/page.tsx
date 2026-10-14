import Link from "next/link";
import { Printer } from "lucide-react";
import { pageContext, guarded } from "@/server/page";
import { breakfastCount } from "@/server/services/buffet";
import { can } from "@/server/auth/actor";
import { prisma } from "@/server/db";
import { Alert, Button, Card, Empty, Input, Label, PageHeader } from "@/components/ui";
import { FilterBar } from "@/components/filter-bar";
import { date as fmtDate, dateTime } from "@/lib/format";
import { getT } from "@/i18n/server";
import { currentBusinessDay } from "@/domain/business-day";
import { CountForm, OpenDay } from "./count-form";

export const metadata = { title: "Breakfast count" };

const isDay = (v?: string) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

export default async function BreakfastCountPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const t = await getT();
  const sp = await searchParams;
  const { actor, hotelId, hotel } = await pageContext();
  const today = currentBusinessDay(hotel.timezone, hotel.businessDayCutoff);
  const day = isDay(sp.date) ? sp.date! : today;
  const res = await guarded(() => breakfastCount(prisma, actor, hotelId, day));
  if (!res.ok) return <Alert>{res.error}</Alert>;
  const c = res.data;
  const manage = can(actor, "buffet:manage");
  return (
    <>
      <PageHeader
        title={t("Breakfast count")}
        subtitle={t("After breakfast enter what is left of each issued item (weight or pieces) and choose whether the remainder is consumption (it goes back to stock) or waste (it is thrown away). Consumption = issued − remaining. Keyboard: Enter or ↓ moves to the next row, T / F choose Consumption / Waste, Space switches the choice. The blank count sheet (PDF) is for writing the count on paper first.")}
        exportKey="buffet-count"
        exportParams={{ date: day }}
        actions={<>
          <a href={`/api/buffet/count-template?date=${day}`} target="_blank" rel="noopener"><Button variant="secondary"><Printer className="h-4 w-4" /> {t("Blank count sheet (PDF)")}</Button></a>
          <FilterBar dates={false}>
            <div><Label htmlFor="bc-date">{t("Date")}</Label><Input id="bc-date" name="date" type="date" defaultValue={day} max={today} className="w-40" /></div>
          </FilterBar>
        </>}
      />
      <Card
        title={t("Breakfast · {date}", { date: fmtDate(`${day}T00:00:00Z`) })}
        actions={c.session ? <Link href={`/buffet/${c.session.id}`} className="text-sm text-brand-800 hover:underline">{t("Open the breakfast day")}</Link> : undefined}
        padded={c.fromRecent}
      >
        {c.fromRecent ? (
          <Empty title={t("Nothing has been issued to breakfast on this date yet")}>
            <p>{t("Record the issues on the breakfast day first; the count lists what was issued. The blank count sheet lists the items of recent breakfasts.")}</p>
            {manage && <div className="mt-3"><OpenDay date={day} /></div>}
          </Empty>
        ) : (
          <>
            {c.session?.counted && <div className="px-4 pt-4"><Alert tone="green">{t("Count saved on {when}. To correct it, change the values and save again.", { when: dateTime(c.session.countedAt, hotel.timezone) })}</Alert></div>}
            <CountForm sessionId={c.session!.id} items={c.items} counted={!!c.session?.counted} editable={manage} />
          </>
        )}
      </Card>
    </>
  );
}
