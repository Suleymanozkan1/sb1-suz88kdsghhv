# Micros / Opera automation

Hotels have no Micros or Opera API. A browser bot (`integrations/micros-bot`, Playwright) signs in to the
Micros and Opera web screens every night after the night audit, reads the last closed business day and posts it to
HotelCost. Its own README (Turkish) covers installing it on the hotel's machine, the `.env` settings and the screen
selectors.

## Flow

1. **Key.** An administrator creates a key under *Imports → Automation keys* (`admin:hotels`). It is shown once
   and stored hashed. It goes into the bot's `.env` as `HOTELCOST_API_KEY`. Revoking it stops the bot at once.
2. **Nightly run.** The bot runs 45 minutes after the night-audit cut-off (04:15 for the default 03:30) for the
   business day that ended at the cut-off. The cut-off is a hotel setting, *Admin → Business day ends at*; the bot
   picks it up on every poll and its run time moves with it. Setting `RUN_AT` in the bot's `.env` pins the run time.
3. **Delivery.** Each kind is sent to `POST /api/integrations/ingest`:

   | kind | becomes | idempotency |
   |---|---|---|
   | `checks` | sales lines → recipe ingredients deducted from stock | check no. + business day + item |
   | `invoices` | goods receipt (source MICROS) | supplier + invoice no. |
   | `covers` | covers sold per outlet / meal → buffet form | overwritten per day |
   | `minibar` | minibar consumption | folio reference |
   | `occupancy` | night-audit statistics; the sold room numbers mark the rooms on the minibar board | overwritten per day |

4. **Run log.** The bot reports `STARTED` / `SUCCEEDED` / `FAILED` to `POST /api/integrations/runs`. *Imports →
   Automation log* shows every run with its counts (received, new, already sent, errors) and its message.
5. **Warnings.** Health is checked per source (Micros, Opera — every source that ever reported a run) and the worst
   one is shown: the dashboard and the imports page warn when a source's last run failed, when records were
   rejected, or when a source has not delivered the last closed business day. That day is expected from 90 minutes
   after the cut-off (the bot runs at +45 min); before that the day before is checked.
6. **Run now.** The buttons on the imports page create a request. The bot polls `GET /api/integrations/runs/next`
   every few minutes and runs it.

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
