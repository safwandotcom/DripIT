import { getRedis, counterKey } from './_lib/redis.js';

export async function getNextNumber(redis, company, type) {
  if (type !== 'order' && type !== 'invoice') {
    throw new Error(`Invalid counter type: ${type}`);
  }
  // Redis INCR on a key that doesn't exist yet initializes it to 0 first,
  // so the first-ever call for a fresh company correctly returns 1 — this
  // is the one operation that must be atomic across devices, unlike
  // everything else in this app. INCR is a single atomic Redis command
  // (unlike the save/delete GET-then-SET pattern), so no CAS is needed here.
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
    // Distinguish a genuinely invalid type (client error) from a Redis/
    // infra failure (this server's problem) — same reasoning as the
    // save/delete endpoints.
    const isClientError = err.message && err.message.startsWith('Invalid counter type');
    res.status(isClientError ? 400 : 500).json({ error: err.message || 'Failed to get next number' });
  }
}
