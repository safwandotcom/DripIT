# Shared cloud storage for the Preorder Console

## Problem

The app currently persists every entity (`po_orders`, `po_expenses`,
`po_ledger`, `po_loans`, `po_accounts`, `po_invoices`, `po_counters`,
`po_settings`, `po_current_company`) to the browser's `localStorage`
only. `localStorage` is scoped per browser per device — opening the
same URL on a phone gets a completely separate, empty store. There is
no shared backend, so the app cannot function as a real multi-device
webapp today.

## Goal

Anyone who opens `drip-it-lilac.vercel.app` — from any device — sees
and edits the same live data. No login (explicitly decided: anyone
with the link gets full read/write access, same trust model as
today, just now synced instead of siloed).

## Chosen architecture

**Upstash Redis, added to the Vercel project via Vercel's Marketplace
integration, accessed through a few new serverless API routes under
`/api`.** Vercel auto-detects `/api/*.js` files as serverless
functions for any framework, including this static Vite app — no
`vercel.json` needed.

Redis is a natural fit because the app already thinks in named JSON
blobs (`po_orders` → an array, `po_settings` → an object). Each
existing storage key becomes one Redis key. Six entities are
per-company; two are deliberately NOT synced, matching a distinction
the app already makes today (`KEY_TO_ENTITY` marks `po_settings` and
`po_current_company` as `__local__`, i.e. explicitly excluded even
from the existing optional Google Sheets sync):

```
data:{company}:orders      → JSON array
data:{company}:expenses    → JSON array
data:{company}:ledger      → JSON array
data:{company}:loans       → JSON array
data:{company}:accounts    → JSON array
data:{company}:invoices    → JSON array
```

Two exceptions to "per-company array, always synced":

- **`settings` (the real exchange rate) is shared business data, not
  per-company or per-device** — it's a single global key
  (`data:settings`) that IS synced, because using different exchange
  rates on different devices would make the COGS/profit numbers we
  just fixed inconsistent across devices. (Today's app already treats
  it as one global object, not per-company — this keeps that, but
  finally syncs it, which arguably it always should have.)
- **`current_company` (which tab you're currently viewing) stays
  local-only, exactly as today** — it's a UI preference, not
  business data. If your phone is looking at NOVUS, your laptop
  shouldn't be forced to jump there too. Not part of this API at all.
- **`counters` (order/invoice numbering) is retired as a synced blob
  entirely** — see the atomic `/api/next-number` endpoint below,
  which replaces it with something that actually works across
  devices.

No relational schema, no migrations-of-schema later — this mirrors
the current `storage.load(key, fallback)` / `storage.save(key, value)`
abstraction almost exactly, which minimizes how much of `App.jsx`
needs to change.

## Why not just "add a database" naively

A database alone doesn't fix concurrent multi-device use if the save
operation is still "read the whole array into local state, mutate it,
write the whole array back." Two devices open at once, each adding a
different order around the same time, can still have the second
write silently erase the first device's addition — the database
being fast doesn't change that failure mode, only a naive
same-localStorage-pattern-but-remote does. Two things fix this for
real:

1. **Merge-by-id on write**, not blind overwrite, for every
   array-shaped entity.
2. **Server-assigned order/invoice numbers**, not client-computed
   ones — today's numbering fix (a `useRef` in `App.jsx`) only
   prevents duplicates from double-clicks *within one browser tab*.
   It does nothing to stop two different devices from independently
   computing "next number = 15" at the same moment.

## API design

All routes live under `/api` (Vercel Node.js serverless functions).

### `GET /api/data?company={company}`
Returns the six per-company arrays plus the one global `settings`
object, in one round trip. Does NOT include `current_company` (stays
local-only) or `counters` (retired). One call on app load instead of
eight.

```json
{
  "orders": [...], "expenses": [...], "ledger": [...], "loans": [...],
  "accounts": [...], "invoices": [...], "settings": {...}
}
```

### `POST /api/data/save`
Body: `{ company, key, value }` where `key` is one of the six
per-company array entities, or the literal `"settings"` (global,
`company` ignored).

- For **array-shaped** entities (`orders`, `expenses`, `ledger`,
  `loans`, `accounts`, `invoices`): the route does NOT overwrite. It
  reads the current stored array, **upserts by `id`** — every item in
  `value` replaces the stored item with the same `id`, or is appended
  if new — and writes the merged result back. Deletions are handled
  by a separate explicit endpoint (below), never inferred from "this
  id is missing from the array I sent," because that can't
  distinguish "I deleted this" from "I just haven't loaded it yet."
- For **`settings`**: last-write-wins (shallow-merge the posted
  object into the stored one). Low risk — it changes rarely.

Returns the merged array/object actually stored, so the caller can
reconcile its local state with what won.

### `POST /api/data/delete`
Body: `{ company, key, id }`. Removes one item by id from an
array-shaped entity. Explicit delete endpoint, separate from save, so
"missing from the array" is never ambiguous.

### `POST /api/next-number`
Body: `{ company, type }` where `type` is `"order"` or `"invoice"`.
Atomically increments and returns the next number for that company —
`INCR` on a dedicated Redis counter key
(`counter:{company}:{type}`). This is the one operation that
*cannot* be client-computed safely across devices; it must be a
single atomic server operation. Replaces the client-side
`computeNextNumber`/`countersRef` logic for the multi-device case
(the ref-based fix stays as a defense-in-depth for same-tab double
submits, since the server call still goes through the same
`addOrder` code path).

## Client-side changes (`src/App.jsx`)

- `storage.load` / `storage.save` are rewritten to call the new API
  instead of `localStorage`. `localStorage` becomes a **read-through
  cache only**: on load, render immediately from whatever's cached
  locally (instant, no blank-screen wait), then fetch `/api/data` in
  the background and reconcile; on save, write to `localStorage`
  immediately (so the UI never waits on the network) and fire the API
  call, reconciling local state with whatever the server's merge
  actually produced.
- `addOrder` / `addInvoice` call `POST /api/next-number` to obtain the
  order/invoice number instead of `computeNextNumber` +
  `countersRef`. This makes order creation `async` where it wasn't
  before — every call site (`onSubmit={addOrder}` in `NewOrder`, the
  "Create Project"-style callers) needs to handle that.
- `deleteOrder` / `deleteExpense` / `deleteLoan` / `deleteAccount`
  call `POST /api/data/delete` instead of (or in addition to) the
  local array filter.
- `po_current_company` keeps using `localStorage` directly, unchanged
  — it never goes through the new API.
- No changes to any calculation logic (`calcOrder`, the Profit tab,
  the exchange-rate locking, the cancel/reactivate flow from the
  previous round) — this is purely a transport-layer change under the
  existing `storage` abstraction.

## Migration

The database starts empty. On first deploy, a one-time script reads
the current production browser's `localStorage` (the same export
mechanism used for the earlier local-dev → production merge) and:

1. Seeds each of the six array entities via `POST /api/data/save`,
   once per company per key.
2. Seeds the global `settings` object the same way.
3. **Initializes the atomic counters** — `counter:{company}:order` and
   `counter:{company}:invoice` in Redis — to one past the highest
   order/invoice number found in the migrated data (the same
   max-scan approach `computeNextNumber` used), so numbering
   continues where it left off instead of restarting at 1 and
   immediately colliding with existing orders.

After this, Redis is authoritative and `localStorage` is downgraded
to a cache.

## Required setup step (needs your action, not something I can do from here)

Provisioning Upstash Redis happens through the Vercel dashboard —
Storage tab → Marketplace Database Providers → Upstash → create a
Redis database → connect it to the `DripIT` project. That step
requires your Vercel account access; I don't have Vercel dashboard or
API credentials, and this isn't something to hand over. Once
connected, Vercel auto-injects `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` into the deployment — no manual `.env`
copying needed for production. I'll tell you exactly when to do this
step and what to click.

## Testing approach

Vercel serverless functions (`/api/*`) don't run under plain `vite
dev` — they need `vercel dev` (Vercel CLI, not installed) or an
actual Vercel deployment. Given you've said you don't want to keep
using local dev day-to-day, I'll test against a **Vercel Preview
deployment** (a separate URL Vercel generates for a non-`main`
branch, with its own Redis data namespace) rather than production, so
nothing touches your real business data until it's verified working
end-to-end — then merge to `main` for the real deploy.

## Explicitly out of scope for this change

- Authentication / access control (decided: link = full access, same
  as today).
- Real-time push updates (e.g., your phone auto-refreshing the instant
  your laptop saves something) — each device fetches on load and
  after its own writes; it won't live-update from someone *else's*
  concurrent edit without a manual refresh. Flagging this so it's a
  known limitation, not a surprise — can be added later (e.g. polling
  or websockets) if it turns out to matter in practice.
- Fixing the pre-existing "order with no COGS entry" data gap found
  during the last review — unrelated, separate cleanup if wanted.
