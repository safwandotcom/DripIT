import { getRedis, dataKey, settingsKey } from '../_lib/redis.js';
import { upsertById } from '../_lib/merge.js';

const ARRAY_ENTITIES = ['orders', 'expenses', 'ledger', 'loans', 'accounts', 'invoices'];
const MAX_CAS_ATTEMPTS = 5;

// A plain GET-then-SET is not enough: if two devices' GETs both happen
// before either's SET, the second SET overwrites the first's change even
// though the merge logic itself is correct — this is the exact "two
// devices saving around the same time erase each other's work" scenario
// the spec calls out. This CAS (compare-and-swap) loop closes that gap:
// each write is conditioned on a version number nobody else has bumped
// since we read it, checked and applied atomically in one Redis-side Lua
// script. A loser retries with a fresh read (which now includes the
// winner's change), so no update is ever silently lost — it just costs a
// retry. The Lua script itself is deliberately dumb (pure numeric version
// compare + two SETs) — all business logic (upsertById, settings merge)
// stays in plain, unit-tested JS.
const CAS_SCRIPT = `
local curVersion = redis.call('GET', KEYS[2])
if curVersion == false then curVersion = '0' end
if curVersion == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2])
  redis.call('SET', KEYS[2], ARGV[3])
  return 1
else
  return 0
end
`;

async function casUpdate(redis, key, versionKey, computeNext, attempt = 0) {
  const [existing, version] = await Promise.all([
    redis.get(key),
    redis.get(versionKey),
  ]);
  const curVersion = version || 0;
  const next = computeNext(existing);
  const nextVersion = curVersion + 1;
  const ok = await redis.eval(
    CAS_SCRIPT,
    [key, versionKey],
    [String(curVersion), JSON.stringify(next), String(nextVersion)]
  );
  if (ok === 1) return next;
  if (attempt >= MAX_CAS_ATTEMPTS - 1) {
    throw new Error(`Concurrent write conflict on ${key} after ${MAX_CAS_ATTEMPTS} attempts`);
  }
  return casUpdate(redis, key, versionKey, computeNext, attempt + 1);
}

export async function saveData(redis, key, value) {
  if (key === 'settings') {
    const sKey = settingsKey();
    return casUpdate(redis, sKey, `${sKey}:v`, (current) => ({ ...(current || {}), ...value }));
  }
  if (!ARRAY_ENTITIES.includes(key)) {
    throw new Error(`Unknown storage key: ${key}`);
  }
  const dKey = dataKey(key);
  return casUpdate(redis, dKey, `${dKey}:v`, (existing) => upsertById(existing || [], value));
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
    // Distinguish a genuinely unknown key (client error) from everything
    // else (Redis/network failure, concurrent-write exhaustion after
    // MAX_CAS_ATTEMPTS) — which is this server's problem, not the caller's.
    const isClientError = err.message && err.message.startsWith('Unknown storage key');
    res.status(isClientError ? 400 : 500).json({ error: err.message || 'Save failed' });
  }
}
