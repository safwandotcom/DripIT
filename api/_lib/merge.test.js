import { describe, it, expect } from 'vitest';
import { upsertById, removeById } from './merge.js';

describe('upsertById', () => {
  it('prepends a genuinely new item ahead of existing ones', () => {
    const existing = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }];
    const incoming = [{ id: 'c', v: 3 }];
    expect(upsertById(existing, incoming)).toEqual([
      { id: 'c', v: 3 }, { id: 'a', v: 1 }, { id: 'b', v: 2 }
    ]);
  });

  it('replaces a matching item in place without moving it', () => {
    const existing = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }];
    const incoming = [{ id: 'a', v: 99 }];
    expect(upsertById(existing, incoming)).toEqual([
      { id: 'a', v: 99 }, { id: 'b', v: 2 }
    ]);
  });

  it('handles a mix of one new and one updated item in a single call', () => {
    const existing = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }];
    const incoming = [{ id: 'b', v: 22 }, { id: 'c', v: 3 }];
    expect(upsertById(existing, incoming)).toEqual([
      { id: 'c', v: 3 }, { id: 'a', v: 1 }, { id: 'b', v: 22 }
    ]);
  });

  it('returns the existing array unchanged when incoming is empty', () => {
    const existing = [{ id: 'a', v: 1 }];
    expect(upsertById(existing, [])).toEqual([{ id: 'a', v: 1 }]);
  });

  it('starts from an empty existing array', () => {
    const incoming = [{ id: 'a', v: 1 }, { id: 'b', v: 2 }];
    expect(upsertById([], incoming)).toEqual([{ id: 'a', v: 1 }, { id: 'b', v: 2 }]);
  });
});

describe('removeById', () => {
  it('removes the matching item', () => {
    const existing = [{ id: 'a' }, { id: 'b' }];
    expect(removeById(existing, 'a')).toEqual([{ id: 'b' }]);
  });

  it('is a no-op when the id is not present', () => {
    const existing = [{ id: 'a' }];
    expect(removeById(existing, 'z')).toEqual([{ id: 'a' }]);
  });
});
