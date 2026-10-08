"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Badge, Button, Input, Label, Table, Td, Th } from "@/components/ui";
import { call } from "@/lib/client";
import { dateTime } from "@/lib/format";
import { useT } from "@/i18n/client";

interface Key { id: string; name: string; prefix: string; createdAt: string; lastUsedAt: string | null; revokedAt: string | null }

/** "Run now" for Micros / Opera: the automation picks the request up on its next poll. */
export function RunNow({ waiting }: { waiting: string[] }) {
  const t = useT();
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: "green" | "red" | "blue"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(source: "MICROS" | "OPERA") {
    setBusy(true);
    setMsg(null);
    try {
      const r = await call<{ alreadyWaiting: boolean }>("POST", "/api/integrations/request", { source });
      setMsg(r.alreadyWaiting ? { tone: "blue", text: t("A request is already waiting; the automation will pick it up within a few minutes.") } : { tone: "green", text: t("Requested. The automation will start within a few minutes; the result appears in the log below.") });
      router.refresh();
    } catch (e) {
      setMsg({ tone: "red", text: e instanceof Error ? e.message : t("Failed") });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => run("MICROS")}>{t("Run Micros now")}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => run("OPERA")}>{t("Run Opera now")}</Button>
        {waiting.length > 0 && <Badge tone="amber">{t("Waiting: {list}", { list: waiting.join(", ") })}</Badge>}
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
    </div>
  );
}

/** Keys of the automation: created here, shown once, revoked here. */
export function Keys({ keys, tz }: { keys: Key[]; tz: string }) {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState("Micros / Opera");
  const [shown, setShown] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function create() {
    setErr(null);
    try {
      const r = await call<{ key: string }>("POST", "/api/integrations/keys", { name });
      setShown(r.key);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("Failed"));
    }
  }
  async function revoke(k: Key) {
    if (!confirm(t("Revoke key {name}? The automation using it stops working.", { name: `${k.name} (${k.prefix}…)` }))) return;
    try {
      await call("DELETE", `/api/integrations/keys/${k.id}`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("Failed"));
    }
  }
  return (
    <div className="space-y-3">
      {err && <Alert>{err}</Alert>}
      {shown && (
        <Alert tone="amber">
          {t("Copy the key now: it is shown only once. Put it into the automation's settings as HOTELCOST_API_KEY.")}
          <code className="mt-2 block break-all rounded bg-ink-950 p-2 font-mono text-xs text-brand-200" data-testid="integration-key">{shown}</code>
        </Alert>
      )}
      {keys.length > 0 && (
        <Table>
          <thead><tr><Th>{t("Key name")}</Th><Th>{t("Key")}</Th><Th>{t("Created")}</Th><Th>{t("Last used")}</Th><Th>{t("Status")}</Th><Th /></tr></thead>
          <tbody className="divide-y divide-ink-100">
            {keys.map((k) => (
              <tr key={k.id} className={k.revokedAt ? "text-ink-400" : ""}>
                <Td>{k.name}</Td><Td className="font-mono text-xs">{k.prefix}…</Td><Td>{dateTime(k.createdAt, tz)}</Td><Td>{k.lastUsedAt ? dateTime(k.lastUsedAt, tz) : "—"}</Td>
                <Td>{k.revokedAt ? <Badge tone="red">{t("Revoked")}</Badge> : <Badge tone="green">{t("Active")}</Badge>}</Td>
                <Td>{!k.revokedAt && <Button size="sm" variant="ghost" onClick={() => revoke(k)}>{t("Revoke")}</Button>}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-64"><Label htmlFor="ik-n">{t("Key name")}</Label><Input id="ik-n" value={name} onChange={(e) => setName(e.target.value)} /></div>
        <Button variant="secondary" onClick={create}>{t("Create key")}</Button>
      </div>
    </div>
  );
}
