import { getRedis, dataKey, settingsKey } from '../_lib/redis.js';
import { upsertById } from '../_lib/merge.js';
import { casUpdate } from '../_lib/cas.js';

const ARRAY_ENTITIES = ['orders', 'expenses', 'ledger', 'loans', 'accounts', 'invoices'];

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
