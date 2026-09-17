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
