# Micros / Opera automation

Hotels have no Micros or Opera API. A browser bot (`integrations/micros-bot`, Playwright) signs in to the
Micros and Opera web screens every night after the night audit, reads the last closed business day and posts it to
HotelCost. Its own README (Turkish) covers installing it on the hotel's machine, the `.env` settings and the screen
selectors.

## Flow

1. **Key.** An administrator creates a key under *Imports → Automation keys* (`admin:hotels`). It is shown once
   and stored hashed. It goes into the bot's `.env` as `HOTELCOST_API_KEY`. Revoking it stops the bot at once.
2. **Nightly run.** The bot runs at `RUN_AT` (default 04:15) for the business day that ended at the night-audit
   cut-off. The cut-off is a hotel setting, *Admin → Business day ends at* (default 03:30).
3. **Delivery.** Each kind is sent to `POST /api/integrations/ingest`:

   | kind | becomes | idempotency |
   |---|---|---|
   | `checks` | sales lines → recipe ingredients deducted from stock | check no. + business day + item |
   | `invoices` | goods receipt (source MICROS) | supplier + invoice no. |
   | `covers` | covers sold per outlet / meal → buffet form | overwritten per day |
   | `minibar` | minibar consumption | folio reference |
   | `occupancy` | night-audit statistics | overwritten per day |

4. **Run log.** The bot reports `STARTED` / `SUCCEEDED` / `FAILED` to `POST /api/integrations/runs`. *Imports →
   Automation log* shows every run with its counts (received, new, already sent, errors) and its message.
5. **Warnings.** The dashboard and the imports page warn when the last run failed, when records were rejected, or
   when the last closed business day has not arrived.
6. **Run now.** The buttons on the imports page create a request. The bot polls `GET /api/integrations/runs/next`
   every few minutes and runs it.

## Matching

- **Outlets → departments.** By code or name. When neither matches, a department whose name is part of the Micros
  outlet name is used, if exactly one fits ("Ana Restoran" → Restoran).
- **Menu items → recipes.** By POS code, otherwise by recipe name.
- **Invoice lines → products.** By stock code, otherwise by name. An unknown product is created in the category
  "Micros'tan yeni ürünler (sınıflandırılacak)" with the invoice's unit. An unknown unit (çuval, teneke…)
  rejects that invoice until the product card exists.
- **Suppliers.** Matched by name; created when new.

Contract: `src/server/integrations/contract.ts`. Server: `src/server/integrations/ingest.ts`.
Tests: `tests/integration/integrations.test.ts`, plus `npm test` in the bot.

## Plans

`src/server/plans.ts` switches features on per plan (Basic / Standard / Premium; `Organization.plan`, set in the
platform console; `PLAN_OVERRIDE` for self-hosted installations):
- The automation and reorder-point alerts are in every plan.
- Automatic e-mail orders are Premium. They need `SMTP_URL` and `MAIL_FROM` and are checked by the nightly cron
  `/api/cron/nightly`, which needs `CRON_SECRET`.
