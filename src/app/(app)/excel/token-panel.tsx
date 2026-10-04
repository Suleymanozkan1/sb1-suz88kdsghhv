"use client";

import { useState } from "react";
import { Alert, Button } from "@/components/ui";
import { call } from "@/lib/client";

export function TokenPanel() {
  const [token, setToken] = useState<{ token: string; expiresAt: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-3 text-sm">
      <p className="text-ink-600">Excel asks for this token when you click the button. It is shown <strong>once</strong>, valid for 30 days, and never stored in the workbook.</p>
      {err && <Alert>{err}</Alert>}
      {token ? (
        <div className="space-y-2">
          <code className="block break-all rounded-lg bg-ink-950 p-3 font-mono text-xs text-brand-200" data-testid="api-token">{token.token}</code>
          <p className="text-xs text-ink-500">Expires {new Date(token.expiresAt).toLocaleString()}. Copy it now.</p>
        </div>
      ) : (
        <Button onClick={async () => { try { setToken(await call("POST", "/api/auth/api-token")); } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } }}>Create token</Button>
      )}
    </div>
  );
}
