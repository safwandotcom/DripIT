# Sneaker Deal Pipeline — Backend

FastAPI service that takes a scraped deal from Apify through a Telegram
review step and publishes it, optionally creating a real Pending order in
DripIT. See `docs/superpowers/specs/2026-09-14-sneaker-deal-pipeline-design.md`
for the full design.

## Environment variables (set in Render's dashboard)

| Variable | Example | Notes |
|---|---|---|
| `REVIEWER_BOT_TOKEN` | `123456:AAE...` | Token for the internal review bot |
| `PUBLISHER_BOT_TOKEN` | `789012:AAF...` | Token for the bot that posts publicly |
| `TELEGRAM_CHAT_ID` | `-1001234567890` | The review chat's id |
| `PUBLISH_CHAT_ID` | `-1009876543210` | The public channel/chat the publisher bot posts finished banners to. The publisher bot must be a member/admin of this chat/channel. Separate from `TELEGRAM_CHAT_ID`, which is the private review chat. |
| `TELEGRAM_ALLOWED_USER_IDS` | `111111111,222222222` | Comma-separated Telegram user ids allowed to act |
| `TELEGRAM_WEBHOOK_SECRET` | a random string you generate | Passed to Telegram's `setWebhook` as `secret_token` |
| `APIFY_WEBHOOK_SECRET` | a random string you generate | Checked against the `X-Apify-Secret` header |
| `SHEETS_URL` | the Apps Script Web App URL | Same URL DripIT's Export & Sync tab uses |
| `DEAL_BRAND` | `drip_ittt` or `NOVUS` | Brand every scraped deal's order is attributed to |

## First-time setup

1. **Redeploy the Apps Script.** In DripIT, open the "Export & Sync" tab →
   "Show Apps Script Code" → copy it → paste into your existing
   script.google.com project (replacing the old code) → Deploy → New
   deployment (or "Manage deployments" → edit → new version). This adds
   the `pendingDeals` tab and the `orders.company` column the backend
   needs.

2. **Deploy to Render.**
   - New Web Service → connect this repo.
   - Root directory: `server`
   - Build command: `pip install -r requirements.txt`
   - Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - Instance type: Free
   - Add every environment variable from the table above.
   - Deploy. Note the resulting URL, e.g. `https://your-app.onrender.com`.

3. **Register the Telegram webhook** (generates the secret check the
   backend verifies):

   ```bash
   curl -X POST "https://api.telegram.org/bot<REVIEWER_BOT_TOKEN>/setWebhook" \
        -H "Content-Type: application/json" \
        -d '{
              "url": "https://your-app.onrender.com/webhook/telegram-reviewer",
              "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"
            }'
   ```

4. **Point the Apify actor's webhook integration** at
   `https://your-app.onrender.com/webhook/scraper-deal`, with a custom
   header `X-Apify-Secret: <APIFY_WEBHOOK_SECRET>` on the outgoing request
   (Apify's webhook integration UI lets you add custom headers).

## Price-range filter

Any scraped deal outside `DEAL_PRICE_MIN_MYR`–`DEAL_PRICE_MAX_MYR` (0–200 by
default; edit the constants at the top of `main.py`) never reaches the
reviewer at all — `/webhook/scraper-deal` returns `{"status": "filtered", ...}`
and skips creating a pending deal or sending a review card. This is
independent of whatever price filtering the Apify actor itself does.

## Paste-a-link deals

Sending the reviewer bot a plain message that's just a product URL (not a
reply to anything) fetches that page's product data — Open Graph tags
(`og:title`, `og:image`, `product:price:amount`/`og:price:amount`) first,
falling back to schema.org Product/Offer JSON-LD for whatever's still
missing (verified against real underarmour.com.my and nike.com product
pages, including Nike's nested `hasVariant` shape) — and creates the same
review card a scraped deal would. A site whose bot protection blocks plain
HTTP fetches outright (adidas.com, confirmed) won't work no matter which
tags it exposes; anything else that exposes neither shape gets a reply
naming what's missing instead of a guess.
The extracted price's currency isn't verified and sizes aren't detected —
the review card flags both for you to check before choosing an action, and
the price-range filter above does **not** apply to pasted links (a link you
deliberately paste isn't scraper noise to filter).

## Manual smoke test (run once after every deploy)

1. Send a test payload to `/webhook/scraper-deal` (with the correct
   `X-Apify-Secret` header) and confirm the review card appears in the
   Telegram chat with all three buttons.
2. Tap **Reject** — confirm the message is deleted and the `pendingDeals`
   row's `status` becomes `rejected`.
3. Send another test deal, tap **Post Only**, reply with a price — confirm
   the banner is posted to the public chat/channel and **no** row is added
   to the `orders` tab.
4. Send a third test deal, tap **Create Order**, reply with a price —
   confirm the banner is posted **and** a new Pending order appears on the
   DripIT dashboard under the configured brand.
5. Send a deal with a title containing `_`, `*`, or `[` through Create
   Order — confirm it completes without a Telegram 400 error (Markdown
   escaping holds). Confirm the published caption shows literal
   `[PRE-ORDER MALAYSIA]` brackets (not a broken/missing bracket or a link).
6. Restart the Render service mid-review (Render dashboard → Manual
   Deploy, or just wait for a free-tier idle sleep) with a deal sitting at
   `awaiting_price` — confirm replying with a price afterwards still
   completes normally (state survived because it lives in the Sheet, not
   in memory).

## Known limitation

DripIT's own Sheets sync pushes a full `replaceAll` of every order
whenever anything is edited in the app. If a DripIT browser tab has been
open since before this backend appends a new order, editing anything else
in that tab can overwrite the Sheet with that tab's stale local data,
silently dropping the backend-created order. Refresh the DripIT tab before
editing orders around when deals are expected to land. This is the same
last-write-wins behavior that already exists between two devices editing
concurrently — not something this pipeline introduces.
