// Generic optimistic-concurrency compare-and-swap for a single Redis key.
// Used by both save and delete so two devices writing/deleting around the
// same time can never silently erase each other's change: a plain
// GET-then-SET (or GET-then-DEL) lets a second writer's write win over a
// first writer's change whenever their reads both happened before either
// wrote. This closes that race by re-checking, atomically inside a single
// Lua script, that the key's raw content is still exactly what was last
// read before writing — a single-key read has nothing else it could be
// inconsistent with, so this closes the gap structurally rather than
// narrowing it (an earlier version of this used a separate version-number
// key and had exactly that narrower-but-still-real gap).
const MAX_CAS_ATTEMPTS = 5;

const READ_SCRIPT = `return redis.call('GET', KEYS[1])`;

// The empty-string sentinel (ARGV[1] === '') means "I expected this key
// to not exist yet" — Redis GET on a missing key returns Lua `false`,
// which can't be sent back as an ARGV string, so '' stands in for it on
// the JS side while the script's own internal GET still sees real `false`.
const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if cur == ARGV[1] or (cur == false and ARGV[1] == '') then
  redis.call('SET', KEYS[1], ARGV[2])
  return 1
end
return 0
`;

export async function casUpdate(redis, key, computeNext, attempt = 0) {
  // @upstash/redis auto-deserializes JSON responses by default — for
  // .eval() exactly like .get() — so `existing` here is already the
  // parsed value (or null if the key doesn't exist), never a raw
  // string. Re-stringify it to reconstruct the exact raw string Lua's
  // own internal GET will compare byte-for-byte: this round-trips
  // deterministically because we're the only writer and always wrote
  // via JSON.stringify in the first place.
  const existing = await redis.eval(READ_SCRIPT, [key], []);
  const rawForCompare = existing === null ? '' : JSON.stringify(existing);
  const next = computeNext(existing);
  const nextRaw = JSON.stringify(next);
  const ok = await redis.eval(CAS_SCRIPT, [key], [rawForCompare, nextRaw]);
  if (ok === 1) return next;
  if (attempt >= MAX_CAS_ATTEMPTS - 1) {
    throw new Error(`Concurrent write conflict on ${key} after ${MAX_CAS_ATTEMPTS} attempts`);
  }
  return casUpdate(redis, key, computeNext, attempt + 1);
}
