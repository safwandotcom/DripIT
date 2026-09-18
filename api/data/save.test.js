import { describe, it, expect, vi } from 'vitest';
import { saveData } from './save.js';

function fakeRedis(store) {
  return {
    eval: vi.fn((script, keys, args) => {
      const [key] = keys;
      if (args.length === 0) {
        // Real @upstash/redis auto-deserializes eval results, same as
        // .get() — return the parsed value directly, not a JSON string.
        return Promise.resolve(store[key] !== undefined ? store[key] : null);
      }
      const [expectedRaw, newRaw] = args;
      const curRaw = store[key] !== undefined ? JSON.stringify(store[key]) : null;
      const matches = expectedRaw === '' ? curRaw === null : curRaw === expectedRaw;
      if (!matches) return Promise.resolve(0);
      store[key] = JSON.parse(newRaw);
      return Promise.resolve(1);
    }),
  };
}

describe('saveData', () => {
  it('upserts incoming array items by id instead of overwriting', async () => {
    const store = { 'preview:data:orders': [{ id: 'a', v: 1 }] };
    const redis = fakeRedis(store);
    const result = await saveData(redis, 'orders', [{ id: 'b', v: 2 }]);
    expect(result).toEqual([{ id: 'b', v: 2 }, { id: 'a', v: 1 }]);
    expect(store['preview:data:orders']).toEqual(result);
  });

  it('rejects an unknown key', async () => {
    const redis = fakeRedis({});
    await expect(saveData(redis, 'not_a_real_key', [])).rejects.toThrow();
  });

  it('shallow-merges settings instead of replacing wholesale', async () => {
    const store = { 'preview:data:settings': { realExchangeRate: 32, other: 'x' } };
    const redis = fakeRedis(store);
    const result = await saveData(redis, 'settings', { realExchangeRate: 33 });
    expect(result).toEqual({ realExchangeRate: 33, other: 'x' });
  });

  it('starts a brand new key from empty when nothing is stored yet', async () => {
    const redis = fakeRedis({});
    const result = await saveData(redis, 'orders', [{ id: 'a' }]);
    expect(result).toEqual([{ id: 'a' }]);
  });
});
