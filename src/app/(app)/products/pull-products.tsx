"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { Button } from "@/components/ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";

/**
 * "Ürünleri çek": asks the Micros automation for the products added since the last pull. The bot picks the request
 * up on its next poll (a few minutes); products it sends are created once (matched by name), never twice.
 */
export function PullProductsButton({ lastPulled, waiting, automation }: { lastPulled: string | null; waiting: boolean; automation: boolean }) {
  const t = useT();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" disabled={busy || waiting || !automation} title={!automation ? t("The Micros automation is not set up (Imports → Automation)") : undefined} onClick={async () => {
        setBusy(true);
        setMsg(null);
        try {
          const r = await call<{ alreadyWaiting: boolean }>("POST", "/api/products/pull", {});
          setMsg({ ok: true, text: r.alreadyWaiting ? t("A pull is already waiting for the automation.") : t("Requested: the automation fetches the new products from Micros within a few minutes.") });
          router.refresh();
        } catch (e) {
          setMsg({ ok: false, text: e instanceof Error ? e.message : t("Failed") });
        } finally {
          setBusy(false);
        }
      }}><Download className="h-4 w-4" /> {t("Pull products")}</Button>
      <span className="text-xs text-ink-500">
        {waiting ? t("Waiting for the automation…") : lastPulled ? t("Last pulled: {when}", { when: lastPulled }) : t("Never pulled from Micros")}
      </span>
      {msg && <span className={msg.ok ? "max-w-xs text-right text-xs text-green-700" : "max-w-xs text-right text-xs text-red-700"}>{msg.text}</span>}
    </div>
  );
}
