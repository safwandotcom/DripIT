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
