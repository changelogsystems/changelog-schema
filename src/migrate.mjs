// lib/schema/migrate.mjs
// One-time, idempotent migration of pre-v1 on-device data. Legacy entries
// are all chain heads (pre-v1 had no supersede), so supersedes stays ''. Stored status
// values are NEVER rewritten here — retroactive normalization is a quarantine step,
// handled on import, not on migration.
import { isGlobalId, makeId } from './ids.mjs';
import { defaultConfig, slugId } from './config.mjs';

export function migrateEntries(entries = []) {
  let changed = false;
  const out = entries.map((e) => {
    const needsId = !isGlobalId(e.id);
    const id = needsId ? makeId() : e.id;
    const supersedes = e.supersedes || '';
    const by = e.by || 'owner';
    const type = e.type || '';
    if (needsId || e.supersedes === undefined || e.by === undefined || e.type === undefined) {
      changed = true;
    }
    return { ...e, id, supersedes, by, type };
  });
  return { entries: out, changed };
}

// The pre-light-mode default colour of the Current status was Tailwind blue-500,
// `#3b82f6` — the one value in the stored data that is on no palette the app
// owns (VOCAB_PALETTE's blue is `#58a6ff`, and CAT_COLOR.current already said so),
// so "current" was two blues depending on the path. It is a DEFAULT, not a user's
// choice: the picker offers only the eight palette hues, so no one can have chosen
// it. This rewrites it to the palette blue wherever a status or type carries it.
// Idempotent; every other stored colour is untouched (2026-10-01).
// Reversible by dropping this commit: the light-mode hue map still carries
// `#3b82f6` so an unmigrated row renders correctly in both themes either way.
const LEGACY_CURRENT_BLUE = '#3b82f6';
const PALETTE_BLUE = '#58a6ff';

export function migrateVocabColors(config) {
  if (!config) return { config, changed: false };
  let changed = false;
  const fix = (v) => {
    if (v && typeof v.color === 'string' && v.color.toLowerCase() === LEGACY_CURRENT_BLUE) {
      changed = true;
      return { ...v, color: PALETTE_BLUE };
    }
    return v;
  };
  const statuses = (config.statuses || []).map(fix);
  const typeSet = (config.types?.set || []).map(fix);
  if (!changed) return { config, changed: false };
  return {
    config: {
      ...config,
      statuses,
      types: config.types ? { ...config.types, set: typeSet } : config.types,
    },
    changed: true,
  };
}

// Pre-v1 interim default status slugs. Demoted members (scope-change, interruption,
// idea, start, delayed, blocked) are NOT statuses in v1 → not re-added.
const OLD_DEFAULT_SLUGS = new Set([
  'start', 'current', 'delayed', 'blocked', 'scope-change', 'interruption', 'completed', 'idea',
]);

export function buildConfig(storedStatusChips = []) {
  const config = defaultConfig();
  // buildConfig is BY DEFINITION the legacy-seed path: ChangelogContext only calls it
  // when this device has no `changelogConfig` yet, which means it's a pre-v1 install —
  // exactly the device that may still have a legacy `areaChips` array waiting to be
  // folded in by migrateConfig. defaultConfig()'s `areasSeeded: true` is only correct
  // for a config with genuinely nothing to fold (a fresh install); here there IS a
  // legacy seed, so the fold must be allowed to run. Do not drop this — without it,
  // migrateConfig's `if (!areasSeeded)` guard never fires on this path and every
  // pre-v1 device's saved areas are silently discarded on upgrade.
  config.areasSeeded = false;
  const known = new Set(config.statuses.map((s) => s.id));
  for (const chip of storedStatusChips) {
    const label = String(chip?.name || '').replace(/^#/, '').trim();
    const id = slugId(label);
    if (!id || known.has(id) || OLD_DEFAULT_SLUGS.has(id)) continue;
    config.statuses.push({ id, label, color: chip.color || '#8b949e', closes: false });
    known.add(id);
  }
  return config;
}
