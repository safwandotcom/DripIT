import { describe, it, expect, vi } from 'vitest';
import { saveData } from './save.js';

function fakeRedis(store) {
  return {
    get: vi.fn((key) => Promise.resolve(store[key] ?? null)),
    set: vi.fn((key, value) => { store[key] = value; return Promise.resolve('OK'); }),
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
});
