import { randomBytes } from "node:crypto";

/**
 * Options for loading demo / training data into an on-premise installation. That database is the production one and
 * the app listens on the hotel LAN, so no platform administrator is created and no demo user gets the documented
 * demo password: the operator gives one (--password=…) or a random one is generated and printed once.
 */
export function installerDemoOptions(password: string | undefined, log: (s: string) => void) {
  const given = password && password !== "true" ? password : undefined;
  if (given && given.length < 10) throw new Error("--password must be at least 10 characters");
  if (given === "Demo!2026-QA") throw new Error("choose a password other than the documented demo password");
  return { password: given ?? randomBytes(12).toString("base64url"), platformAdmin: false as const, log };
}
