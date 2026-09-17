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
