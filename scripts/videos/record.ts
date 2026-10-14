/**
 * Records the training videos into public/videos/ (see studio.ts).
 *   npx tsx scripts/videos/record.ts [slug …]
 * Env: BASE (default http://localhost:3300, a production `next start` on the Turkish web demo data),
 * VIDEO_PASSWORD (demo users' password), PARALLEL (default 3). Without slugs every scene is recorded.
 */
import { chromium, type Browser, type BrowserContextOptions } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { record, H, W } from "./studio";
import { SCENES } from "./scenes";

const BASE = process.env.BASE ?? "http://localhost:3300";
const PASSWORD = process.env.VIDEO_PASSWORD ?? "Demo!2026-QA";
const OUT = path.resolve("public/videos");
const WORK = path.resolve(process.env.VIDEO_WORK ?? ".video-work");

const sessions = new Map<string, Promise<BrowserContextOptions["storageState"]>>();

async function signIn(browser: Browser, email: string) {
  // sessions are kept on disk between runs: the login endpoint is rate-limited per IP
  const cache = path.join(WORK, `session-${email.replace(/[^a-z0-9]+/gi, "_")}.json`);
  if (fs.existsSync(cache) && Date.now() - fs.statSync(cache).mtimeMs < 6 * 3600_000) {
    const state = JSON.parse(fs.readFileSync(cache, "utf8"));
    const probe = await browser.newContext({ storageState: state });
    const ok = (await probe.request.get(`${BASE}/inventory`, { maxRedirects: 0 })).status() === 200;
    await probe.close();
    if (ok) return state;
  }
  const ctx = await browser.newContext({ locale: "tr-TR" });
  await ctx.addCookies([{ name: "hc_lang", value: "tr", url: BASE }]);
  const r = await ctx.request.post(`${BASE}/api/auth/login`, { data: { email, password: PASSWORD }, headers: { origin: BASE } });
  if (!r.ok()) throw new Error(`login ${email}: ${r.status()} ${await r.text()}`);
  const state = await ctx.storageState();
  await ctx.close();
  fs.writeFileSync(cache, JSON.stringify(state));
  return state;
}

async function main() {
  const wanted = process.argv.slice(2);
  const scenes = wanted.length ? SCENES.filter((s) => wanted.includes(s.slug)) : SCENES;
  const unknown = wanted.filter((w) => !SCENES.some((s) => s.slug === w));
  if (unknown.length) throw new Error(`unknown scene(s): ${unknown.join(", ")}`);
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(WORK, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--lang=tr-TR"], env: { ...process.env, LANG: "tr_TR.UTF-8", LANGUAGE: "tr" } });
  const queue = [...scenes];
  const failed: string[] = [];
  const worker = async () => {
    for (let scene = queue.shift(); scene; scene = queue.shift()) {
      const email = scene.user ?? "companyadmin@test.local";
      if (!sessions.has(email)) sessions.set(email, signIn(browser, email));
      const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, locale: "tr-TR", timezoneId: "Europe/Istanbul", storageState: await sessions.get(email)! });
      const started = Date.now();
      try {
        const secs = await record(ctx, BASE, scene, OUT, WORK);
        const kb = Math.round(fs.statSync(path.join(OUT, `${scene.slug}.mp4`)).size / 1024);
        console.log(`ok   ${scene.slug.padEnd(22)} ${secs.toFixed(0).padStart(4)} s  ${String(kb).padStart(5)} KB  (${Math.round((Date.now() - started) / 1000)} s)`);
      } catch (e) {
        failed.push(scene.slug);
        console.log(`FAIL ${scene.slug}: ${e instanceof Error ? e.message.split("\n").slice(0, 6).join(" | ") : e}`);
      } finally {
        await ctx.close();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(Number(process.env.PARALLEL ?? 3), scenes.length) }, worker));
  await browser.close();
  if (failed.length) { console.log(`failed: ${failed.join(" ")}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); });
