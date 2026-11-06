// lib/schema/migrate.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateEntries, buildConfig, migrateVocabColors } from './migrate.mjs';
import { isGlobalId } from './ids.mjs';
import { migrateConfig, VOCAB_PALETTE } from './config.mjs';

test('migrateEntries assigns v1 fields to a legacy entry and is idempotent', () => {
  const legacy = [{ id: '2026-05-19 Tue 21:04', date: '2026-05-19 Tue 21:04', job: 'J', category: '#completed', who: 'PM', change: 'c', reason: 'r' }];
  const first = migrateEntries(legacy);
  assert.equal(first.changed, true);
  const e = first.entries[0];
  assert.ok(isGlobalId(e.id));         // reassigned (legacy id had spaces)
  assert.equal(e.supersedes, '');
  assert.equal(e.by, 'owner');
  assert.equal(e.type, '');
  assert.equal(e.category, '#completed'); // stored value NOT rewritten
  assert.equal(e.job, 'J');

  const second = migrateEntries(first.entries);
  assert.equal(second.changed, false);   // idempotent
  assert.deepEqual(second.entries, first.entries);
});

test('migrateEntries preserves an already-global id', () => {
  const already = [{ id: 'abc-123-def', supersedes: '', by: 'owner', type: '', date: 'D', job: 'J', category: 'current', who: 'A', change: 'c', reason: 'r' }];
  const { entries, changed } = migrateEntries(already);
  assert.equal(changed, false);
  assert.equal(entries[0].id, 'abc-123-def');
});

test('buildConfig returns the v1 default and drops demoted pre-v1 statuses', () => {
  const chips = [
    { name: '#completed', color: '#3fb950' }, // in v1 already
    { name: '#scope-change', color: '#39c5cf' }, // demoted → NOT re-added
    { name: '#blocked', color: '#f85149' },      // demoted → NOT re-added
    { name: '#urgent', color: '#ff0000' },       // genuinely custom → preserved
  ];
  const c = buildConfig(chips);
  const ids = c.statuses.map((s) => s.id);
  assert.deepEqual(ids.slice(0, 5), ['to-do', 'current', 'on-hold', 'completed', 'cancelled']);
  assert.ok(ids.includes('urgent'));
  assert.ok(!ids.includes('scope-change'));
  assert.ok(!ids.includes('blocked'));
});

// The REAL upgrade path: a pre-v1 device has `statusChips`/`areaChips` in AsyncStorage
// but no `changelogConfig` yet, so ChangelogContext's load effect seeds via
// `buildConfig(storedStatus)` (NOT `defaultConfig()`) before handing the result to
// `migrateConfig`. `buildConfig`'s output must therefore report `areasSeeded: false` —
// it is by definition a config built from legacy keys, so the area fold has not
// happened yet. This exercises that end-to-end, rather than hand-setting
// `areasSeeded: undefined` on a `defaultConfig()`-based input (which bypasses
// `buildConfig` and would not have caught the real bug).
test('the real upgrade path (buildConfig -> migrateConfig) folds legacy areaChips, does not drop them', () => {
  const legacyStatusChips = [
    { name: '#completed', color: '#3fb950' },
    { name: '#urgent', color: '#ff0000' },
  ];
  const seeded = buildConfig(legacyStatusChips);
  // buildConfig is the legacy-seed path — it must not claim the area fold already ran.
  assert.equal(seeded.areasSeeded, false);

  const { config, changed } = migrateConfig(seeded, ['Uptown', 'Downtown']);
  assert.equal(changed, true);
  assert.equal(config.areasSeeded, true);

  const areaIds = config.areas.set.map((a) => a.id);
  assert.ok(areaIds.includes('uptown'));
  assert.ok(areaIds.includes('downtown'));
  const uptown = config.areas.set.find((a) => a.id === 'uptown');
  const downtown = config.areas.set.find((a) => a.id === 'downtown');
  assert.equal(uptown.label, 'Uptown');
  assert.equal(downtown.label, 'Downtown');
  assert.ok(VOCAB_PALETTE.includes(uptown.color));
  assert.ok(VOCAB_PALETTE.includes(downtown.color));

  // A second run over the persisted result must not re-fold (no resurrection, no re-write).
  const second = migrateConfig(config, ['Uptown', 'Downtown']);
  assert.equal(second.changed, false);
  assert.deepEqual(second.config.areas.set, config.areas.set);
});

// Ruling 3 (2026-10-01): the off-palette default Current blue is rewritten to the
// palette blue, wherever a status or type carries it, and nothing else moves.
test('migrateVocabColors rewrites the legacy Current blue and is idempotent', () => {
  const config = {
    statuses: [
      { id: 'current', label: 'Current', color: '#3b82f6', closes: false },
      { id: 'on-hold', label: 'On Hold', color: '#d29922', closes: false },
    ],
    types: { mode: 'managed', set: [
      { id: 'blueish', label: 'Blueish', color: '#3B82F6' }, // case-insensitive
      { id: 'task', label: 'Task', color: '#bc8cff' },
    ] },
    areas: { mode: 'freeform', set: [] },
  };
  const first = migrateVocabColors(config);
  assert.equal(first.changed, true);
  assert.equal(first.config.statuses[0].color, '#58a6ff');
  assert.equal(first.config.statuses[1].color, '#d29922');   // untouched
  assert.equal(first.config.types.set[0].color, '#58a6ff');
  assert.equal(first.config.types.set[1].color, '#bc8cff');  // untouched
  assert.deepEqual(first.config.areas, config.areas);
  assert.equal(config.statuses[0].color, '#3b82f6');          // input not mutated

  const second = migrateVocabColors(first.config);
  assert.equal(second.changed, false);
  assert.equal(second.config, first.config);                  // same object when nothing changes
});

test('migrateVocabColors leaves a config with no legacy blue alone, and tolerates a missing types axis', () => {
  const config = { statuses: [{ id: 'x', label: 'X', color: '#58a6ff', closes: false }] };
  const r = migrateVocabColors(config);
  assert.equal(r.changed, false);
  assert.equal(r.config, config);
  assert.deepEqual(migrateVocabColors(null), { config: null, changed: false });
});

test('defaultConfig no longer ships the legacy blue, so a fresh install needs no rewrite', () => {
  const r = migrateVocabColors(buildConfig([]));
  assert.equal(r.changed, false);
});
