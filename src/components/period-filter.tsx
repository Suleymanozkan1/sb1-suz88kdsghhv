import { Label, Select } from "./ui";
import { FilterBar } from "./filter-bar";
import { getT } from "@/i18n/server";

/** Date range (+ optional department) filter: the shared FilterBar, applied only with its "Filter" button. */
export async function PeriodFilter({ from, to, extra, departments, departmentId, hidden }: { from: string; to: string; extra?: React.ReactNode; departments?: { id: string; name: string }[]; departmentId?: string; /** values kept as they are (e.g. a product picked from another page) */ hidden?: Record<string, string | undefined> }) {
  const t = await getT();
  return (
    <FilterBar from={from} to={to} hidden={hidden}>
      {departments && (
        <div>
          <Label htmlFor="departmentId">{t("Department")}</Label>
          <Select id="departmentId" name="departmentId" defaultValue={departmentId ?? ""} className="w-44">
            <option value="">{t("All accessible")}</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </div>
      )}
      {extra}
    </FilterBar>
  );
}
