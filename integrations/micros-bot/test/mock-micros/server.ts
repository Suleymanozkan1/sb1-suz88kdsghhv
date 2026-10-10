/**
 * A tiny fake "Micros" (POS + purchasing) and "Opera" web UI for the end-to-end tests — plain Node http, static
 * HTML, cookie sessions. Selectors for it: selectors/micros.mock.json and selectors/opera.mock.json.
 *
 *   Micros  /login  /home  /checks?date=DD.MM.YYYY[&page=N]  /checks/view?id=  /purchasing/invoices?date=
 *           /purchasing/invoice?id=  /reports/covers?date=YYYY-MM-DD  /purchasing/items?since=DD.MM.YYYY
 *   Opera   /opera/login  /opera/home  /opera/stats?date=  /opera/rooms?date=  /opera/minibar?date=
 *
 * `state` can be changed while the server runs: wrong passwords, removed elements (to simulate a changed
 * screen), number of checks, empty days. Run standalone: `npx tsx test/mock-micros/server.ts` (port 4010).
 */
import http from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { checksFor, coversFor, invoicesFor, minibarFor, productsAll, statsFor, trDate, trNum } from "./data";

export interface MockMicrosState {
  micros: { username: string; password: string };
  opera: { username: string; password: string };
  checksPerDay: number;
  pageSize: number;
  /** YYYY-MM-DD days that have no data at all */
  emptyDays: Set<string>;
  /** element ids that are left out of the pages (simulates a changed screen) */
  removed: Set<string>;
  /** paths requested (for assertions) */
  hits: string[];
}

export interface MockMicros { url: string; operaUrl: string; state: MockMicrosState; close(): Promise<void> }

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const page = (title: string, body: string) =>
  `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body><h1>${esc(title)}</h1>${body}</body></html>`;

/** "06.10.2026" or "2026-10-06" → "2026-10-06" */
function isoDay(v: string | null): string | null {
  if (!v) return null;
  let m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v.trim());
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim());
  return m ? v.trim() : null;
}

export async function startMockMicros(port = 0, overrides: Partial<MockMicrosState> = {}): Promise<MockMicros> {
  const state: MockMicrosState = {
    micros: { username: "bot", password: "s3cret-micros" },
    opera: { username: "opbot", password: "s3cret-opera" },
    checksPerDay: 12,
    pageSize: 5,
    emptyDays: new Set(),
    removed: new Set(),
    hits: [],
    ...overrides,
  };
  const sessions = new Set<string>();
  const has = (id: string) => !state.removed.has(id);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    state.hits.push(url.pathname + url.search);
    const cookies = Object.fromEntries((req.headers.cookie ?? "").split(/;\s*/).filter(Boolean).map((c) => c.split("=") as [string, string]));
    const send = (status: number, html: string, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", ...headers });
      res.end(html);
    };
    const redirect = (to: string, headers: Record<string, string> = {}) => send(302, "", { Location: to, ...headers });
    const readBody = (cb: (form: URLSearchParams) => void) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => cb(new URLSearchParams(data)));
    };

    const isOpera = url.pathname.startsWith("/opera");
    const p = isOpera ? url.pathname.slice("/opera".length) || "/" : url.pathname;
    const sid = cookies[isOpera ? "osid" : "msid"];
    const authed = !!sid && sessions.has(sid);
    const creds = isOpera ? state.opera : state.micros;
    const base = isOpera ? "/opera" : "";

    // ---- login (both systems) ----
    if (p === "/login" || p === "/") {
      if (req.method === "POST") {
        return readBody((form) => {
          if (form.get(isOpera ? "user" : "username") === creds.username && form.get(isOpera ? "pass" : "password") === creds.password) {
            const token = randomBytes(8).toString("hex");
            sessions.add(token);
            return redirect(`${base}/home`, { "Set-Cookie": `${isOpera ? "osid" : "msid"}=${token}; Path=/; HttpOnly` });
          }
          return send(200, loginPage(isOpera, true));
        });
      }
      if (authed) return redirect(`${base}/home`);
      return send(200, loginPage(isOpera, false));
    }
    if (!authed) return redirect(`${base}/login`);

    if (isOpera) {
      const day = isoDay(url.searchParams.get("date"));
      if (p === "/home") return send(200, page("OPERA PMS", `<div id="operaHome">Hoş geldiniz</div>`));
      if (p === "/stats" && day) {
        const s = statsFor(day);
        return send(200, page(`Manager Report ${trDate(day)}`, `<table id="stats">
          <tr><th>Available rooms</th>${has("availRooms") ? `<td id="availRooms">${s.available}</td>` : `<td>${s.available}</td>`}</tr>
          <tr><th>Occupied rooms</th><td id="occRooms">${s.occupied}</td></tr>
          <tr><th>In-house guests</th><td id="inHouseGuests">${s.guests}</td></tr>
          <tr><th>Room revenue</th><td id="roomRevenue">₺ ${trNum(s.revenue)}</td></tr>
          <tr><th>Out of order</th><td id="ooo">${s.ooo}</td></tr></table>`));
      }
      if (p === "/rooms" && day) {
        const rooms = state.emptyDays.has(day) ? [] : statsFor(day).rooms;
        return send(200, page("In House", rooms.length ? `<table id="roomList"><thead><tr><th>Oda</th></tr></thead><tbody>${rooms.map((r) => `<tr><td class="room">${r}</td></tr>`).join("")}</tbody></table>` : `<p id="noRooms">Kayıt yok</p>`));
      }
      if (p === "/minibar" && day) {
        const rows = state.emptyDays.has(day) ? [] : minibarFor(day);
        if (!rows.length) return send(200, page("Minibar", `<p id="noPostings">Hareket yok</p>`));
        return send(200, page("Minibar", has("minibarPostings") ? `<table id="minibarPostings"><thead><tr><th>Oda</th><th>Kod</th><th>Ürün</th><th>Adet</th><th>Folyo</th><th>Zaman</th></tr></thead><tbody>${rows
          .map((r) => `<tr><td class="room">${r.room}</td><td class="code">${r.code}</td><td class="item">${esc(r.item)}</td><td class="qty">${r.qty}</td><td class="ref">${r.ref}</td><td class="time">${r.time}</td></tr>`)
          .join("")}<tr><td class="room"></td><td class="code"></td><td class="item">Toplam</td><td class="qty">5</td><td class="ref"></td><td class="time"></td></tr></tbody></table>` : `<div>layout changed</div>`));
      }
      return send(404, page("Not found", ""));
    }

    // ---- Micros ----
    if (p === "/home") {
      return send(200, page("Micros Simphony", `<nav id="mainMenu"><a data-menu="checks" href="/checks">Kapanmış Çekler</a> <a href="/purchasing/invoices">Faturalar</a> <a href="/reports/covers">Cover</a></nav>`));
    }
    if (p === "/checks") {
      const dayParam = url.searchParams.get("date");
      const day = isoDay(dayParam);
      const form = `<form method="get" action="/checks"><label>İş günü <input id="businessDate" name="date" value="${esc(dayParam ?? "")}"></label> <button id="showChecks" type="submit">Göster</button></form>`;
      if (!day) return send(200, page("Kapanmış Çekler", form));
      const all = state.emptyDays.has(day) ? [] : checksFor(day, state.checksPerDay);
      if (!all.length) return send(200, page("Kapanmış Çekler", `${form}<p id="noChecks">Bu tarihte çek bulunamadı</p>`));
      const pageNo = Number(url.searchParams.get("page") ?? "1");
      const slice = all.slice((pageNo - 1) * state.pageSize, pageNo * state.pageSize);
      const more = pageNo * state.pageSize < all.length;
      const table = has("checkList")
        ? `<table id="checkList"><thead><tr><th>Çek No</th><th>Satış Noktası</th><th>Kapanış</th></tr></thead><tbody>${slice
            .map((c) => `<tr><td><a class="check-link" href="/checks/view?id=${encodeURIComponent(c.id)}">${c.checkNo}</a></td><td>${esc(c.outlet)}</td><td>${c.closed}</td></tr>`)
            .join("")}</tbody></table>`
        : `<div class="grid-v2">new layout</div>`;
      const nav = more ? `<a id="nextPage" href="/checks?date=${encodeURIComponent(dayParam!)}&page=${pageNo + 1}">Sonraki »</a>` : "";
      return send(200, page("Kapanmış Çekler", `${form}${table}${nav}`));
    }
    if (p === "/checks/view") {
      const id = url.searchParams.get("id") ?? "";
      const day = id.slice(0, 10);
      const check = checksFor(day, state.checksPerDay).find((c) => c.id === id);
      if (!check) return send(404, page("Yok", ""));
      const total = check.lines.reduce((s, l) => s + l.amount, 0);
      return send(200, page(`Çek ${check.checkNo}`, `<div id="checkHeader">Çek No: <span id="checkNo">${check.checkNo}</span>
        RVC: <span id="revenueCenter">${esc(check.outlet)}</span> Kapanış: <span id="closedAt">${check.closed}</span></div>
        <table id="checkLines"><thead><tr><th>No</th><th>Ürün</th><th>Adet</th><th>Net</th></tr></thead><tbody>${check.lines
          .map((l) => `<tr><td class="code">${l.code}</td><td class="name">${esc(l.name)}</td><td class="qty">${l.qty}</td><td class="amount">${trNum(l.amount)}</td></tr>`)
          .join("")}<tr><td class="code"></td><td class="name">Toplam</td><td class="qty"></td><td class="amount">${trNum(total)}</td></tr></tbody></table>`));
    }
    if (p === "/purchasing/invoices") {
      const dayParam = url.searchParams.get("date");
      const day = isoDay(dayParam);
      const form = `<form method="get" action="/purchasing/invoices"><input name="date" value="${esc(dayParam ?? "")}" placeholder="GG.AA.YYYY"></form>`;
      if (!day) return send(200, page("Satınalma Faturaları", form));
      const list = state.emptyDays.has(day) ? [] : invoicesFor(day);
      if (!list.length) return send(200, page("Satınalma Faturaları", `${form}<div id="noInvoices">Kayıt yok</div>`));
      return send(200, page("Satınalma Faturaları", `${form}${has("invoiceList") ? `<table id="invoiceList"><tbody>${list
        .map((i) => `<tr><td><a class="inv-link" href="/purchasing/invoice?id=${i.id}&day=${day}">${esc(i.invoiceNo)}</a></td><td>${esc(i.supplier)}</td></tr>`)
        .join("")}</tbody></table>` : ""}`));
    }
    if (p === "/purchasing/invoice") {
      const day = url.searchParams.get("day") ?? "";
      const inv = invoicesFor(day).find((i) => i.id === url.searchParams.get("id"));
      if (!inv) return send(404, page("Yok", ""));
      return send(200, page(`Fatura ${inv.invoiceNo}`, `<dl><dt>Tedarikçi</dt><dd id="supplier">${esc(inv.supplier)}</dd><dt>Fatura No</dt><dd id="invoiceNo">${esc(inv.invoiceNo)}</dd>
        <dt>Tarih</dt><dd id="invoiceDate">${trDate(inv.date)}</dd><dt>Depo</dt><dd id="store">${esc(inv.store)}</dd><dt>Genel Toplam</dt><dd id="invoiceTotal">${trNum(inv.lines.reduce((a, l) => a + l.qty * l.price * (1 + l.vat / 100), 0))}</dd></dl>
        <table id="invoiceLines"><thead><tr><th>Kod</th><th>Ürün</th><th>Miktar</th><th>Birim</th><th>Birim Fiyat</th><th>KDV</th></tr></thead><tbody>${inv.lines
          .map((l) => `<tr><td>${esc(l.code)}</td><td>${esc(l.name)}</td><td>${trNum(l.qty, l.qty % 1 ? 2 : 0)}</td><td>${esc(l.unit)}</td><td>${trNum(l.price)}</td><td>%${l.vat}</td></tr>`)
          .join("")}</tbody></table>`));
    }
    if (p === "/purchasing/items") {
      // product cards created on or after `since` (a day); the list is not filtered without it
      const sinceParam = url.searchParams.get("since");
      const since = isoDay(sinceParam);
      const form = `<form method="get" action="/purchasing/items"><input name="since" value="${esc(sinceParam ?? "")}" placeholder="GG.AA.YYYY"></form>`;
      if (!since) return send(200, page("Stok Kartları", form));
      const rows = productsAll().filter((x) => x.created >= since);
      if (!rows.length) return send(200, page("Stok Kartları", `${form}<p id="noItems">Yeni ürün yok</p>`));
      return send(200, page("Stok Kartları", `${form}${has("itemList") ? `<table id="itemList"><thead><tr><th>Kod</th><th>Ürün</th><th>Birim</th><th>İçerik</th><th></th><th>KDV</th><th>Grup</th><th>Oluşturma</th></tr></thead><tbody>${rows
        .map((x) => `<tr><td class="code">${esc(x.code)}</td><td class="name">${esc(x.name)}</td><td class="unit">${esc(x.unit)}</td><td class="pack">${x.pack === null ? "" : trNum(x.pack, x.pack % 1 ? 2 : 0)}</td><td class="packUnit">${esc(x.packUnit)}</td><td class="vat">%${x.vat}</td><td class="group">${esc(x.group)}</td><td class="created">${trDate(x.created)}</td></tr>`)
        .join("")}</tbody></table>` : `<div>layout changed</div>`}`));
    }
    if (p === "/reports/covers") {
      const day = isoDay(url.searchParams.get("date"));
      if (!day) return send(200, page("Cover Raporu", ""));
      const rows = state.emptyDays.has(day) ? [] : coversFor(day);
      if (!rows.length) return send(200, page("Cover Raporu", `<p id="noCovers">Veri yok</p>`));
      const total = rows.reduce((s, r) => s + r.covers, 0);
      return send(200, page("Cover Raporu", has("coversReport") ? `<table id="coversReport"><thead><tr><th>Satış Noktası</th><th>Öğün</th><th>Kişi</th></tr></thead><tbody>${rows
        .map((r) => `<tr><td class="outlet">${esc(r.outlet)}</td><td class="meal">${esc(r.meal)}</td><td class="covers">${trNum(r.covers, 0)}</td></tr>`)
        .join("")}<tr><td class="outlet">Toplam</td><td class="meal"></td><td class="covers">${trNum(total, 0)}</td></tr></tbody></table>` : ""));
    }
    return send(404, page("Not found", ""));
  });

  function loginPage(opera: boolean, failed: boolean): string {
    if (opera) {
      return page("OPERA Login", `<form method="post" action="/opera/login"><input id="user" name="user"><input id="pass" name="pass" type="password"><button id="signin" type="submit">Sign In</button></form>${failed ? `<div class="alert-error">Invalid credentials</div>` : ""}`);
    }
    return page("Simphony Sign In", `<form method="post" action="/login"><label>Kullanıcı <input id="username" name="username"></label><label>Şifre <input id="password" name="password" type="password"></label>${has("loginBtn") ? `<button id="loginBtn" type="submit">Giriş</button>` : `<button type="submit">Giriş</button>`}</form>${failed ? `<p class="login-error">Kullanıcı adı veya şifre hatalı</p>` : ""}`);
  }

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: actual } = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${actual}`;
  return {
    url,
    operaUrl: `${url}/opera`,
    state,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

if (process.argv[1] && /server\.ts$/.test(process.argv[1]) && process.argv[1].includes("mock-micros")) {
  const port = Number(process.env.PORT ?? 4010);
  void startMockMicros(port).then((m) => {
    console.log(`mock Micros on ${m.url}  (user ${m.state.micros.username} / ${m.state.micros.password})`);
    console.log(`mock Opera  on ${m.operaUrl}  (user ${m.state.opera.username} / ${m.state.opera.password})`);
  });
}
