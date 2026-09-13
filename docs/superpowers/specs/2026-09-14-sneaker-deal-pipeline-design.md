# Sneaker Deal Pipeline — Design Spec

**Date:** 2026-09-14
**Status:** Approved for planning
**Approach:** A — MVP-hardened (see Approaches Considered)

## 1. Summary

Add a server-side pipeline that takes a scraped sneaker/shoe deal (from an Apify
actor), routes it through a human review step in Telegram, and either:

- **Create Order** — renders a branded promo banner, publishes it to a public
  Telegram channel/chat, and creates a real "Pending" preorder in DripIT
  (visible in the dashboard, ready for someone to fill in the customer's
  details and take it through the existing order pipeline), or
- **Post Only** — renders and publishes the same banner, with no DripIT order
  created (for general marketing/restock/announcement posts).

The choice between the two is an explicit toggle at review time — never
inferred from where the item came from.

This is a new subsystem (Python/FastAPI, hosted on Render's free tier),
living inside this repo alongside the existing React app, that talks to
DripIT's existing Google Sheets sync as its only shared datastore. It does
**not** modify DripIT's client-side "New Order" flow, pricing logic, or the
in-app Post Maker UI — see Non-Goals.

## 2. Goals

- A scraped deal can be reviewed and, with one tap plus typing a BDT price,
  turn into either a publicly posted graphic, a real DripIT order, or both.
- Reviewer actions happen entirely in Telegram — no new UI to learn.
- Zero recurring cost: Render free tier, Apify free tier, Telegram Bot API,
  the Google Sheet the user already has.
- Fixes the concrete reliability/security gaps identified in the original
  prototype (see Section 8) so the pipeline is safe to leave running
  unattended.

## 3. Non-Goals

- No changes to DripIT's in-app Post Maker UI, its manual layouts, or its
  client-side rendering — it keeps working exactly as it does today. Sharing
  the Pillow render engine between Post Maker and this pipeline is a
  candidate future improvement, not part of this spec.
- No changes to DripIT's order pipeline, pricing formulas, WhatsApp message
  templates, invoices, or books/ledger beyond the one new "Pending" order
  row the backend appends.
- No automated test suite, external monitoring/alerting service, retry
  queues, or multi-admin roles (that's Approach B — explicitly deferred).
- No per-deal brand selection — all scraped deals are attributed to one
  fixed brand, configured via an env var (`DEAL_BRAND`, set to either
  `drip_ittt` or `NOVUS` at deploy time — no default baked into code).
- Not solving Apify actor selection/configuration, or the specific site(s)
  to scrape — this spec starts at the point Apify POSTs a deal to our
  webhook in the agreed shape.

## 4. Architecture

```
E:\preorder-app/
├── src/…                     existing React app — UNCHANGED
├── server/                   NEW — Python backend
│   ├── main.py                FastAPI app, route handlers
│   ├── bots.py                Telegram Bot API calls + Markdown escaping
│   ├── sheets_client.py       All reads/writes to the shared Google Sheet
│   ├── image_engine.py        Pillow banner renderer (async-safe)
│   ├── models.py              Pydantic schemas
│   ├── config.py              Env var loading + startup validation
│   ├── fonts/                 Bundled open-license TTF (not system Arial)
│   ├── requirements.txt
│   └── Procfile
└── docs/superpowers/specs/…  this file
```

`server/` is a self-contained Python project deployed to Render as its own
web service (Render points its build at `server/`, or the repo root with a
`Procfile`/start command scoped to `server.main:app` — decided during
implementation). The React app's build/deploy is untouched.

**Why one repo:** the two halves share one real contract — the Google Sheet
schema — and keeping the Apps Script template (already embedded in
`App.jsx`, see Section 6) and the backend that writes against it in the same
PR keeps that contract from drifting silently.

Both Telegram bots (`@ReviewerBot`, `@PublisherBot`) are kept as separate
bots, matching the original doc — one is the internal review surface, the
other only ever posts outward. No functional reason to merge them.

## 5. Data flow

```
Apify actor
   │ POST /webhook/scraper-deal   (header: X-Apify-Secret)
   ▼
FastAPI: validate secret + payload
   → sheets_client.append('PendingDeals', {..., status: 'awaiting_review'})
   → bots.send_review_card(ReviewerBot) → photo + caption + 3 buttons:
        [ Reject ]  [ Post Only ]  [ Create Order ]

Reject
   → delete Telegram message
   → sheets_client.update('PendingDeals', deal_id, status='rejected')

Post Only  or  Create Order  (tap)
   → answerCallbackQuery
   → sheets_client.update('PendingDeals', deal_id,
        status='awaiting_price', pending_action=<postonly|createorder>)
   → sendMessage force_reply: "Enter BDT price [REF:<deal_id>]"

Reviewer replies with a number
   → regex extracts deal_id from the quoted [REF:...] text
   → re-read the PendingDeals row for deal_id; guard: status must still be
     'awaiting_price' (idempotency — a duplicate/retried reply no-ops with
     a "already processed" message instead of silently doing nothing or
     double-posting)
   → set status='processing' immediately (claims the row) before any slow work
   → background task:
       image_bytes = image_engine.render(title, image_url, bdt_price)   (async fetch)
       bots.publish(PublisherBot, image_bytes, caption)
       if pending_action == 'createorder':
           sheets_client.append('orders', {…})   (Section 6)
       sheets_client.update('PendingDeals', deal_id, status='published')
   → on any failure at any step: status reverts to 'awaiting_price' and the
     reviewer gets a plain-text error so they can retry the same reply
```

## 6. Data model — extending the shared Google Sheet

DripIT's Apps Script (the `doPost`/`doGet` web app already generated from
the in-app "Export & Sync" tab) is the only shared datastore. Two changes
to its `HEADERS` map, both additive and backward-compatible with the
existing app:

**New tab — `PendingDeals`** (replaces the prototype's in-memory dict; this
is what makes deal state survive a Render restart):

| column | notes |
|---|---|
| `id` | the deal_id Apify/we generate |
| `title`, `myr_price`, `sizes`, `image_url` | as scraped |
| `status` | `awaiting_review` → `awaiting_price` → `processing` → `published` / `rejected` |
| `pending_action` | `postonly` \| `createorder`, set when Publish-type button is tapped |
| `created_at` | ISO timestamp |

**Existing `orders` tab — one column added: `company`.**
This is a pre-existing gap worth fixing regardless of this project: DripIT's
generated Apps Script `HEADERS.orders` currently has **no `company`
column**, even though the app writes a `company` field on every order object
and filters the dashboard by it (`orders.filter(o => o.company ===
currentCompany)`). Because the Apps Script only persists columns listed in
`HEADERS`, that field is silently dropped on every Sheets round-trip today —
not something this project introduced, but it directly blocks "Create
Order" from working correctly (a backend-created order needs its `company`
to survive so it shows up under the right brand), so fixing it is in scope.
The backend writes a single-item order using the columns that already
exist:

| column | value for a backend-created deal order |
|---|---|
| `id` | new uid |
| `company` | the fixed brand from config (Section 3) |
| `orderNumber` | see below |
| `customerName`/`customerPhone`/`customerFb` | blank |
| `productName` | deal title |
| `productDescription` | sizes, e.g. "Sizes: 40, 41, 42" |
| `costPriceRM` | `deal.myr_price` |
| `conversionRate` | blank (not tracked at deal time) |
| `multiplier` | `bdt_price / myr_price`, for reference only |
| `status` | `pending` |
| `orderDate` | now |
| `advancePaid` | `false` |
| `deliveryDate` | blank |
| `notes` | `"Created via Telegram deal pipeline — needs customer name/phone/payment"` |

`orderNumber` is generated the same way the app does it: read the
`counters` tab row for this brand (`orderSeq`), increment, write it back via
`action: save`, then format as `DI-<n>`/`NV-<n>`. This keeps order numbering
consistent whether an order is created in-app or by the backend.

**Both the new `PendingDeals` tab and the `company` column require
redeploying the Apps Script** (paste the updated generated code from
DripIT's Export & Sync tab into script.google.com again) — a one-time,
few-minutes step called out explicitly in the rollout plan.

## 7. Security

- **Telegram webhook**: registered with a `secret_token` on `setWebhook`;
  every request is rejected unless `X-Telegram-Bot-Api-Secret-Token` matches.
  Additionally, the handler ignores any update whose `chat_id` (and, for
  messages, sender `user_id`) isn't in an allowlist read from env vars —
  strangers messaging the bot are inert, not processed.
- **Scraper webhook**: requires a shared-secret header (`X-Apify-Secret`),
  configured identically in Apify's webhook settings and Render's env vars.
- **Markdown safety**: every scraped/user string is passed through an
  `escape_markdown()` helper before going into a Telegram caption, so a
  stray `_`/`*`/`` ` ``/`[` in a product title can't 400 the API call and
  silently kill a deal (this was unhandled in the original prototype).

## 8. Reliability — gaps closed from the original prototype

The original doc (single-file, in-memory dict) had these issues; all are
addressed by this design:

| Gap | Fix here |
|---|---|
| In-memory `PENDING_DEALS` wiped on Render restart | `PendingDeals` Sheet tab (Section 6) |
| No idempotency — double-tap or Telegram retry could double-publish | `status` claimed (`processing`) before any side effect runs; duplicate replies see "already processed" |
| `requests.get()` blocks the async event loop | `image_engine.py` uses `httpx.AsyncClient` |
| `arial.ttf` doesn't exist on Render's Linux container → silently falls back to a tiny bitmap font | Real TTF (e.g. Inter) bundled in `server/fonts/`, loaded by relative path |
| No error handling around Telegram/Sheets calls | Every call wrapped; failures logged and, mid-flow, reported to the reviewer as plain text |
| No webhook auth | Section 7 |
| `PENDING_DEALS` never cleaned up on success | Row status moves to `published`; nothing to clean up (it's just a Sheet row now) |

**A constraint this design does not remove — the "stale full-sync" race:**
DripIT's client-side sync pushes the *entire* local `orders` array with
`action: replaceAll` whenever anything is saved in the app, replacing the
whole tab's contents. If a browser tab has been open since before the
backend appends a new order row, and the user then edits any order in that
tab, the resulting `replaceAll` will overwrite the Sheet with the client's
stale array — silently dropping the backend-created order. This is not new
risk introduced by this project; it is the same last-write-wins behavior
that already exists between two devices editing concurrently today. Mitigation
is operational, not architectural: refresh/reopen the DripIT tab before
editing orders around the time deals are expected to land. Re-architecting
DripIT's sync to be incremental is out of scope for this spec.

- **Render cold starts** (free tier sleeps after ~15 min idle, ~30–50s to
  wake): accepted as a known trade-off of zero-cost hosting. Telegram
  retries on timeout, and the idempotency guard above makes a retried
  webhook call safe rather than a duplicate action.

## 9. Error handling

- All outbound Telegram/Sheets calls wrapped in `try/except`, checked with
  `.raise_for_status()` equivalent; failures use structured `logging`
  (never bare `print`).
- Mid-flow failures (image render, Sheets write, Telegram publish) message
  the reviewer directly: `"⚠️ Failed to publish: <reason>. Reply again to retry."`
  and revert `PendingDeals.status` to `awaiting_price` so retrying is just
  replying again.
- `GET /healthz` for Render's health checks.

## 10. Testing / rollout plan

No automated test suite in this scope (Approach A). Before relying on it:

1. Deploy `server/` to Render; set all env vars (bot tokens, chat allowlist,
   webhook secrets, Sheets URL, fixed brand).
2. Redeploy the Apps Script with the updated `HEADERS` (Section 6).
3. Register the Telegram webhook with `secret_token`; point Apify's webhook
   integration at `/webhook/scraper-deal`.
4. Manually run one deal through each path against a **test** Telegram chat
   and the real Sheet: Reject, Post Only, Create Order — confirm the Sheet
   rows and the DripIT dashboard look right.
5. Send one deliberately malformed title (containing `_`, `*`, `[`) through
   Create Order to confirm the Markdown-escaping holds and the flow
   completes.
6. Kill the Render service mid-review (simulate a restart) and confirm the
   pending deal is still resumable from the `PendingDeals` tab.

## 11. Approaches considered

- **A — MVP-hardened (this spec).** Fixes every load-bearing gap (data
  loss, security, silent failures, the broken font) without adding
  enterprise tooling a single-operator tool doesn't need.
- **B — Full production-grade.** Adds automated tests, structured
  logging/monitoring (e.g. Sentry), retry/backoff queues, per-admin
  Telegram roles, rate limiting. Deferred — not worth the extra surface
  until this has multiple operators or real transaction volume.
- **C — Minimal patch of the original script.** Fix only the crash-prone
  bugs, skip Sheets integration entirely. Rejected — doesn't deliver the
  actual ask (real orders in DripIT, durable state).

## 12. Open items for the implementation plan

- Exact Apify actor output schema → mapping to `ScraperDeal` (depends on
  which actor/site is used; not fixed by this spec).
- Whether Render deploys from `server/` as build root or the repo root with
  a scoped start command — an implementation detail, not a design choice.
