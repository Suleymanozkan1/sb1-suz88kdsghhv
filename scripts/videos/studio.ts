/**
 * Training-video studio (feedback r3 §0.4): plays a scripted walk-through of one page in a real browser against a demo
 * database, draws Turkish captions, a pointer and a highlight ring on top of the page, captures the screen through the
 * Chrome DevTools screencast and encodes it to a small H.264 mp4 for `public/videos/`. Not part of the product.
 */
import type { BrowserContext, CDPSession, Locator, Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";

export const W = 1280;
export const H = 720;

export type Target = Locator | string;

export interface Studio {
  page: Page;
  /** shows a caption and waits long enough to read it */
  say(text: string, ms?: number): Promise<void>;
  /** rings an element (scrolling it into view) while the caption is read */
  show(target: Target, text?: string, ms?: number): Promise<void>;
  /** moves the pointer to an element and clicks it */
  click(target: Target, text?: string): Promise<void>;
  /** types into a field, a character at a time */
  type(target: Target, value: string, text?: string): Promise<void>;
  /** picks a <select> option by its label */
  select(target: Target, label: string, text?: string): Promise<void>;
  /** opens a path of the app */
  go(path: string, text?: string): Promise<void>;
  /** smooth page scroll by pixels (or to an element) */
  scroll(by: number | Target): Promise<void>;
  wait(ms: number): Promise<void>;
  /** removes the ring */
  clear(): Promise<void>;
}

export interface Scene {
  /** file name: public/videos/<slug>.mp4 */
  slug: string;
  /** menu path the video belongs to */
  path: string;
  /** title on the opening card */
  title: string;
  /** demo user (email); company admin by default */
  user?: string;
  run(s: Studio): Promise<void>;
}

const OVERLAY = `(() => {
  if (window.__hc) return;
  const css = \`
    html,body{scroll-behavior:auto!important}
    body{padding-bottom:120px!important}
    #hc-cap{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:78%;z-index:2147483646;background:rgba(15,23,42,.92);color:#fff;font:600 21px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;padding:12px 22px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35);text-align:center;transition:opacity .25s;pointer-events:none}
    #hc-cap.off{opacity:0}
    #hc-ring{position:fixed;z-index:2147483645;border:3px solid #f59e0b;border-radius:10px;box-shadow:0 0 0 4px rgba(245,158,11,.25),0 0 0 9999px rgba(15,23,42,.18);transition:all .35s ease;pointer-events:none}
    #hc-ring.off{opacity:0;box-shadow:none}
    #hc-ptr{position:fixed;z-index:2147483647;width:26px;height:26px;margin:-3px 0 0 -4px;transition:left .55s ease,top .55s ease;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))}
    #hc-ptr.press::after{content:"";position:absolute;left:-14px;top:-14px;width:36px;height:36px;border-radius:50%;background:rgba(245,158,11,.45);animation:hcp .45s ease-out}
    @keyframes hcp{from{transform:scale(.3);opacity:1}to{transform:scale(1.4);opacity:0}}
    #hc-card{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:linear-gradient(135deg,#0f172a,#1e3a5f);color:#fff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;transition:opacity .5s}
    #hc-card.off{opacity:0}
    #hc-card .k{font:600 18px/1 system-ui;letter-spacing:.2em;color:#fbbf24;text-transform:uppercase}
    #hc-card .t{font:700 46px/1.15 system-ui;text-align:center;max-width:80%}
    #hc-card .s{font:400 22px/1.4 system-ui;color:#cbd5e1;text-align:center;max-width:70%}\`;
  const mount = () => {
    if (document.getElementById("hc-cap")) return;
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
    const cap = document.createElement("div"); cap.id = "hc-cap"; cap.className = "off"; document.body.appendChild(cap);
    const ring = document.createElement("div"); ring.id = "hc-ring"; ring.className = "off"; document.body.appendChild(ring);
    const ptr = document.createElement("div"); ptr.id = "hc-ptr";
    ptr.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l16 10-7 1.5L9.5 21z" fill="#fff" stroke="#0f172a" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const p = window.__hcPtr || { x: 640, y: 360 }; ptr.style.left = p.x + "px"; ptr.style.top = p.y + "px";
    document.body.appendChild(ptr);
  };
  window.__hc = {
    mount,
    caption(t) { mount(); const c = document.getElementById("hc-cap"); if (!t) { c.className = "off"; return; } c.textContent = t; c.className = ""; },
    ring(r) { mount(); const e = document.getElementById("hc-ring"); if (!r) { e.className = "off"; return; } const pad = 6; Object.assign(e.style, { left: (r.x - pad) + "px", top: (r.y - pad) + "px", width: (r.width + 2 * pad) + "px", height: (r.height + 2 * pad) + "px" }); e.className = ""; },
    pointer(x, y) { mount(); window.__hcPtr = { x, y }; const e = document.getElementById("hc-ptr"); e.style.left = x + "px"; e.style.top = y + "px"; },
    press() { const e = document.getElementById("hc-ptr"); e.classList.remove("press"); void e.offsetWidth; e.classList.add("press"); },
    card(kicker, title, sub) { mount(); let c = document.getElementById("hc-card"); if (!title) { if (c) { c.className = "off"; setTimeout(() => c.remove(), 600); } return; } if (!c) { c = document.createElement("div"); c.id = "hc-card"; document.body.appendChild(c); } c.innerHTML = '<div class="k"></div><div class="t"></div><div class="s"></div>'; c.children[0].textContent = kicker; c.children[1].textContent = title; c.children[2].textContent = sub || ""; c.className = ""; },
  };
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
})();`;

const run = promisify(execFile);

const readMs = (text: string) => Math.min(9000, Math.max(2600, 1300 + text.length * 62));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Records one scene into `<outDir>/<slug>.mp4`; returns the duration in seconds. */
export async function record(ctx: BrowserContext, base: string, scene: Scene, outDir: string, workDir: string): Promise<number> {
  await ctx.addInitScript(OVERLAY);
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  let caption = "";
  let pointer = { x: W / 2, y: H / 2 };
  const reapply = async () => {
    await page.evaluate(([c, p]) => {
      const hc = (window as unknown as { __hc?: { caption(t: string): void; pointer(x: number, y: number): void } }).__hc;
      hc?.pointer((p as { x: number; y: number }).x, (p as { x: number; y: number }).y);
      hc?.caption(c as string);
    }, [caption, pointer] as const).catch(() => undefined);
  };
  page.on("load", () => void reapply());
  const hc = <A extends unknown[]>(fn: string, ...args: A) =>
    page.evaluate(([f, a]) => { const o = (window as unknown as Record<string, Record<string, (...x: unknown[]) => void>>).__hc; o?.[f as string]?.(...(a as unknown[])); }, [fn, args] as const).catch(() => undefined);
  const loc = (t: Target) => (typeof t === "string" ? page.locator(t).first() : t.first());

  async function settle() {
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    await hc("mount");
    await reapply();
  }
  async function setCaption(text: string) {
    caption = text;
    await hc("caption", text);
  }
  async function ringOf(t: Target) {
    const l = loc(t);
    await l.scrollIntoViewIfNeeded().catch(() => undefined);
    // wait until the element stops moving (late layout, scrolling) so the ring lands on it
    let b = await l.boundingBox();
    for (let i = 0; i < 10; i++) {
      await sleep(120);
      const n = await l.boundingBox();
      if (n && b && Math.abs(n.x - b.x) < 1 && Math.abs(n.y - b.y) < 1) { b = n; break; }
      b = n;
    }
    if (b) await hc("ring", b);
    return b;
  }
  async function moveTo(b: { x: number; y: number; width: number; height: number }) {
    pointer = { x: Math.round(b.x + Math.min(b.width / 2, 40)), y: Math.round(b.y + b.height / 2) };
    await hc("pointer", pointer.x, pointer.y);
    await sleep(650);
  }

  const s: Studio = {
    page,
    async say(text, ms) { await setCaption(text); await sleep(ms ?? readMs(text)); },
    async show(target, text, ms) {
      const b = await ringOf(target);
      if (b) await moveTo(b);
      if (text) await s.say(text, ms); else await sleep(ms ?? 1500);
    },
    async click(target, text) {
      if (text) await setCaption(text);
      const b = await ringOf(target);
      if (b) await moveTo(b);
      await sleep(text ? Math.max(900, readMs(text) - 1500) : 500);
      await hc("press");
      await sleep(250);
      await hc("ring", null);
      await loc(target).click();
      await settle();
      await sleep(900);
    },
    async type(target, value, text) {
      if (text) await setCaption(text);
      const b = await ringOf(target);
      if (b) await moveTo(b);
      const l = loc(target);
      await l.click();
      await l.fill("");
      await l.pressSequentially(value, { delay: 70 });
      await sleep(text ? Math.max(700, readMs(text) - 1500 - value.length * 70) : 600);
      await hc("ring", null);
    },
    async select(target, label, text) {
      if (text) await setCaption(text);
      const b = await ringOf(target);
      if (b) await moveTo(b);
      await sleep(700);
      await loc(target).selectOption({ label });
      await sleep(text ? Math.max(800, readMs(text) - 1400) : 800);
      await hc("ring", null);
    },
    async go(p, text) {
      await hc("ring", null);
      await page.goto(`${base}${p}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await settle();
      if (text) await s.say(text); else await sleep(800);
    },
    async scroll(by) {
      await hc("ring", null);
      if (typeof by === "number") await page.evaluate((y) => window.scrollBy({ top: y, behavior: "smooth" }), by);
      else await loc(by).evaluate((e) => e.scrollIntoView({ behavior: "smooth", block: "center" }));
      await sleep(1100);
    },
    wait: sleep,
    clear: () => hc("ring", null),
  };

  // capture: the screencast sends a frame on every visual change, each with its timestamp
  const framesDir = path.join(workDir, scene.slug);
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  const frames: { file: string; t: number }[] = [];
  let cdp: CDPSession | null = null;
  let writes: Promise<unknown>[] = [];

  try {
    await page.goto(`${base}${scene.path}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
    await settle();
    await hc("card", "HotelCost · Nasıl kullanılır?", scene.title, "Kısa eğitim videosu");
    await sleep(300);

    cdp = await ctx.newCDPSession(page);
    cdp.on("Page.screencastFrame", (f: { data: string; sessionId: number; metadata: { timestamp?: number } }) => {
      const file = path.join(framesDir, `${String(frames.length).padStart(5, "0")}.jpg`);
      frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 });
      writes.push(fs.promises.writeFile(file, Buffer.from(f.data, "base64")));
      void cdp!.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => undefined);
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
    await sleep(2800);
    await hc("card", "", "", "");
    await sleep(700);

    await scene.run(s);

    await setCaption("");
    await hc("ring", null);
    await hc("card", "HotelCost", "Hepsi bu kadar", "Bu videoyu sayfa başlığının yanındaki “Nasıl kullanılır?” düğmesiyle yeniden açabilirsiniz.");
    await sleep(2600);
    const end = frames.length ? frames[frames.length - 1]!.t + 2.2 : Date.now() / 1000;
    await cdp.send("Page.stopScreencast").catch(() => undefined);
    await Promise.all(writes);
    writes = [];
    if (frames.length < 2) throw new Error(`${scene.slug}: no frames captured`);

    // concat list with each frame held until the next one
    const list = frames.map((f, i) => `file '${f.file}'\nduration ${Math.max(0.04, ((frames[i + 1]?.t ?? end) - f.t)).toFixed(3)}`).join("\n");
    const listFile = path.join(framesDir, "list.txt");
    fs.writeFileSync(listFile, `${list}\nfile '${frames[frames.length - 1]!.file}'\n`);
    const out = path.join(outDir, `${scene.slug}.mp4`);
    // async: a blocking encode would freeze the other scenes recorded in parallel in this process
    await run("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile,
      "-vf", `fps=25,scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p`,
      "-c:v", "libx264", "-preset", "slow", "-crf", "27", "-tune", "stillimage", "-movflags", "+faststart", out]);
    fs.rmSync(framesDir, { recursive: true, force: true });
    return end - frames[0]!.t;
  } finally {
    await Promise.all(writes);
    await page.close().catch(() => undefined);
  }
}
