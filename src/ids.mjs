// lib/schema/ids.mjs
// Globally-unique opaque id for a changelog entry. Global-uniqueness (not just
// per-device) is the cheap insurance that keeps cross-subscription linking possible. Prefer the platform UUID; fall back to a time+random
// token where crypto.randomUUID is unavailable (older Hermes).
export function makeId() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand()}-${rand()}`;
}

// Discriminates a v1 global id from a pre-v1 timestamp id. Legacy ids are entry
// timestamps ("YYYY-MM-DD ddd HH:mm", optionally " (n)") and ALWAYS contain spaces;
// global ids never do. Migration uses this to decide which entries need a new id.
export function isGlobalId(x) {
  return typeof x === 'string' && x.length > 0 && !/\s/.test(x);
}
