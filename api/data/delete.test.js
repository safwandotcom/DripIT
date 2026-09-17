import { describe, it, expect, vi } from 'vitest';
import { deleteData } from './delete.js';

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

describe('deleteData', () => {
  it('removes the item with the matching id', async () => {
    const store = { 'preview:data:orders': [{ id: 'a' }, { id: 'b' }] };
    const redis = fakeRedis(store);
    const result = await deleteData(redis, 'orders', 'a');
    expect(result).toEqual([{ id: 'b' }]);
    expect(store['preview:data:orders']).toEqual([{ id: 'b' }]);
  });

  it('is a no-op when the id is not present', async () => {
    const store = { 'preview:data:orders': [{ id: 'a' }] };
    const redis = fakeRedis(store);
    const result = await deleteData(redis, 'orders', 'z');
    expect(result).toEqual([{ id: 'a' }]);
  });

  it('rejects an unknown key', async () => {
    const redis = fakeRedis({});
    await expect(deleteData(redis, 'settings', 'a')).rejects.toThrow();
  });
});
