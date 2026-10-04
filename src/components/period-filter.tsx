import { Button, Input, Label, Select } from "./ui";

/** Plain GET form: works without JavaScript, keeps the URL shareable. */
export function PeriodFilter({ from, to, extra, departments, departmentId }: { from: string; to: string; extra?: React.ReactNode; departments?: { id: string; name: string }[]; departmentId?: string }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor="from">From</Label>
        <Input id="from" name="from" type="date" defaultValue={from} className="w-40" />
      </div>
      <div>
        <Label htmlFor="to">To</Label>
        <Input id="to" name="to" type="date" defaultValue={to} className="w-40" />
      </div>
      {departments && (
        <div>
          <Label htmlFor="departmentId">Department</Label>
          <Select id="departmentId" name="departmentId" defaultValue={departmentId ?? ""} className="w-44">
            <option value="">All accessible</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </Select>
        </div>
      )}
      {extra}
      <Button type="submit" variant="secondary">Apply</Button>
    </form>
  );
}
