// lib/schema/config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  defaultConfig, slugId, statusById, statusSlug, resolveStatusId, closesFor,
  VOCAB_PALETTE, nextVocabColor, migrateConfig,
  vocabSet, resolveVocabId, labelFor, completeTargetStatus, isCompleteTarget, legacyDefaultConfigs,
} from './config.mjs';

test('defaultConfig ships the locked v1 sets', () => {
  const c = defaultConfig();
  assert.equal(c.schema, 'changelog/v1');
  assert.deepEqual(c.statuses.map((s) => s.id), ['to-do', 'current', 'on-hold', 'completed', 'cancelled']);
  assert.equal(c.statuses.find((s) => s.id === 'completed').closes, true);
  assert.equal(c.statuses.find((s) => s.id === 'cancelled').closes, true);
  assert.equal(c.statuses.find((s) => s.id === 'current').closes, false);
  assert.equal(c.areas.mode, 'freeform');
  assert.deepEqual(c.areas.set, []);
  assert.equal(c.areasSeeded, true); // migrateConfig's fold-once flag — must be exactly true
  assert.equal(c.types.mode, 'off'); // off by default since 2026-10-02; the set below stays seeded
});

// ── type axis off by default (2026-10-02), without touching any stored config ──────────
test('fresh install: types off, the construction set still seeded', () => {
  const c = defaultConfig();
  assert.equal(c.types.mode, 'off');
  assert.ok(c.types.set.length >= 6);
  assert.deepEqual(migrateConfig(null).config.types, c.types);   // no stored config at all
});

test('an existing managed config is untouched (mode, set and all)', () => {
  const stored = { ...defaultConfig(), types: { mode: 'managed', set: [{ id: 'punch', label: 'Punch', color: '#39c5cf' }] } };
  const { config, changed } = migrateConfig(stored);
  assert.deepEqual(config.types, stored.types);
  assert.equal(changed, false);
  // …and so is a stored 'off' or 'freeform'
  for (const mode of ['off', 'freeform']) {
    const s = { ...defaultConfig(), types: { mode, set: [] } };
    assert.deepEqual(migrateConfig(s).config.types, s.types);
  }
});

test('a legacy doc with NO types key reads as a fresh install: off, set seeded', () => {
  const legacy = { ...defaultConfig() };
  delete legacy.types;
  const { config } = migrateConfig(legacy);
  assert.deepEqual(config.types, defaultConfig().types);
  assert.equal(config.types.mode, 'off');
});

test('the old default is listed as a legacy default (managed), the new one is not', () => {
  const [old] = legacyDefaultConfigs();
  assert.equal(old.types.mode, 'managed');
  assert.deepEqual(old.types.set, defaultConfig().types.set);
});

test('defaultConfig types are {id,label,color} objects, Task first', () => {
  const c = defaultConfig();
  assert.deepEqual(c.types.set.map((t) => t.id),
    ['task', 'submittal', 'rfi', 'material', 'field-dim', 'conflict']);
  assert.equal(c.types.set[0].label, 'Task');
  assert.ok(c.types.set.every((t) => VOCAB_PALETTE.includes(t.color)));
});

test('defaultConfig names an explicit completeTarget that closes', () => {
  const c = defaultConfig();
  assert.equal(c.completeTarget, 'completed');
  assert.equal(statusById(c, c.completeTarget).closes, true);
});

test('nextVocabColor picks the first unused hue, then cycles', () => {
  assert.equal(nextVocabColor([]), VOCAB_PALETTE[0]);
  assert.equal(nextVocabColor([VOCAB_PALETTE[0]]), VOCAB_PALETTE[1]);
  assert.equal(nextVocabColor(VOCAB_PALETTE), VOCAB_PALETTE[0]); // 8 used → wraps
});

test('slugId derives a stable kebab id from a label', () => {
  assert.equal(slugId('On Hold'), 'on-hold');
  assert.equal(slugId('Field-Dim'), 'field-dim');
  assert.equal(slugId('  RFI  '), 'rfi');
  assert.equal(slugId('#completed'), 'completed'); // strips non-alnum
});

test('resolveStatusId matches by id and by label, quarantines the rest', () => {
  const c = defaultConfig();
  assert.equal(resolveStatusId(c, 'On Hold'), 'on-hold');
  assert.equal(resolveStatusId(c, '#completed'), 'completed');
  assert.equal(resolveStatusId(c, 'current'), 'current');
  assert.equal(resolveStatusId(c, '#scope-change'), null); // demoted → quarantine
  assert.equal(resolveStatusId(c, 'garbage'), null);
});

test('closesFor honors the managed set and falls back to terminal words for legacy tokens', () => {
  const c = defaultConfig();
  assert.equal(closesFor(c, 'completed'), true);
  assert.equal(closesFor(c, 'cancelled'), true);
  assert.equal(closesFor(c, 'current'), false);
  assert.equal(closesFor(c, '#completed'), true);   // legacy '#completed' stays closed
  assert.equal(closesFor(c, '#scope-change'), false); // unknown/legacy → open, never rewritten
});

test('statusById / statusSlug', () => {
  const c = defaultConfig();
  assert.equal(statusById(c, 'to-do').label, 'To-Do');
  assert.equal(statusById(c, 'nope'), undefined);
  assert.equal(statusSlug('#On Hold'), 'on-hold');
});

test('migrateConfig promotes string sets to {id,label,color}', () => {
  const stored = {
    ...defaultConfig(),
    types: { mode: 'managed', set: ['Task', 'Field-Dim'] },
    areas: { mode: 'managed', set: ['North stair'] },
  };
  const { config, changed } = migrateConfig(stored);
  assert.equal(changed, true);
  assert.deepEqual(config.types.set.map((t) => t.id), ['task', 'field-dim']);
  assert.equal(config.types.set[1].label, 'Field-Dim');
  assert.ok(VOCAB_PALETTE.includes(config.types.set[0].color));
  assert.deepEqual(config.areas.set.map((a) => a.id), ['north-stair']);
  assert.equal(config.areas.set[0].label, 'North stair');
});

test('migrateConfig is idempotent', () => {
  const stored = { ...defaultConfig(), types: { mode: 'managed', set: ['Task'] } };
  const once = migrateConfig(stored).config;
  const { config: twice, changed } = migrateConfig(once);
  assert.equal(changed, false);
  assert.deepEqual(twice, once);
});

test('migrateConfig never reads or writes entries', () => {
  const stored = { ...defaultConfig(), entries: 'DO NOT TOUCH' };
  const { config } = migrateConfig(stored);
  assert.equal(config.entries, 'DO NOT TOUCH');
});

test('migrateConfig folds legacy areaChips exactly once', () => {
  const stored = { ...defaultConfig(), areasSeeded: undefined };
  const first = migrateConfig(stored, ['drafting', 'shop']);
  assert.equal(first.changed, true);
  assert.deepEqual(first.config.areas.set.map((a) => a.id), ['drafting', 'shop']);
  assert.equal(first.config.areasSeeded, true);

  // The user then deletes every area. A second migration must NOT resurrect them.
  const emptied = { ...first.config, areas: { ...first.config.areas, set: [] } };
  const second = migrateConfig(emptied, ['drafting', 'shop']);
  assert.deepEqual(second.config.areas.set, []);
  assert.equal(second.changed, false);
});

test('migrateConfig backfills completeTarget to the first closing status', () => {
  const stored = { ...defaultConfig(), completeTarget: undefined };
  const { config, changed } = migrateConfig(stored);
  assert.equal(changed, true);
  // Behavior-preserving: this is exactly what completeEntry scanned for before.
  assert.equal(config.completeTarget, 'completed');
});

test('migrateConfig leaves an existing completeTarget alone', () => {
  const stored = { ...defaultConfig(), completeTarget: 'cancelled' };
  assert.equal(migrateConfig(stored).config.completeTarget, 'cancelled');
});

test('labelFor resolves by id and by label-slug', () => {
  const c = defaultConfig();
  assert.equal(labelFor(c, 'status', 'on-hold'), 'On Hold');
  assert.equal(labelFor(c, 'status', 'On Hold'), 'On Hold');
  assert.equal(labelFor(c, 'type', 'field-dim'), 'Field-Dim');
  assert.equal(labelFor(c, 'type', 'rfi'), 'RFI');
});

test('labelFor renders a legacy #-tag through to its label', () => {
  const c = defaultConfig();
  // Once deferred as cosmetic: '#completed' now reads as 'Completed'.
  assert.equal(labelFor(c, 'status', '#completed'), 'Completed');
});

test('labelFor passes an unresolvable token through verbatim', () => {
  const c = defaultConfig();
  // A removed or never-known status must still render on old entries.
  assert.equal(labelFor(c, 'status', '#scope-change'), '#scope-change');
  assert.equal(labelFor(c, 'status', 'garbage'), 'garbage');
  assert.equal(labelFor(c, 'type', ''), '');
});

test('labelFor over a freeform area passes text through', () => {
  const c = defaultConfig(); // areas.set is empty
  assert.equal(labelFor(c, 'area', 'North stair'), 'North stair');
});

test('completeTargetStatus resolves the named target regardless of order', () => {
  const c = defaultConfig();
  // Put a DIFFERENT closing status first — the target must not move.
  c.statuses = [
    { id: 'cancelled', label: 'Cancelled', color: '#8b949e', closes: true },
    { id: 'completed', label: 'Completed', color: '#3fb950', closes: true },
  ];
  assert.equal(completeTargetStatus(c).id, 'completed');
});

test('completeTargetStatus falls back to the first closing status', () => {
  const c = { ...defaultConfig(), completeTarget: 'nonexistent' };
  assert.equal(completeTargetStatus(c).id, 'completed');
  const noTarget = { ...defaultConfig(), completeTarget: '' };
  assert.equal(completeTargetStatus(noTarget).id, 'completed');
});

test('completeTargetStatus ignores a target that no longer closes', () => {
  const c = defaultConfig();
  c.statuses = c.statuses.map((s) => (s.id === 'completed' ? { ...s, closes: false } : s));
  assert.equal(completeTargetStatus(c).id, 'cancelled'); // falls back to a real terminal
});

test('completeTargetStatus returns null when nothing closes', () => {
  const c = { ...defaultConfig(), statuses: [{ id: 'a', label: 'A', color: '#fff', closes: false }] };
  assert.equal(completeTargetStatus(c), null);
});

test('isCompleteTarget guards removal and un-closing', () => {
  const c = defaultConfig();
  assert.equal(isCompleteTarget(c, 'completed'), true);
  assert.equal(isCompleteTarget(c, 'cancelled'), false);
  assert.equal(isCompleteTarget(c, 'current'), false);
});

// This fallback is inert under the default config; it matters once a tenant renames
// or removes a status, which is what this test does.
test('closesFor TERMINAL_WORDS fallback survives a renamed or removed status', () => {
  const c = defaultConfig();
  // Tenant renames Completed → "Closed Out". The id is frozen, so entries still resolve.
  c.statuses = c.statuses.map((s) => (s.id === 'completed' ? { ...s, label: 'Closed Out' } : s));
  assert.equal(closesFor(c, 'completed'), true);

  // Tenant REMOVES the completed status entirely. Old entries still store 'completed';
  // the terminal-word fallback keeps them closed rather than resurrecting them into Active.
  c.statuses = c.statuses.filter((s) => s.id !== 'completed');
  assert.equal(closesFor(c, 'completed'), true);
  assert.equal(closesFor(c, '#completed'), true);
  assert.equal(closesFor(c, 'current'), false);
});
