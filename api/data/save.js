import { getRedis, dataKey, settingsKey } from '../_lib/redis.js';
import { upsertById } from '../_lib/merge.js';

const ARRAY_ENTITIES = ['orders', 'expenses', 'ledger', 'loans', 'accounts', 'invoices'];
const MAX_CAS_ATTEMPTS = 5;

// Read the key's raw current value via a Lua script (not the SDK's
// auto-parsing .get()) so we hold the EXACT string the CAS script below
// will compare against — no risk of a JSON.stringify/parse round trip
// producing a different byte sequence than what's actually stored.
const READ_SCRIPT = `return redis.call('GET', KEYS[1])`;

// Compare-and-swap against the data's own raw content, not a separate
// version counter. A single GET of ONE key is always self-consistent —
// there's no second key involved that could be read at a different
// moment, which is what made the previous (version-key) design's read
// step vulnerable to a narrow interleaving race. The empty-string
// sentinel (ARGV[1] === '') represents "I expected this key to not
// exist yet" (Redis GET on a missing key returns Lua `false`, which
// can't be sent back as an ARGV string, so '' stands in for it).
const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if cur == ARGV[1] or (cur == false and ARGV[1] == '') then
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
end
return 0
`;

async function casUpdate(redis, key, computeNext, attempt = 0) {
  const raw = await redis.eval(READ_SCRIPT, [key], []);
  const existing = raw ? JSON.parse(raw) : null;
  const next = computeNext(existing);
  const nextRaw = JSON.stringify(next);
  const ok = await redis.eval(CAS_SCRIPT, [key], [raw === null ? '' : raw, nextRaw]);
  if (ok === 1) return next;
  if (attempt >= MAX_CAS_ATTEMPTS - 1) {
    throw new Error(`Concurrent write conflict on ${key} after ${MAX_CAS_ATTEMPTS} attempts`);
  }
  return casUpdate(redis, key, computeNext, attempt + 1);
}

export async function saveData(redis, key, value) {
  if (key === 'settings') {
    return casUpdate(redis, settingsKey(), (current) => ({ ...(current || {}), ...value }));
  }
  if (!ARRAY_ENTITIES.includes(key)) {
    throw new Error(`Unknown storage key: ${key}`);
  }
  return casUpdate(redis, dataKey(key), (existing) => upsertById(existing || [], value));
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
    const isClientError = err.message && err.message.startsWith('Unknown storage key');
    res.status(isClientError ? 400 : 500).json({ error: err.message || 'Save failed' });
  }
}
