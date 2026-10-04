import { redirect } from "next/navigation";
import { Building2 } from "lucide-react";
import { currentActor } from "@/server/auth/session";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  if (await currentActor()) redirect("/");
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-ink-950 p-10 text-white lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Building2 className="h-6 w-6 text-brand-400" aria-hidden /> HotelCost
        </div>
        <div className="max-w-md">
          <p className="text-3xl font-semibold leading-tight">Know where every unit of cost came from — and why it changed.</p>
          <p className="mt-4 text-ink-300">Purchase → stock → recipe → yield → consumption → waste → theoretical vs actual → variance. One shared cost engine, fully traceable.</p>
        </div>
        <p className="text-xs text-ink-300">Ledger-based · Audited · Decimal-precise</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 text-lg font-semibold lg:hidden">
            <Building2 className="h-6 w-6 text-brand-600" aria-hidden /> HotelCost
          </div>
          <h1 className="text-2xl font-semibold text-ink-950">Sign in</h1>
          <p className="mt-1 text-sm text-ink-500">Use your hotel account.</p>
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
