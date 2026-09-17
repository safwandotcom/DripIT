import { getRedis, dataKey } from '../_lib/redis.js';
import { removeById } from '../_lib/merge.js';
import { casUpdate } from '../_lib/cas.js';

const ARRAY_ENTITIES = ['orders', 'expenses', 'ledger', 'loans', 'accounts', 'invoices'];

export async function deleteData(redis, key, id) {
  if (!ARRAY_ENTITIES.includes(key)) {
    throw new Error(`Unknown or non-deletable storage key: ${key}`);
  }
  return casUpdate(redis, dataKey(key), (existing) => removeById(existing || [], id));
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
    const isClientError = err.message && err.message.startsWith('Unknown or non-deletable storage key');
    res.status(isClientError ? 400 : 500).json({ error: err.message || 'Delete failed' });
  }
}
