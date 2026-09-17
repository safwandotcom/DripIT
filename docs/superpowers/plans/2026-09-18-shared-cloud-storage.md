# Shared Cloud Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's per-device `localStorage`-only persistence with a shared Upstash Redis backend behind a few Vercel serverless API routes, so any device opening the app link sees and edits the same live business data.

**Architecture:** Six existing storage keys (`po_orders`, `po_expenses`, `po_ledger`, `po_loans`, `po_accounts`, `po_invoices` — each already one JSON array covering *all* companies, exactly as today) plus one global `settings` object move to Redis, fetched/pushed through new `/api/data*` routes. Order/invoice numbering moves from a client-computed value to an atomic server counter (`/api/next-number`), because two different devices can't safely agree on "next number" the way two clicks on one device can be made to. `localStorage` stays as a read-through cache for instant load and offline resilience, but Redis is authoritative.

**Tech Stack:** `@upstash/redis` (REST-based Redis client, works in Vercel's default Node.js serverless runtime), Vercel `/api/*.js` file-based serverless functions (zero config needed), Vitest for unit-testing the pure logic (new devDependency — no test framework exists in this repo yet).

**Spec:** `docs/superpowers/specs/2026-09-18-shared-cloud-storage-design.md`

## Correction to the spec, found while reading the real code

The spec describes Redis keys as per-company (`data:{company}:orders`).
Looking at the actual current storage layer (`src/App.jsx`), the six
entities are each **already one array covering all companies together**
(`po_orders` holds both `drip_ittt` and `NOVUS` orders; each order carries
its own `company` field, and the UI filters client-side via `cOrders =
orders.filter(o => o.company === currentCompany)`). Splitting storage by
company at the Redis layer would require a client-side refactor the spec
never asked for and gains nothing. This plan keeps the existing
all-companies-together granularity — Redis key `data:orders` (no company
in the key), matching `po_orders` exactly. `/api/next-number` is the one
place `company` still matters, because order/invoice number *sequences*
are genuinely per-company (`DI-0009` vs `NV-0003`).

## Global Constraints

- No authentication/access control — confirmed out of scope; anyone with
  the link gets full read/write access, same as today.
- Every array-type save is a **merge-by-id upsert on the server**, never
  a blind overwrite — this is the one property that actually prevents
  two devices from erasing each other's concurrent additions.
- Deletions go through an explicit delete endpoint — never inferred from
  "this id is missing from the array I posted."
- `po_current_company` stays `localStorage`-only, exactly as today — it's
  a per-device UI preference, not synced business data.
- `po_settings` (the real exchange rate) becomes global and IS synced —
  it's shared business data, not a per-device preference.
- `po_counters` is retired entirely, replaced by the atomic
  `/api/next-number` endpoint.
- Build and verify everything against a Vercel **Preview** deployment
  (a feature branch, not `main`) before touching production data. The
  final task is the only one that touches the real production Redis
  data and merges to `main`.
- No changes to any calculation logic (`calcOrder`, the Profit tab, the
  exchange-rate locking, cancel/reactivate) — this is a transport-layer
  change under the existing `storage` abstraction only.

---

## File Structure

**Create:**
- `api/_lib/redis.js` — Upstash Redis client singleton + key-naming helpers (also namespaces preview vs. production so a shared Upstash database never mixes test data with real data)
- `api/_lib/merge.js` — pure functions: `upsertById`, `removeById` (no Redis, no HTTP — fully unit-testable)
- `api/_lib/merge.test.js` — Vitest tests for the above
- `api/data.js` — `GET /api/data` (fetch everything)
- `api/data.test.js` — Vitest tests (mocked Redis client)
- `api/data/save.js` — `POST /api/data/save` (merge-by-id upsert, or last-write-wins for `settings`)
- `api/data/save.test.js`
- `api/data/delete.js` — `POST /api/data/delete` (remove by id)
- `api/data/delete.test.js`
- `api/next-number.js` — `POST /api/next-number` (atomic counter)
- `api/next-number.test.js`
- `scripts/migrate.mjs` — one-time seed script (run manually with real credentials in `.env.local`, never committed)

**Modify:**
- `src/App.jsx` — `storage.load`/`storage.save` (~line 273-364), the load effect (~line 402-432), the persist effects (~line 434-443), `computeNextNumber`/`countersRef` (~line 380-386, 481-491), `addOrder` (~line 499-596), `addInvoice` (~line 911-920), `deleteOrder`/`deleteExpense`/`deleteLoan`/`deleteAccount`
- `package.json` — add `@upstash/redis` dependency, `vitest` devDependency, `"test": "vitest run"` script

---

### Task 1: Pure merge logic + Vitest setup

No live Redis needed for this task — pure functions only.

**Files:**
- Create: `api/_lib/merge.js`
- Create: `api/_lib/merge.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `upsertById(existing: Array<{id}>, incoming: Array<{id}>) => Array` — new items (by id) are prepended in the order they appear in `incoming`, matching the app's existing "newest first" convention (`setOrders(prev => [newOrder, ...prev])`); items whose id already exists in `existing` are replaced in place, keeping their original position.
- Produces: `removeById(existing: Array<{id}>, id: string) => Array` — filters out the matching item.

- [ ] **Step 1: Install Vitest**

```bash
cd /e/preorder-app
npm install --save-dev vitest
```

- [ ] **Step 2: Add the test script to `package.json`**

Modify the `"scripts"` block:

```json
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
```

- [ ] **Step 3: Write the failing tests**

Create `api/_lib/merge.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { upsertById, removeById } from './merge.js';

describe('upsertById', () => {
  it('prepends a genuinely new item ahead of existing ones', () => {
    const existing = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }];
    const incoming = [{ id: 'c', v: 3 }];
    expect(upsertById(existing, incoming)).toEqual([
      { id: 'c', v: 3 }, { id: 'a', v: 1 }, { id: 'b', v: 2 }
    ]);
  });

  it('replaces a matching item in place without moving it', () => {
    const existing = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }];
    const incoming = [{ id: 'a', v: 99 }];
    expect(upsertById(existing, incoming)).toEqual([
      { id: 'a', v: 99 }, { id: 'b', v: 2 }
    ]);
  });

  it('handles a mix of one new and one updated item in a single call', () => {
    const existing = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }];
    const incoming = [{ id: 'b', v: 22 }, { id: 'c', v: 3 }];
    expect(upsertById(existing, incoming)).toEqual([
      { id: 'c', v: 3 }, { id: 'a', v: 1 }, { id: 'b', v: 22 }
    ]);
  });

  it('returns the existing array unchanged when incoming is empty', () => {
    const existing = [{ id: 'a', v: 1 }];
    expect(upsertById(existing, [])).toEqual([{ id: 'a', v: 1 }]);
  });

  it('starts from an empty existing array', () => {
    const incoming = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }];
    expect(upsertById([], incoming)).toEqual([{ id: 'a', v: 1 }, { id: 'b', v: 2 }]);
  });
});

describe('removeById', () => {
  it('removes the matching item', () => {
    const existing = [{ id: 'a' }, { id: 'b' }];
    expect(removeById(existing, 'a')).toEqual([{ id: 'b' }]);
  });

  it('is a no-op when the id is not present', () => {
    const existing = [{ id: 'a' }];
    expect(removeById(existing, 'z')).toEqual([{ id: 'a' }]);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `api/_lib/merge.js` does not exist yet.

- [ ] **Step 5: Write the implementation**

Create `api/_lib/merge.js`:

```js
// Upserts `incoming` items into `existing` by `id`. An item whose id
// already exists is replaced IN PLACE (same position); a genuinely new
// id is prepended, matching the app's existing "newest first" ordering
// convention (e.g. addOrder does `setOrders(prev => [newOrder, ...prev])`).
export function upsertById(existing, incoming) {
  const existingIds = new Set(existing.map(item => item.id));
  const updated = existing.map(item => {
    const match = incoming.find(inc => inc.id === item.id);
    return match ? match : item;
  });
  const newItems = incoming.filter(inc => !existingIds.has(inc.id));
  return [...newItems, ...updated];
}

export function removeById(existing, id) {
  return existing.filter(item => item.id !== id);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — all 7 tests green.

- [ ] **Step 7: Commit**

```bash
git checkout -b feature/shared-cloud-storage
git add api/_lib/merge.js api/_lib/merge.test.js package.json package-lock.json
git commit -m "feat: add merge-by-id logic for shared storage, with tests

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Redis client + key-naming helper, and the human Upstash setup step

⚠️ **This task requires action from the app owner that cannot be done
from an agent session — provisioning happens in the Vercel dashboard
under their account.** If you are a subagent executing this task, stop
at Step 1 and report back to the coordinating session rather than
guessing or skipping it.

**Files:**
- Create: `api/_lib/redis.js`
- Create: `api/_lib/redis.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `getRedis()` — returns a singleton `@upstash/redis` client. `dataKey(entity: string)` — e.g. `dataKey('orders')` → `"prod:data:orders"` or `"preview:data:orders"` depending on `process.env.VERCEL_ENV`. `settingsKey()` → `"prod:data:settings"`. `counterKey(company: string, type: 'order'|'invoice')` → `"prod:counter:drip_ittt:order"`.

- [ ] **Step 1 (human action): Provision Upstash Redis on Vercel**

Tell the app owner:

> In the Vercel dashboard, open the `DripIT` project → **Storage** tab
> → **Create Database** → choose **Upstash** → **Redis** (the free tier
> is enough at this scale) → follow the prompts to create it, then
> **Connect** it to the `DripIT` project when asked which project(s)
> should get access. Vercel automatically adds `UPSTASH_REDIS_REST_URL`
> and `UPSTASH_REDIS_REST_TOKEN` as environment variables to the
> project — you don't need to copy/paste anything yourself.
>
> One database is enough — the code below keeps preview and production
> data separate inside the same database automatically, so you don't
> need to create two.

Wait for confirmation this is done before continuing to Step 2.

- [ ] **Step 2: Install the Redis client**

```bash
npm install @upstash/redis
```

- [ ] **Step 3: Write the failing tests**

Create `api/_lib/redis.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { dataKey, settingsKey, counterKey } from './redis.js';

describe('key namespacing', () => {
  const original = process.env.VERCEL_ENV;
  afterEach(() => { process.env.VERCEL_ENV = original; });

  it('prefixes with "prod" only when VERCEL_ENV is exactly "production"', () => {
    process.env.VERCEL_ENV = 'production';
    expect(dataKey('orders')).toBe('prod:data:orders');
    expect(settingsKey()).toBe('prod:data:settings');
    expect(counterKey('drip_ittt', 'order')).toBe('prod:counter:drip_ittt:order');
  });

  it('prefixes with "preview" for any other VERCEL_ENV value', () => {
    process.env.VERCEL_ENV = 'preview';
    expect(dataKey('orders')).toBe('preview:data:orders');
  });

  it('prefixes with "preview" when VERCEL_ENV is unset (local dev)', () => {
    delete process.env.VERCEL_ENV;
    expect(dataKey('orders')).toBe('preview:data:orders');
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — `api/_lib/redis.js` does not exist yet.

- [ ] **Step 5: Write the implementation**

Create `api/_lib/redis.js`:

```js
import { Redis } from '@upstash/redis';

let client;

// A fresh Upstash client per cold start, reused across warm invocations
// of the same serverless instance.
export function getRedis() {
  if (!client) {
    client = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
  }
  return client;
}

// Preview deployments and production share ONE Upstash database (so the
// app owner only provisions one), but every key is namespaced by
// environment so a preview build used for testing can never read or
// clobber real production data.
function envPrefix() {
  return process.env.VERCEL_ENV === 'production' ? 'prod' : 'preview';
}

export function dataKey(entity) {
  return `${envPrefix()}:data:${entity}`;
}

export function settingsKey() {
  return `${envPrefix()}:data:settings`;
}

export function counterKey(company, type) {
  return `${envPrefix()}:counter:${company}:${type}`;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add api/_lib/redis.js api/_lib/redis.test.js package.json package-lock.json
git commit -m "feat: add Upstash Redis client and environment-namespaced keys

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `GET /api/data`

**Files:**
- Create: `api/data.js`
- Create: `api/data.test.js`

**Interfaces:**
- Consumes: `getRedis()`, `dataKey(entity)`, `settingsKey()` from `api/_lib/redis.js`.
- Produces: exported `getAllData(redis)` (pure-ish, takes an injected client so it's testable without live Redis) returning `{ orders, expenses, ledger, loans, accounts, invoices, settings }`, plus the default-exported Vercel handler.

- [ ] **Step 1: Write the failing test**

Create `api/data.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { getAllData } from './data.js';

function fakeRedis(store) {
  return { get: vi.fn((key) => Promise.resolve(store[key] ?? null)) };
}

describe('getAllData', () => {
  it('returns stored arrays and settings', async () => {
    const redis = fakeRedis({
      'preview:data:orders': [{ id: '1' }],
      'preview:data:settings': { realExchangeRate: 33 },
    });
    const result = await getAllData(redis);
    expect(result.orders).toEqual([{ id: '1' }]);
    expect(result.settings).toEqual({ realExchangeRate: 33 });
  });

  it('defaults every array entity to [] when nothing is stored yet', async () => {
    const redis = fakeRedis({});
    const result = await getAllData(redis);
    expect(result.orders).toEqual([]);
    expect(result.expenses).toEqual([]);
    expect(result.ledger).toEqual([]);
    expect(result.loans).toEqual([]);
    expect(result.accounts).toEqual([]);
    expect(result.invoices).toEqual([]);
  });

  it('defaults settings to the current real exchange rate default when unset', async () => {
    const redis = fakeRedis({});
    const result = await getAllData(redis);
    expect(result.settings).toEqual({ realExchangeRate: 32 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `api/data.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `api/data.js`:

```js
import { getRedis, dataKey, settingsKey } from './_lib/redis.js';

const ARRAY_ENTITIES = ['orders', 'expenses', 'ledger', 'loans', 'accounts', 'invoices'];

export async function getAllData(redis) {
  const arrayResults = await Promise.all(
    ARRAY_ENTITIES.map((entity) => redis.get(dataKey(entity)))
  );
  const data = {};
  ARRAY_ENTITIES.forEach((entity, i) => { data[entity] = arrayResults[i] || []; });
  data.settings = (await redis.get(settingsKey())) || { realExchangeRate: 32 };
  return data;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const data = await getAllData(getRedis());
    res.status(200).json(data);
  } catch (err) {
    console.error('GET /api/data failed', err);
    res.status(500).json({ error: 'Failed to load data' });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/data.js api/data.test.js
git commit -m "feat: add GET /api/data endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `POST /api/data/save`

**Files:**
- Create: `api/data/save.js`
- Create: `api/data/save.test.js`

**Interfaces:**
- Consumes: `getRedis()`, `dataKey(entity)`, `settingsKey()` from `api/_lib/redis.js`; `upsertById(existing, incoming)` from `api/_lib/merge.js`.
- Produces: exported `saveData(redis, key, value)` returning the merged/stored result; default-exported Vercel handler for `POST /api/data/save` with body `{ key, value }`.

- [ ] **Step 1: Write the failing test**

Create `api/data/save.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { saveData } from './save.js';

function fakeRedis(store) {
  return {
    get: vi.fn((key) => Promise.resolve(store[key] ?? null)),
    set: vi.fn((key, value) => { store[key] = value; return Promise.resolve('OK'); }),
  };
}

describe('saveData', () => {
  it('upserts incoming array items by id instead of overwriting', async () => {
    const store = { 'preview:data:orders': [{ id: 'a', v: 1 }] };
    const redis = fakeRedis(store);
    const result = await saveData(redis, 'orders', [{ id: 'b', v: 2 }]);
    expect(result).toEqual([{ id: 'b', v: 2 }, { id: 'a', v: 1 }]);
    expect(store['preview:data:orders']).toEqual(result);
  });

  it('rejects an unknown key', async () => {
    const redis = fakeRedis({});
    await expect(saveData(redis, 'not_a_real_key', [])).rejects.toThrow();
  });

  it('shallow-merges settings instead of replacing wholesale', async () => {
    const store = { 'preview:data:settings': { realExchangeRate: 32, other: 'x' } };
    const redis = fakeRedis(store);
    const result = await saveData(redis, 'settings', { realExchangeRate: 33 });
    expect(result).toEqual({ realExchangeRate: 33, other: 'x' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `api/data/save.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `api/data/save.js`:

```js
import { getRedis, dataKey, settingsKey } from '../_lib/redis.js';
import { upsertById } from '../_lib/merge.js';

const ARRAY_ENTITIES = ['orders', 'expenses', 'ledger', 'loans', 'accounts', 'invoices'];

export async function saveData(redis, key, value) {
  if (key === 'settings') {
    const current = (await redis.get(settingsKey())) || {};
    const merged = { ...current, ...value };
    await redis.set(settingsKey(), merged);
    return merged;
  }
  if (!ARRAY_ENTITIES.includes(key)) {
    throw new Error(`Unknown storage key: ${key}`);
  }
  const existing = (await redis.get(dataKey(key))) || [];
  const merged = upsertById(existing, value);
  await redis.set(dataKey(key), merged);
  return merged;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { key, value } = req.body || {};
  if (!key || value === undefined) {
    return res.status(400).json({ error: 'key and value are required' });
  }
  try {
    const result = await saveData(getRedis(), key, value);
    res.status(200).json({ value: result });
  } catch (err) {
    console.error('POST /api/data/save failed', err);
    res.status(400).json({ error: err.message || 'Save failed' });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/data/save.js api/data/save.test.js
git commit -m "feat: add POST /api/data/save with merge-by-id upsert

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `POST /api/data/delete`

**Files:**
- Create: `api/data/delete.js`
- Create: `api/data/delete.test.js`

**Interfaces:**
- Consumes: `getRedis()`, `dataKey(entity)` from `api/_lib/redis.js`; `removeById(existing, id)` from `api/_lib/merge.js`.
- Produces: exported `deleteData(redis, key, id)` returning the resulting array; default-exported handler for `POST /api/data/delete` with body `{ key, id }`.

- [ ] **Step 1: Write the failing test**

Create `api/data/delete.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { deleteData } from './delete.js';

function fakeRedis(store) {
  return {
    get: vi.fn((key) => Promise.resolve(store[key] ?? null)),
    set: vi.fn((key, value) => { store[key] = value; return Promise.resolve('OK'); }),
  };
}

describe('deleteData', () => {
  it('removes the item with the matching id', async () => {
    const store = { 'preview:data:orders': [{ id: 'a' }, { id: 'b' }] };
    const redis = fakeRedis(store);
    const result = await deleteData(redis, 'orders', 'a');
    expect(result).toEqual([{ id: 'b' }]);
    expect(store['preview:data:orders']).toEqual([{ id: 'b' }]);
  });

  it('rejects an unknown key', async () => {
    const redis = fakeRedis({});
    await expect(deleteData(redis, 'settings', 'a')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `api/data/delete.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `api/data/delete.js`:

```js
import { getRedis, dataKey } from '../_lib/redis.js';
import { removeById } from '../_lib/merge.js';

const ARRAY_ENTITIES = ['orders', 'expenses', 'ledger', 'loans', 'accounts', 'invoices'];

export async function deleteData(redis, key, id) {
  if (!ARRAY_ENTITIES.includes(key)) {
    throw new Error(`Unknown or non-deletable storage key: ${key}`);
  }
  const existing = (await redis.get(dataKey(key))) || [];
  const result = removeById(existing, id);
  await redis.set(dataKey(key), result);
  return result;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { key, id } = req.body || {};
  if (!key || !id) return res.status(400).json({ error: 'key and id are required' });
  try {
    const result = await deleteData(getRedis(), key, id);
    res.status(200).json({ value: result });
  } catch (err) {
    console.error('POST /api/data/delete failed', err);
    res.status(400).json({ error: err.message || 'Delete failed' });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/data/delete.js api/data/delete.test.js
git commit -m "feat: add POST /api/data/delete

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `POST /api/next-number`

**Files:**
- Create: `api/next-number.js`
- Create: `api/next-number.test.js`

**Interfaces:**
- Consumes: `getRedis()`, `counterKey(company, type)` from `api/_lib/redis.js`.
- Produces: exported `getNextNumber(redis, company, type)` returning a number; default-exported handler for `POST /api/next-number` with body `{ company, type }`, responding `{ number }`.

- [ ] **Step 1: Write the failing test**

Create `api/next-number.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { getNextNumber } from './next-number.js';

function fakeRedis(store) {
  return {
    incr: vi.fn((key) => {
      store[key] = (store[key] || 0) + 1;
      return Promise.resolve(store[key]);
    }),
  };
}

describe('getNextNumber', () => {
  it('returns 1 for a company/type with no prior counter', async () => {
    const redis = fakeRedis({});
    expect(await getNextNumber(redis, 'drip_ittt', 'order')).toBe(1);
  });

  it('returns sequential numbers on repeated calls', async () => {
    const store = {};
    const redis = fakeRedis(store);
    expect(await getNextNumber(redis, 'drip_ittt', 'order')).toBe(1);
    expect(await getNextNumber(redis, 'drip_ittt', 'order')).toBe(2);
    expect(await getNextNumber(redis, 'drip_ittt', 'order')).toBe(3);
  });

  it('keeps order and invoice counters independent', async () => {
    const store = {};
    const redis = fakeRedis(store);
    await getNextNumber(redis, 'drip_ittt', 'order');
    expect(await getNextNumber(redis, 'drip_ittt', 'invoice')).toBe(1);
  });

  it('keeps different companies independent', async () => {
    const store = {};
    const redis = fakeRedis(store);
    await getNextNumber(redis, 'drip_ittt', 'order');
    expect(await getNextNumber(redis, 'NOVUS', 'order')).toBe(1);
  });

  it('rejects an invalid type', async () => {
    const redis = fakeRedis({});
    await expect(getNextNumber(redis, 'drip_ittt', 'bogus')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `api/next-number.js` does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `api/next-number.js`:

```js
import { getRedis, counterKey } from './_lib/redis.js';

export async function getNextNumber(redis, company, type) {
  if (type !== 'order' && type !== 'invoice') {
    throw new Error(`Invalid counter type: ${type}`);
  }
  // Redis INCR on a key that doesn't exist yet initializes it to 0 first,
  // so the first-ever call for a fresh company correctly returns 1 — this
  // is the one operation that must be atomic across devices, unlike
  // everything else in this app.
  return redis.incr(counterKey(company, type));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { company, type } = req.body || {};
  if (!company || !type) return res.status(400).json({ error: 'company and type are required' });
  try {
    const number = await getNextNumber(getRedis(), company, type);
    res.status(200).json({ number });
  } catch (err) {
    console.error('POST /api/next-number failed', err);
    res.status(400).json({ error: err.message || 'Failed to get next number' });
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/next-number.js api/next-number.test.js
git commit -m "feat: add atomic POST /api/next-number counter endpoint

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: Deploy the backend to a Preview and smoke-test it end-to-end

This is the first point real Redis gets exercised — everything before
this was unit tests against a fake client.

**Files:** none (deploy + manual verification only).

- [ ] **Step 1: Push the branch and get the Preview URL**

```bash
git push -u origin feature/shared-cloud-storage
```

Vercel auto-deploys a Preview for this branch (it's already connected
to this GitHub repo). Get the Preview URL from the Vercel dashboard's
Deployments list, or from the GitHub PR check if one exists.

- [ ] **Step 2: Confirm the Upstash env vars reached the Preview**

```bash
curl -s https://<preview-url>/api/data
```

Expected: `{"orders":[],"expenses":[],"ledger":[],"loans":[],"accounts":[],"invoices":[],"settings":{"realExchangeRate":32}}`

If this instead returns a 500 error, the Upstash integration from Task
2 Step 1 hasn't reached this deployment yet — redeploy after confirming
in the Vercel dashboard that the integration is connected to this
project (env vars apply to new deployments, not deployments already in
flight).

- [ ] **Step 3: Smoke-test save (merge-by-id)**

```bash
curl -s -X POST https://<preview-url>/api/data/save \
  -H "Content-Type: application/json" \
  -d '{"key":"orders","value":[{"id":"test-1","customerName":"Test Order One"}]}'
```

Expected: `{"value":[{"id":"test-1","customerName":"Test Order One"}]}`

Run it again with a second, different id:

```bash
curl -s -X POST https://<preview-url>/api/data/save \
  -H "Content-Type: application/json" \
  -d '{"key":"orders","value":[{"id":"test-2","customerName":"Test Order Two"}]}'
```

Expected: `{"value":[{"id":"test-2",...},{"id":"test-1",...}]}` — **both**
orders present. This is the concurrency-safety property from the spec:
if this instead only showed `test-2`, the merge logic isn't actually
being used by the deployed function.

- [ ] **Step 4: Smoke-test delete**

```bash
curl -s -X POST https://<preview-url>/api/data/delete \
  -H "Content-Type: application/json" \
  -d '{"key":"orders","id":"test-1"}'
```

Expected: `{"value":[{"id":"test-2",...}]}`

- [ ] **Step 5: Smoke-test the atomic counter**

```bash
curl -s -X POST https://<preview-url>/api/next-number \
  -H "Content-Type: application/json" -d '{"company":"drip_ittt","type":"order"}'
curl -s -X POST https://<preview-url>/api/next-number \
  -H "Content-Type: application/json" -d '{"company":"drip_ittt","type":"order"}'
```

Expected: `{"number":1}` then `{"number":2}`.

- [ ] **Step 6: Clean up the test order**

```bash
curl -s -X POST https://<preview-url>/api/data/delete \
  -H "Content-Type: application/json" \
  -d '{"key":"orders","id":"test-2"}'
```

Expected: `{"value":[]}` — Preview Redis is clean again before client work starts.

No commit for this task — it's verification only.

---

### Task 8: Wire the client's read path to `/api/data`

Read-only for now — saves still go to `localStorage` only, unchanged.
This keeps the change reviewable in two smaller, independently-safe
steps instead of one large one.

**Files:**
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `GET /api/data` (Task 3).

- [ ] **Step 1: Replace the load effect**

In `src/App.jsx`, find the load effect (currently around line 402-432):

```js
  // Load
  useEffect(() => {
    (async () => {
      const [o, e, l, ln, ac, inv, ct, cc, st] = await Promise.all([
        storage.load('po_orders', []),
        storage.load('po_expenses', []),
        storage.load('po_ledger', []),
        storage.load('po_loans', []),
        storage.load('po_accounts', getDefaultAccounts()),
        storage.load('po_invoices', []),
        storage.load('po_counters', { drip_ittt: { order: 1, invoice: 1 }, NOVUS: { order: 1, invoice: 1 } }),
        storage.load('po_current_company', 'drip_ittt'),
        storage.load('po_settings', { realExchangeRate: 32 })
      ]);
      setOrders(o.map(x => ({ company: 'drip_ittt', ...x })));
      // One-time migration: RM entries recorded before rate-locking existed have no
      // lockedRate. Freeze them at today's rate now so they stop drifting when the
      // rate setting changes later — the true historical rate was never recorded,
      // so "now" is the best available anchor; only entries missing it are touched.
      const migrateRate = parseFloat(st.realExchangeRate) || 32;
      setExpenses(e.map(x => ({ company: 'drip_ittt', ...x, ...((x.currency === 'RM' && !x.lockedRate) ? { lockedRate: migrateRate } : {}) })));
      setLedger(l.map(x => (((x.kind === 'cogs' || x.kind === 'expense') && x.currency === 'RM' && !x.lockedRate) ? { ...x, lockedRate: migrateRate } : x)));
      setLoans(ln);
      setAccounts(ac);
      setInvoices(inv);
      setCounters(ct);
      setCurrentCompany(cc);
      setSettings(st);
      setLoaded(true);
    })();
  }, []);
```

Replace it with:

```js
  // Load — render instantly from local cache, then reconcile with the
  // server in the background so the UI never blocks on a network round trip.
  useEffect(() => {
    const applyData = (o, e, l, ln, ac, inv, st) => {
      setOrders(o.map(x => ({ company: 'drip_ittt', ...x })));
      // One-time migration: RM entries recorded before rate-locking existed have no
      // lockedRate. Freeze them at today's rate now so they stop drifting when the
      // rate setting changes later — the true historical rate was never recorded,
      // so "now" is the best available anchor; only entries missing it are touched.
      const migrateRate = parseFloat(st.realExchangeRate) || 32;
      setExpenses(e.map(x => ({ company: 'drip_ittt', ...x, ...((x.currency === 'RM' && !x.lockedRate) ? { lockedRate: migrateRate } : {}) })));
      setLedger(l.map(x => (((x.kind === 'cogs' || x.kind === 'expense') && x.currency === 'RM' && !x.lockedRate) ? { ...x, lockedRate: migrateRate } : x)));
      setLoans(ln);
      setAccounts(ac);
      setInvoices(inv);
      setSettings(st);
    };

    (async () => {
      // 1) Instant paint from whatever's cached locally (empty on a brand
      // new device — that's fine, the server fetch right after fills it in).
      const [o, e, l, ln, ac, inv, cc, st] = await Promise.all([
        storage.load('po_orders', []),
        storage.load('po_expenses', []),
        storage.load('po_ledger', []),
        storage.load('po_loans', []),
        storage.load('po_accounts', getDefaultAccounts()),
        storage.load('po_invoices', []),
        storage.load('po_current_company', 'drip_ittt'),
        storage.load('po_settings', { realExchangeRate: 32 })
      ]);
      applyData(o, e, l, ln, ac, inv, st);
      setCurrentCompany(cc);
      setLoaded(true);

      // 2) Reconcile with the server — this is the shared, authoritative copy.
      try {
        const res = await fetch('/api/data');
        if (res.ok) {
          const server = await res.json();
          applyData(
            server.orders, server.expenses, server.ledger, server.loans,
            server.accounts, server.invoices, server.settings
          );
          // Keep the local cache in sync with what the server just gave us.
          _local.set('po_orders', JSON.stringify(server.orders));
          _local.set('po_expenses', JSON.stringify(server.expenses));
          _local.set('po_ledger', JSON.stringify(server.ledger));
          _local.set('po_loans', JSON.stringify(server.loans));
          _local.set('po_accounts', JSON.stringify(server.accounts));
          _local.set('po_invoices', JSON.stringify(server.invoices));
          _local.set('po_settings', JSON.stringify(server.settings));
        }
      } catch (err) {
        console.warn('Could not reach the server — showing locally cached data', err);
      }
    })();
  }, []);
```

Note: `setCounters`/`po_counters` loading is intentionally gone — Task
10 removes `counters` state entirely. Between this task and Task 10,
`counters` state exists but is never populated (stays `{}`). This is
safe: `computeNextNumber` (still in use until Task 10) takes
`Math.max(maxFromData + 1, savedCounter)`, and `maxFromData` — scanned
fresh from `cOrders`/`cInvoices`, which Task 8 still loads correctly —
produces the right next number regardless of what `counters` holds. Do
not skip ahead and remove `computeNextNumber` early because of this;
Task 10 handles that removal together with switching to the server
counter, in one commit.

- [ ] **Step 2: Build and confirm no syntax errors**

Run: `npm run build`
Expected: builds cleanly (this step doesn't yet touch anything requiring live Redis at build time — it's a static build check).

- [ ] **Step 3: Manual verification against the Preview**

Push this commit, wait for the Preview to redeploy, then:

```bash
curl -s -X POST https://<preview-url>/api/data/save \
  -H "Content-Type: application/json" \
  -d '{"key":"orders","value":[{"id":"verify-1","company":"drip_ittt","orderNumber":"DI-TEST","customerName":"Read Path Check","status":"pending"}]}'
```

Open `https://<preview-url>/` in a browser and confirm "Read Path
Check" appears in the Orders list — proving the client actually loaded
it from the server, not from a local cache (this browser has never
visited this Preview URL before, so it has no local cache to fall back
on).

Clean up:

```bash
curl -s -X POST https://<preview-url>/api/data/delete \
  -H "Content-Type: application/json" -d '{"key":"orders","id":"verify-1"}'
```

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat: load app data from the shared server, cache locally

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Wire the client's write path to `/api/data/save` and `/api/data/delete`

**Files:**
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `POST /api/data/save`, `POST /api/data/delete` (Tasks 4-5).

- [ ] **Step 1: Rewrite the `storage` object**

Find the current `storage` object (around line 302-364):

```js
const storage = {
  async load(key, fallback) {
    // 1) Try Google Sheets first if configured (it's the source of truth)
    const entity = KEY_TO_ENTITY[key];
    if (API_URL && entity && entity !== '__local__') {
      try {
        const res = await fetch(`${API_URL}?action=list&entity=${entity}`);
        const body = await res.json();
        if (body.ok) {
          if (entity === 'counters') {
            const merged = {};
            body.data.forEach(c => { merged[c.id] = c; });
            const result = Object.keys(merged).length ? merged : fallback;
            _local.set(key, JSON.stringify(result)); // cache locally
            return result;
          }
          _local.set(key, JSON.stringify(body.data)); // cache locally
          return body.data;
        }
      } catch (err) {
        console.warn('Sheets load failed, using local copy for', key, err);
      }
    }
    // 2) Fall back to localStorage (always works, survives sleep/restart)
    try {
      const raw = _local.get(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },

  async save(key, value) {
    // Always save locally first so nothing is ever lost
    try { _local.set(key, JSON.stringify(value)); } catch (e) { console.error(e); }

    // Then sync to Google Sheets if configured.
    // NOTE: We send body as text/plain to avoid a CORS preflight (Apps Script
    // doesn't reply to OPTIONS requests). Apps Script reads e.postData.contents
    // either way, so the JSON body still parses on the server.
    const entity = KEY_TO_ENTITY[key];
    // Effective URL: hardcoded constant OR URL saved by user in Export & Sync
    const effectiveApiUrl = (typeof window !== 'undefined' && window.__PO_SHEETS_URL__) || API_URL;
    if (!effectiveApiUrl || !entity || entity === '__local__') return;
    try {
      if (entity === 'counters') {
        for (const company of Object.keys(value)) {
          await fetch(effectiveApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ action: 'save', entity, data: { id: company, ...value[company] } })
          });
        }
      } else {
        await fetch(effectiveApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'replaceAll', entity, data: value })
        });
      }
    } catch (err) {
      console.warn('Sheets save failed (saved locally) for', key, err);
    }
  }
};
```

Replace it with:

```js
const storage = {
  // `load` stays local-only — Task 8's load effect fetches everything from
  // the server itself right after this resolves. This function now exists
  // only to serve the "instant paint from cache" first half of that effect,
  // and for po_current_company, which never goes through the server at all.
  async load(key, fallback) {
    try {
      const raw = _local.get(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch { return fallback; }
  },

  async save(key, value) {
    // Always save locally first so nothing is ever lost, even offline.
    try { _local.set(key, JSON.stringify(value)); } catch (e) { console.error(e); }

    // po_current_company is a per-device UI preference — never synced.
    const entity = KEY_TO_ENTITY[key];
    if (!entity || entity === '__local__' || entity === 'counters') return;

    // Everything else is shared business data — push to the server, which
    // merges by id (arrays) or shallow-merges (settings) rather than
    // blindly overwriting, so two devices saving around the same time
    // can't erase each other's changes. See api/data/save.js.
    try {
      await fetch('/api/data/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: entity, value })
      });
    } catch (err) {
      console.warn('Server save failed (saved locally) for', key, err);
    }
  }
};
```

- [ ] **Step 2: Route deletes through the new endpoint**

In each of `deleteOrder`, `deleteExpense`, `deleteLoan`, `deleteAccount`
(all in `src/App.jsx`), add a call to the new delete endpoint alongside
the existing local-state filter. For example, `deleteOrder` currently
reads:

```js
  const deleteOrder = (id) => {
    if (!confirm('Delete this order record? Its payment history stays in Books & Ledger and its invoice is kept, so your account balances and invoice sequence stay accurate — only the order entry itself is removed. Use Cancel instead if you just want to mark it inactive.')) return;
    setOrders(prev => prev.filter(o => o.id !== id));
    setSelectedOrder(null);
    showToast('Order deleted — its ledger entries and invoice were kept');
  };
```

Add the server call right after the local filter:

```js
  const deleteOrder = (id) => {
    if (!confirm('Delete this order record? Its payment history stays in Books & Ledger and its invoice is kept, so your account balances and invoice sequence stay accurate — only the order entry itself is removed. Use Cancel instead if you just want to mark it inactive.')) return;
    setOrders(prev => prev.filter(o => o.id !== id));
    fetch('/api/data/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'orders', id })
    }).catch(err => console.warn('Server delete failed for order', id, err));
    setSelectedOrder(null);
    showToast('Order deleted — its ledger entries and invoice were kept');
  };
```

Apply the same change to the other three delete functions.

`deleteExpense` currently reads:

```js
  const deleteExpense = (id) => {
    if (!confirm('Delete this expense record? Its matching entry stays in Books & Ledger so account balances stay accurate — only the expense record itself is removed.')) return;
    setExpenses(prev => prev.filter(e => e.id !== id));
    showToast('Expense deleted — its ledger entry was kept');
  };
```

Change to:

```js
  const deleteExpense = (id) => {
    if (!confirm('Delete this expense record? Its matching entry stays in Books & Ledger so account balances stay accurate — only the expense record itself is removed.')) return;
    setExpenses(prev => prev.filter(e => e.id !== id));
    fetch('/api/data/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'expenses', id })
    }).catch(err => console.warn('Server delete failed for expense', id, err));
    showToast('Expense deleted — its ledger entry was kept');
  };
```

`deleteLoan` currently reads:

```js
  const deleteLoan = (id) => {
    if (!confirm('Delete this loan record? Its matching entries stay in Books & Ledger so account balances stay accurate — only the loan record itself is removed.')) return;
    setLoans(loans.filter(l => l.id !== id));
    showToast('Loan deleted — its ledger entries were kept');
  };
```

Change to:

```js
  const deleteLoan = (id) => {
    if (!confirm('Delete this loan record? Its matching entries stay in Books & Ledger so account balances stay accurate — only the loan record itself is removed.')) return;
    setLoans(loans.filter(l => l.id !== id));
    fetch('/api/data/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'loans', id })
    }).catch(err => console.warn('Server delete failed for loan', id, err));
    showToast('Loan deleted — its ledger entries were kept');
  };
```

`deleteAccount` currently reads:

```js
  const deleteAccount = (id) => {
    if (!confirm('Delete this account? Existing transactions will remain.')) return;
    setAccounts(accounts.filter(a => a.id !== id));
    showToast('Account deleted');
  };
```

Change to:

```js
  const deleteAccount = (id) => {
    if (!confirm('Delete this account? Existing transactions will remain.')) return;
    setAccounts(accounts.filter(a => a.id !== id));
    fetch('/api/data/delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'accounts', id })
    }).catch(err => console.warn('Server delete failed for account', id, err));
    showToast('Account deleted');
  };
```

- [ ] **Step 3: Build and confirm no syntax errors**

Run: `npm run build`
Expected: builds cleanly.

- [ ] **Step 4: Manual verification against the Preview — two "devices"**

Push this commit, wait for the Preview to redeploy, then open the
Preview URL in **two different browser profiles** (or one normal
window + one incognito window, so they don't share `localStorage`):

1. In window A, create a new order.
2. In window B, refresh the page — confirm the order from window A
   appears.
3. In window B, add a *different* new order.
4. In window A, refresh — confirm it now sees **both** orders (this is
   the concurrency property: window A's refresh must not have erased
   window B's addition, and vice versa).
5. In window A, delete one of the two orders. Refresh window B —
   confirm it's gone there too.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat: push writes and deletes to the shared server

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Move order/invoice numbering to the atomic server counter

**Files:**
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: `POST /api/next-number` (Task 6).

- [ ] **Step 1: Remove the retired counter state and client-side numbering**

In `src/App.jsx`:

- Remove the `counters` state and its ref (currently around line
  380-386):
  ```js
  const [counters, setCounters] = useState({});
  const countersRef = useRef({});
  useEffect(() => { countersRef.current = counters; }, [counters]);
  ```
- Remove the `computeNextNumber` function (currently around line
  481-491).
- Remove the `po_counters` persist effect (currently around line 441):
  ```js
  useEffect(() => { if (loaded) storage.save('po_counters', counters); }, [counters, loaded]);
  ```
- Remove `po_counters`/`setCounters(ct)` from the load effect (Task 8
  already dropped this — confirm it's gone).
- Remove `po_counters: 'counters'` from `KEY_TO_ENTITY` (it's now
  unused).

- [ ] **Step 2: Make `addOrder` async and call the server for both numbers**

Find `addOrder` (currently around line 499-512):

```js
  const addOrder = (data) => {
    // Read + reserve from the ref (synchronous) so a second call in the same tick
    // never computes the same number — see countersRef comment above.
    const orderN = computeNextNumber('order', cOrders, cInvoices, countersRef.current);
    const invoiceN = computeNextNumber('invoice', cOrders, cInvoices, countersRef.current);
    const orderPrefix = currentCompany === 'NOVUS' ? 'NV' : 'DI';
    const invPrefix = currentCompany === 'NOVUS' ? 'NV-INV' : 'DI-INV';
    const orderNumber = `${orderPrefix}-${String(orderN).padStart(4, '0')}`;
    const invoiceNumber = `${invPrefix}-${String(invoiceN).padStart(4, '0')}`;

    // Reserve both numbers immediately (ref, not state) and bump both counters
    const curCounters = countersRef.current[currentCompany] || { order: 1, invoice: 1 };
    countersRef.current = { ...countersRef.current, [currentCompany]: { ...curCounters, order: orderN + 1, invoice: invoiceN + 1 } };
    setCounters(countersRef.current);
```

Replace the number-acquisition block (keep everything after it — the
rest of `addOrder`'s body that builds `newOrder`, `autoInvoice`, etc. —
unchanged) with:

```js
  const addOrder = async (data) => {
    // Server-assigned, atomically incremented — two devices creating an
    // order at the same moment cannot receive the same number, unlike a
    // client-computed "max existing + 1".
    const [orderN, invoiceN] = await Promise.all([
      fetch('/api/next-number', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: currentCompany, type: 'order' })
      }).then(r => r.json()).then(r => r.number),
      fetch('/api/next-number', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company: currentCompany, type: 'invoice' })
      }).then(r => r.json()).then(r => r.number),
    ]);
    const orderPrefix = currentCompany === 'NOVUS' ? 'NV' : 'DI';
    const invPrefix = currentCompany === 'NOVUS' ? 'NV-INV' : 'DI-INV';
    const orderNumber = `${orderPrefix}-${String(orderN).padStart(4, '0')}`;
    const invoiceNumber = `${invPrefix}-${String(invoiceN).padStart(4, '0')}`;
```

`addOrder` is called as `onSubmit={addOrder}` from `NewOrder`, which
does `onSubmit(payload)` without awaiting a return value — making
`addOrder` `async` needs no change at that call site; it simply
fires and the function's internal `await` resolves before the rest of
its body (which still calls `setOrders`, `setView`, etc.) runs.

- [ ] **Step 3: Make `addInvoice` async and call the server**

Find `addInvoice` (currently around line 911-917):

```js
  const addInvoice = (data) => {
    const n = computeNextNumber('invoice', cOrders, cInvoices, countersRef.current);
    const prefix = currentCompany === 'NOVUS' ? 'NV-INV' : 'DI-INV';
    const invoiceNumber = `${prefix}-${String(n).padStart(4, '0')}`;
    const curCounters = countersRef.current[currentCompany] || { order: 1, invoice: 1 };
    countersRef.current = { ...countersRef.current, [currentCompany]: { ...curCounters, invoice: n + 1 } };
    setCounters(countersRef.current);
```

Replace with:

```js
  const addInvoice = async (data) => {
    const n = await fetch('/api/next-number', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ company: currentCompany, type: 'invoice' })
    }).then(r => r.json()).then(r => r.number);
    const prefix = currentCompany === 'NOVUS' ? 'NV-INV' : 'DI-INV';
    const invoiceNumber = `${prefix}-${String(n).padStart(4, '0')}`;
```

- [ ] **Step 4: Build and confirm no syntax errors**

Run: `npm run build`
Expected: builds cleanly.

- [ ] **Step 5: Manual verification against the Preview**

Push, wait for redeploy, then on the Preview URL create two orders
back-to-back and confirm they get distinct, sequential order numbers
(e.g. `DI-0001`, `DI-0002` — since Preview Redis's counters are
separate from production's, per the environment-namespacing from Task
2, this correctly starts fresh rather than continuing production's
sequence).

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "feat: move order/invoice numbering to an atomic server counter

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Migration script

**Files:**
- Create: `scripts/migrate.mjs`

**Interfaces:**
- Consumes: `@upstash/redis` directly (this script runs standalone via `node`, outside the Vercel function environment, so it can't import `api/_lib/redis.js`'s `getRedis()` — that one depends on `VERCEL_ENV`, which isn't set locally. It builds its own client from the same two env vars.)

- [ ] **Step 1: Write the script**

Create `scripts/migrate.mjs`:

```js
// One-time migration: seed Redis from a JSON export of the production
// browser's localStorage (same shape as the exports used for the earlier
// local-dev -> production data merge). Run manually:
//
//   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... \
//     node scripts/migrate.mjs path/to/export.json [--env=preview|prod]
//
// The export JSON is expected to have the shape:
//   { po_orders: [...], po_expenses: [...], po_ledger: [...],
//     po_loans: [...], po_accounts: [...], po_invoices: [...],
//     po_counters: { drip_ittt: { order, invoice }, NOVUS: { order, invoice } },
//     po_settings: { realExchangeRate } }
import { readFileSync } from 'node:fs';
import { Redis } from '@upstash/redis';

const [, , exportPath, envFlag] = process.argv;
if (!exportPath) {
  console.error('Usage: node scripts/migrate.mjs <export.json> [--env=preview|prod]');
  process.exit(1);
}
const prefix = envFlag === '--env=prod' ? 'prod' : 'preview';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

const exportData = JSON.parse(readFileSync(exportPath, 'utf-8'));

const ENTITY_MAP = {
  orders: 'po_orders', expenses: 'po_expenses', ledger: 'po_ledger',
  loans: 'po_loans', accounts: 'po_accounts', invoices: 'po_invoices',
};

async function main() {
  for (const [entity, sourceKey] of Object.entries(ENTITY_MAP)) {
    const value = exportData[sourceKey] || [];
    await redis.set(`${prefix}:data:${entity}`, value);
    console.log(`Seeded ${prefix}:data:${entity} — ${value.length} item(s)`);
  }

  const settings = exportData.po_settings || { realExchangeRate: 32 };
  await redis.set(`${prefix}:data:settings`, settings);
  console.log(`Seeded ${prefix}:data:settings —`, settings);

  // Initialize the atomic counters one past the highest number already in
  // use, so numbering continues rather than restarting at 1 and colliding
  // with existing orders/invoices.
  const counters = exportData.po_counters || {};
  const companies = new Set(Object.keys(counters));
  (exportData.po_orders || []).forEach(o => o.company && companies.add(o.company));

  for (const company of companies) {
    for (const type of ['order', 'invoice']) {
      const fromCounters = (counters[company] || {})[type] || 1;
      const prefixLetters = company === 'NOVUS'
        ? (type === 'order' ? 'NV-' : 'NV-INV-')
        : (type === 'order' ? 'DI-' : 'DI-INV-');
      const items = type === 'order' ? (exportData.po_orders || []) : (exportData.po_invoices || []);
      const numberField = type === 'order' ? 'orderNumber' : 'invoiceNumber';
      let maxFromData = 0;
      items.forEach(it => {
        const num = it[numberField];
        if (num && num.startsWith(prefixLetters)) {
          const n = parseInt(num.slice(prefixLetters.length), 10);
          if (!isNaN(n) && n > maxFromData) maxFromData = n;
        }
      });
      const startAt = Math.max(maxFromData, fromCounters - 1);
      await redis.set(`${prefix}:counter:${company}:${type}`, startAt);
      console.log(`Set ${prefix}:counter:${company}:${type} = ${startAt} (next call returns ${startAt + 1})`);
    }
  }

  console.log('Migration complete.');
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Dry-run against Preview using the same export technique from the earlier data-merge work**

In a browser tab open to the CURRENT production app
(`https://drip-it-lilac.vercel.app/`, still on the old `localStorage`-only
build at this point since `main` hasn't been touched yet), run in the
console:

```js
const keys = ['po_orders','po_expenses','po_ledger','po_loans','po_accounts','po_invoices','po_counters','po_settings','po_current_company'];
const out = {};
keys.forEach(k => { const raw = localStorage.getItem(k); out[k] = raw ? JSON.parse(raw) : null; });
const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a'); a.href = url; a.download = 'production_export.json'; a.click();
```

Save the downloaded file somewhere local, then dry-run into Preview's
namespace (never `--env=prod` at this stage):

```bash
UPSTASH_REDIS_REST_URL=<from Vercel dashboard> \
UPSTASH_REDIS_REST_TOKEN=<from Vercel dashboard> \
  node scripts/migrate.mjs ~/Downloads/production_export.json --env=preview
```

Put the two credential values in a local `.env.local` (already
git-ignored via the `*.local` pattern) instead of typing them on the
command line if preferred:

```
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

then `node --env-file=.env.local scripts/migrate.mjs ~/Downloads/production_export.json --env=preview`.

- [ ] **Step 3: Verify the dry run against the Preview deployment**

```bash
curl -s https://<preview-url>/api/data | head -c 500
```

Expected: the real order/expense/ledger counts from production now
show up on the Preview URL. Confirm in the Preview's browser UI too —
Dashboard totals should match production's.

- [ ] **Step 4: Commit the script (not the export or credentials)**

```bash
git add scripts/migrate.mjs
git commit -m "feat: add one-time Redis migration script

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: Production cutover

⚠️ **This is the only task that touches real production data. Confirm
Task 9's two-window concurrency test and Task 11's Preview dry-run both
passed before starting this.**

**Files:** none (deploy + migration run only).

- [ ] **Step 1: Merge to `main`**

```bash
git checkout main
git pull origin main
git merge feature/shared-cloud-storage
git push origin main
```

This triggers the real production deployment at
`https://drip-it-lilac.vercel.app/`.

- [ ] **Step 2: Confirm the production API is live**

```bash
curl -s https://drip-it-lilac.vercel.app/api/data
```

Expected: `{"orders":[],...}` — empty, because production Redis
(`prod:` prefix) hasn't been seeded yet. This is expected and about to
be fixed in the next step. (The app itself will still work fine in the
meantime via its `localStorage` cache fallback.)

- [ ] **Step 3: Run the migration against production**

Using the same `production_export.json` from Task 11 (re-export fresh
first if any orders were added since then, using the same browser
console snippet against `https://drip-it-lilac.vercel.app/` again):

```bash
node --env-file=.env.local scripts/migrate.mjs ~/Downloads/production_export.json --env=prod
```

- [ ] **Step 4: Verify production**

```bash
curl -s https://drip-it-lilac.vercel.app/api/data | head -c 500
```

Expected: real order/expense/ledger data, matching what was in
`localStorage` before this change.

Open the production URL on **your phone** and confirm you now see the
same orders, revenue figures, and account balances as your laptop —
this is the actual acceptance test for the whole feature. Add a test
order from your phone, then check it appears on your laptop after a
refresh.

- [ ] **Step 5: Clean up the feature branch**

```bash
git branch -d feature/shared-cloud-storage
git push origin --delete feature/shared-cloud-storage
```

No further commit — this task is deployment and verification only.

---

## Explicitly not built in this plan (matches the spec's stated scope)

- Authentication — link grants full access, as decided.
- Real-time push updates between devices — each device reconciles with
  the server on its own load/save, not on someone else's concurrent edit.
  A manual refresh picks up other devices' changes.
- Fixing the pre-existing order with no COGS ledger entry, found during
  the earlier accounting review — unrelated cleanup, not part of this
  storage change.
