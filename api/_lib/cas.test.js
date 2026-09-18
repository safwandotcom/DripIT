import { describe, it, expect, vi } from 'vitest';
import { casUpdate } from './cas.js';

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

describe('casUpdate', () => {
  it('computes and stores the result when there is no existing value', async () => {
    const store = {};
    const redis = fakeRedis(store);
    const result = await casUpdate(redis, 'k', (existing) => (existing || []).concat('a'));
    expect(result).toEqual(['a']);
    expect(store['k']).toEqual(['a']);
  });

  it('computes from the existing value when present', async () => {
    const store = { k: ['a'] };
    const redis = fakeRedis(store);
    const result = await casUpdate(redis, 'k', (existing) => existing.concat('b'));
    expect(result).toEqual(['a', 'b']);
  });

  it('retries and succeeds after losing the CAS once to a concurrent writer', async () => {
    const store = { k: ['a'] };
    let writeAttempts = 0;
    const redis = {
      eval: vi.fn((script, keys, args) => {
        if (args.length === 0) return Promise.resolve(store['k']);
        writeAttempts++;
        if (writeAttempts === 1) return Promise.resolve(0); // lost the race
        store['k'] = ['a', 'c'];
        return Promise.resolve(1);
      }),
    };
    const result = await casUpdate(redis, 'k', (existing) => existing.concat('c'));
    const writeCalls = redis.eval.mock.calls.filter(([, , args]) => args.length > 0);
    expect(writeCalls.length).toBe(2);
    expect(result).toEqual(['a', 'c']);
  });

  it('gives up after 5 consecutive conflicts instead of retrying forever', async () => {
    const store = { k: ['a'] };
    const redis = {
      eval: vi.fn((script, keys, args) => {
        if (args.length === 0) return Promise.resolve(store['k']);
        return Promise.resolve(0); // always conflicts
      }),
    };
    await expect(casUpdate(redis, 'k', (existing) => existing.concat('x')))
      .rejects.toThrow(/Concurrent write conflict/);
    const writeCalls = redis.eval.mock.calls.filter(([, , args]) => args.length > 0);
    expect(writeCalls.length).toBe(5);
  });
});
