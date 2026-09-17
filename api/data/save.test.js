import { describe, it, expect, vi } from 'vitest';
import { saveData } from './save.js';

// Faithfully simulates the real CAS Lua script's behavior (numeric version
// compare + two SETs) so the three correctness tests below exercise the
// real merge/settings logic exactly as it runs in production, without a
// live Redis. The two retry-specific tests further down use a simpler,
// hand-scripted eval mock instead, because they're testing casUpdate's
// retry orchestration itself, not the script's own correctness.
function fakeRedis(store) {
  const versions = {};
  return {
    get: vi.fn((key) => Promise.resolve(store[key] ?? null)),
    eval: vi.fn((script, keys, args) => {
      const [dataKey, versionKey] = keys;
      const [expectedVersion, newValueJson, newVersion] = args;
      const curVersion = String(versions[versionKey] || 0);
      if (curVersion !== expectedVersion) return Promise.resolve(0);
      store[dataKey] = JSON.parse(newValueJson);
      versions[versionKey] = Number(newVersion);
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

  it('retries and succeeds after losing the CAS once to a concurrent writer', async () => {
    // Simulates: our first attempt's version check loses the race (someone
    // else wrote first). We must re-read (picking up their change) and
    // retry, succeeding on the second attempt.
    const store = { 'preview:data:orders': [{ id: 'a' }] };
    let evalCallCount = 0;
    const redis = {
      get: vi.fn((key) => Promise.resolve(store[key] ?? null)),
      eval: vi.fn(() => {
        evalCallCount++;
        if (evalCallCount === 1) return Promise.resolve(0); // lost the race
        store['preview:data:orders'] = [{ id: 'c' }, { id: 'a' }]; // second attempt wins
        return Promise.resolve(1);
      }),
    };
    const result = await saveData(redis, 'orders', [{ id: 'c' }]);
    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(result).toEqual([{ id: 'c' }, { id: 'a' }]);
  });

  it('gives up after 5 consecutive conflicts instead of retrying forever', async () => {
    const store = { 'preview:data:orders': [{ id: 'a' }] };
    const redis = {
      get: vi.fn((key) => Promise.resolve(store[key] ?? null)),
      eval: vi.fn(() => Promise.resolve(0)), // always conflicts
    };
    await expect(saveData(redis, 'orders', [{ id: 'c' }])).rejects.toThrow(/Concurrent write conflict/);
    expect(redis.eval).toHaveBeenCalledTimes(5);
  });
});
