import { describe, it, expect, vi } from 'vitest';
import { getAllData } from './data.js';

function fakeRedis(store) {
  return { get: vi.fn((key) => Promise.resolve(store[key] ?? null)) };
}

describe('getAllData', () => {
  it('returns stored arrays and settings', async () => {
    const redis = fakeRedis({
      'preview:data:orders': [{ id: '1' }],
      'preview:data:settings': { realExchangeRate: 33 },
    });
    const result = await getAllData(redis);
    expect(result.orders).toEqual([{ id: '1' }]);
    expect(result.settings).toEqual({ realExchangeRate: 33 });
  });

  it('defaults every array entity to [] when nothing is stored yet', async () => {
    const redis = fakeRedis({});
    const result = await getAllData(redis);
    expect(result.orders).toEqual([]);
    expect(result.expenses).toEqual([]);
    expect(result.ledger).toEqual([]);
    expect(result.loans).toEqual([]);
    expect(result.accounts).toEqual([]);
    expect(result.invoices).toEqual([]);
  });

  it('defaults settings to the current real exchange rate default when unset', async () => {
    const redis = fakeRedis({});
    const result = await getAllData(redis);
    expect(result.settings).toEqual({ realExchangeRate: 32 });
  });
});
