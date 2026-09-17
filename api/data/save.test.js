import { describe, it, expect, vi } from 'vitest';
import { saveData } from './save.js';

// Simulates the real CAS design: reading and writing both go through
// `eval` now (no plain `.get()`/`.set()` in the code under test), so the
// fake dispatches on argument shape: a read call passes an empty args
// array, a write (CAS) call passes [expectedRaw, newRaw].
function fakeRedis(store) {
  return {
    eval: vi.fn((script, keys, args) => {
      const [key] = keys;
      if (args.length === 0) {
        return Promise.resolve(store[key] !== undefined ? JSON.stringify(store[key]) : null);
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

  it('retries and succeeds after losing the CAS once to a concurrent writer', async () => {
    const store = { 'preview:data:orders': [{ id: 'a' }] };
    let writeAttempts = 0;
    const redis = {
      eval: vi.fn((script, keys, args) => {
        if (args.length === 0) {
          return Promise.resolve(JSON.stringify(store['preview:data:orders']));
        }
        writeAttempts++;
        if (writeAttempts === 1) return Promise.resolve(0); // lost the race
        store['preview:data:orders'] = [{ id: 'c' }, { id: 'a' }]; // second attempt wins
        return Promise.resolve(1);
      }),
    };
    const result = await saveData(redis, 'orders', [{ id: 'c' }]);
    const writeCalls = redis.eval.mock.calls.filter(([, , args]) => args.length > 0);
    expect(writeCalls.length).toBe(2);
    expect(result).toEqual([{ id: 'c' }, { id: 'a' }]);
  });

  it('gives up after 5 consecutive conflicts instead of retrying forever', async () => {
    const store = { 'preview:data:orders': [{ id: 'a' }] };
    const redis = {
      eval: vi.fn((script, keys, args) => {
        if (args.length === 0) return Promise.resolve(JSON.stringify(store['preview:data:orders']));
        return Promise.resolve(0); // always conflicts
      }),
    };
    await expect(saveData(redis, 'orders', [{ id: 'c' }])).rejects.toThrow(/Concurrent write conflict/);
    const writeCalls = redis.eval.mock.calls.filter(([, , args]) => args.length > 0);
    expect(writeCalls.length).toBe(5);
  });
});
