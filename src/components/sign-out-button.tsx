"use client";

import { useRouter } from "next/navigation";
import { Button } from "./ui";
import { call } from "@/lib/client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button variant="secondary" onClick={async () => { await call("POST", "/api/auth/logout"); router.replace("/login"); router.refresh(); }}>
      Sign out
    </Button>
  );
}
