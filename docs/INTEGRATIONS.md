# Micros / Opera automation

Hotels have no Micros or Opera API. A browser bot (`integrations/micros-bot`, Playwright) signs in to the
Micros and Opera web screens every night after the night audit, reads the last closed business day from the reports
the hotel points out and posts it to HotelCost. It runs on the hotel's office computer where the Micros back office /
reporting is installed (always on); it never connects to the POS terminals. Its own README (Turkish) covers
installing it, the `.env` settings, the report definitions and the screen selectors.

## Flow

1. **Key.** An administrator creates a key under *Imports → Automation keys* (`admin:hotels`). It is shown once
   and stored hashed. It goes into the bot's `.env` as `HOTELCOST_API_KEY`. Revoking it stops the bot at once.
2. **Nightly run.** The bot runs at 05:00 local time (`RUN_AT` in its `.env`) for the business day that ended at the
   night-audit cut-off. The cut-off is a hotel setting, *Admin → Business day ends at* (default 03:30); the bot picks
   it up on every poll — it decides which day is read, not when the bot runs. The night audit is sometimes late: when
   the day's sales report is still empty the bot posts and reports nothing for that system and tries again every
   15 minutes (`RETRY_MINUTES`) until 09:00 (`RETRY_UNTIL`); the last attempt reports the empty report as a failure
   and sends the other kinds. A day that is done is not run again by the schedule. See *Bot schedule and report
   definitions* below.
3. **Delivery.** Each kind is sent to `POST /api/integrations/ingest`:

   | kind | becomes | idempotency |
   |---|---|---|
   | `checks` | sales lines → recipe ingredients deducted from stock | check no. + business day + item |
   | `invoices` | goods receipt (source MICROS) | supplier + invoice no. |
   | `covers` | covers sold per outlet / meal → buffet form | overwritten per day |
   | `comps` | Ödenmez / İkram records (checks closed as on-house or hospitality) → ingredients deducted from stock, no revenue; see *Comps* below | source + business day + outlet + check no. |
   | `minibar` | minibar consumption | folio reference |
   | `occupancy` | night-audit statistics; the sold room numbers mark the rooms on the minibar board | overwritten per day |
   | `products` | product cards (name, unit, pack size / weight, VAT, category) — only on a *Products → Pull products* request, no business day | name (Turkish case-insensitive) or stock code |

4. **Run log.** The bot reports `STARTED` / `SUCCEEDED` / `FAILED` to `POST /api/integrations/runs`. *Imports →
   Automation log* shows every run with its counts (received, new, already sent, errors) and its message.
5. **Warnings.** Health is checked per source (Micros, Opera — every source that ever reported a run) and the worst
   one is shown: the dashboard and the imports page warn when a source's last run failed, when records were
   rejected, or when a source has not delivered the last closed business day. That day is expected from 90 minutes
   after the cut-off; before that the day before is checked. (The bot runs at 05:00 and may retry until 09:00, so a
   late night audit shows as "no data yet" until the day arrives.)
6. **Run now.** The buttons on the imports page create a request. The bot polls `GET /api/integrations/runs/next`
   every few minutes and runs it. *Products → Pull products* creates a request of kind `PRODUCTS`: the bot reads the
   product cards added in Micros since the last successful pull (`since` in the request) and the pull time is stored
   when its run reports `SUCCEEDED`. Product pulls are not part of the nightly health check.

## Bot schedule and report definitions

- **Where.** The office PC with the Micros back office / reporting (always on, power-saving off), not a POS terminal.
  Windows Task Scheduler (*At startup*, `deploy/run-daemon.cmd`), systemd or pm2 keep the `daemon` running.
- **Schedule** (bot `.env`): `RUN_AT` (default `05:00`), `RETRY_MINUTES` (`15`, `0` = no retries), `RETRY_UNTIL`
  (`09:00`, the last attempt), `CATCH_UP` (`true`: a PC that was off at `RUN_AT` runs when it is back). The business
  day is fixed at the first attempt; the progress is kept in `state/meta.json`, so a restart carries on. Failures
  other than "report still empty" (login, changed screen) are not retried — they are reported at once. "Run now"
  requests run immediately and never wait for the night audit.
- **Report definitions** (`reports.json`, `REPORTS_FILE`): per system (`micros`, `opera`) and kind the report's name
  as shown in Micros / Opera reporting (`reportName`), its menu path (`menuPath`), `format` (`screen`),
  `waitForData` (an empty report = night audit not finished; on for the sales report) and a column mapping
  report header → field (`columns`; a field without a header is read with the CSS selector of the selectors file,
  the behaviour before definitions existed). The file is validated at start-up with Turkish messages. The shipped
  file has placeholders (`TODO: otel gösterecek …`) to be filled in once the hotel shows its reports;
  `check-config` lists them.
- **Comps** (`micros.comps`, `opera.comps`): read only when the definition's `reportName` is filled in (otherwise
  skipped, logged once). One row per item; rows of a check (check no. + outlet) form one `comps` item
  `{ checkNo, outlet, kind, reason?, person?, note?, lines: [{ itemCode, itemName, qty }] }`; `kindMap` maps the report's
  text to `ON_HOUSE` / `HOSPITALITY` (or `defaultKind`). A check sent as a comp in the same run is left out of `checks`.

## Matching

- **Outlets → departments.** By code or name. When neither matches, a department whose name is part of the Micros
  outlet name is used, if exactly one fits ("Ana Restoran" → Restoran).
- **Menu items → recipes.** By POS code, otherwise by recipe name.
- **Invoice lines → products.** By stock code, otherwise by name. An unknown product is created in the category
  "Micros'tan yeni ürünler (sınıflandırılacak)" with the invoice's unit. An unknown unit (çuval, teneke…)
  rejects that invoice until the product card exists.
- **Invoice total.** When the bot sends the invoice's printed grand total (`total`, incl. VAT), the lines must add up
  to it (tolerance 1.00 or 0.5 %); otherwise the invoice is rejected, so a line missed on a paged screen never
  posts a wrong receipt. The file export may carry it as a "Fatura Toplamı" / "Genel Toplam" column.
- **Suppliers.** Matched by name; created when new.

## Comps (Ödenmez ve İkram)

A check closed in Micros as on-house (owner / investor, general manager, directors) or as hospitality (tea for a
sales meeting, the chain's welcome drink), or a complimentary posting in Opera, is sent as kind `comps` — never also
as `checks`, so it gets no revenue and is not counted in the theoretical cost of sales. Source `MICROS` (default),
`OPERA` or `OTHER`; at most 5000 checks per delivery.

```ts
type CompsDelivery = {
  kind: "comps"; source?: "MICROS" | "OPERA" | "OTHER"; businessDay: "YYYY-MM-DD"; runId?: string;
  items: Array<{
    checkNo: string;                      // 1–64 chars
    outlet: string;                       // department code or name, as for checks
    kind: "ON_HOUSE" | "HOSPITALITY";     // Ödenmez | İkram
    reason?: string | null;               // matched to the hotel's reason list by name; other text goes to the note
    person?: string | null;               // who authorised it / who it was for (≤ 120)
    note?: string | null;                 // ≤ 500
    closedAt?: string;                    // ISO with offset
    lines: Array<{ itemCode?: string | null; itemName: string; qty: number | string }>; // qty ≠ 0, voids net out
  }>;
};
```

- **Idempotency.** `externalId = SOURCE:businessDay:OUTLETCODE:checkNo`; a re-sent check is counted as a duplicate.
- **Items.** Matched like sales (recipe POS code, else recipe name), then as a product (stock code, else name). An
  item that matches nothing is kept on the record without cost and is not deducted (the page shows it). Recipes are
  exploded into their ingredients at the version effective on the business day; the store is the outlet's own
  store, as for its sales.
- **Reasons.** The reason list is set per hotel on the page (*Ödenmez ve İkram → Nedenler*). A reason that asks for an
  explanation is not enforced on deliveries; the page flags the record instead.
- **Errors.** Unknown outlet, closed cost period: that check is listed in `errors`, the others are written.

Contract: `src/server/integrations/contract.ts`. Server: `src/server/integrations/ingest.ts`.
Tests: `tests/integration/integrations.test.ts`, plus `npm test` in the bot.

## Plans

`src/server/plans.ts` switches features on per plan (Basic / Standard / Premium; `Organization.plan`, set in the
platform console; `PLAN_OVERRIDE` for self-hosted installations):
- Trial: `TRIAL_ALL_FEATURES` (on unless set to `0`/`false`) gives every tenant the full package; the plans stay
  stored and apply once it is turned off.
- The automation and reorder-point alerts are in every plan.
- Automatic e-mail orders are Premium. Each supplier gets one e-mail written with the hotel's order e-mail template
  (Order recommendations → Automatic ordering; placeholders `{supplier}` `{hotel}` `{date}` `{lines}`). They need `SMTP_URL` and `MAIL_FROM`. They are checked when the bot reports
  a successful Micros run (the day's consumption is then posted; this also covers self-hosted installs without a
  cron), and by the fallback cron `/api/cron/nightly` at 04:00 UTC, which needs `CRON_SECRET`. An ordered product is
  not ordered again until a goods receipt of it is posted, its stock is back above the reorder point, or the
  supplier's lead time + 1 day has passed (7 days without a lead time).
