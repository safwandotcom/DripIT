import { Redis } from '@upstash/redis';

let client;

// A fresh Upstash client per cold start, reused across warm invocations
// of the same serverless instance.
export function getRedis() {
  if (!client) {
    // Vercel's Marketplace Upstash integration injects KV_REST_API_URL /
    // KV_REST_API_TOKEN (Vercel's older "KV" naming — Vercel KV was
    // historically Upstash Redis under a different name). A raw Upstash
    // account/integration would use UPSTASH_REDIS_REST_URL / _TOKEN
    // instead, so both are checked for robustness across either setup.
    client = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
      token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
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
