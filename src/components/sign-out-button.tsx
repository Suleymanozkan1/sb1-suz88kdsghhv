"use client";

import { useRouter } from "next/navigation";
import { Button } from "./ui";
import { call } from "@/lib/client";
import { useT } from "@/i18n/client";

export function SignOutButton() {
  const router = useRouter();
  const t = useT();
  return (
    <Button variant="secondary" onClick={async () => { await call("POST", "/api/auth/logout"); router.replace("/login"); router.refresh(); }}>
      {t("Sign out")}
    </Button>
  );
}
