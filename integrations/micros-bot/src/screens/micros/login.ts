/** Micros sign-in. Selectors: "login" block of selectors/micros.json (see ../login.ts for the keys). */
import { login } from "../login";
import { screenOptions, type ScreenContext } from "../context";
import type { MicrosSelectors } from "../../browser/selectors";

export async function microsLogin(ctx: ScreenContext<MicrosSelectors>, credentials: { username: string; password: string }): Promise<void> {
  await login(ctx.page, "Micros", ctx.selectors.login, credentials, screenOptions(ctx));
}
