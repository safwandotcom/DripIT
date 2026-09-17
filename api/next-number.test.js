import { describe, it, expect, vi } from 'vitest';
import { getNextNumber } from './next-number.js';

function fakeRedis(store) {
  return {
    incr: vi.fn((key) => {
      store[key] = (store[key] || 0) + 1;
      return Promise.resolve(store[key]);
    }),
  };
}

describe('getNextNumber', () => {
  it('returns 1 for a company/type with no prior counter', async () => {
    const redis = fakeRedis({});
    expect(await getNextNumber(redis, 'drip_ittt', 'order')).toBe(1);
  });

  it('returns sequential numbers on repeated calls', async () => {
    const store = {};
    const redis = fakeRedis(store);
    expect(await getNextNumber(redis, 'drip_ittt', 'order')).toBe(1);
    expect(await getNextNumber(redis, 'drip_ittt', 'order')).toBe(2);
    expect(await getNextNumber(redis, 'drip_ittt', 'order')).toBe(3);
  });

  it('keeps order and invoice counters independent', async () => {
    const store = {};
    const redis = fakeRedis(store);
    await getNextNumber(redis, 'drip_ittt', 'order');
    expect(await getNextNumber(redis, 'drip_ittt', 'invoice')).toBe(1);
  });

  it('keeps different companies independent', async () => {
    const store = {};
    const redis = fakeRedis(store);
    await getNextNumber(redis, 'drip_ittt', 'order');
    expect(await getNextNumber(redis, 'NOVUS', 'order')).toBe(1);
  });

  it('rejects an invalid type', async () => {
    const redis = fakeRedis({});
    await expect(getNextNumber(redis, 'drip_ittt', 'bogus')).rejects.toThrow();
  });
});
