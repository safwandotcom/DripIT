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
