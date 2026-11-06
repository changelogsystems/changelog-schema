// lib/schema/importer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTable, normalizeImport } from './importer.mjs';
import { defaultConfig } from './config.mjs';
import { newEntry, contentHash } from './entries.mjs';
import { toEntriesTable, toEntryFile } from './exporter.mjs';

// ---- parseTable -----------------------------------------------------------------

test('parseTable reads the 7-col v1 table with the LEGACY `Job` header into structured rows (never raw text)', () => {
  const md = [
    '| Date | Job | Type | Status | Area of Work | Change | Reason |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| 2026-05-19 Tue 21:04 | 24-118 | RFI | Completed | North stair | Door swing | Egress |',
  ].join('\n');
  assert.deepEqual(parseTable(md), [
    { date: '2026-05-19 Tue 21:04', job: '24-118', type: 'RFI', status: 'Completed', area: 'North stair', change: 'Door swing', reason: 'Egress' },
  ]);
});

test('parseTable reads the 6-col legacy table (no Type column, legacy `Job` header, #-prefixed status)', () => {
  const md = [
    '| Date | Job | Status | Area of Work | Change | Reason |',
    '| --- | --- | --- | --- | --- | --- |',
    '| 2026-05-01 Fri 09:00 | 23-900 | #completed | PM | Closed out | done |',
  ].join('\n');
  assert.deepEqual(parseTable(md), [
    { date: '2026-05-01 Fri 09:00', job: '23-900', type: '', status: '#completed', area: 'PM', change: 'Closed out', reason: 'done' },
  ]);
});

test('parseTable ignores prose before and after the table, and the rule row', () => {
  const md = [
    'Here is my changelog paste:',
    '',
    '| Date | Job | Type | Status | Area of Work | Change | Reason |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| D | J | Task | Current | A | c | r |',
    '',
    'Thanks!',
  ].join('\n');
  const rows = parseTable(md);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, 'Current');
});

test('parseTable unescapes escaped pipes and maps columns by header name (order-tolerant)', () => {
  const md = [
    '| Job | Date | Status | Change | Reason | Area of Work | Type |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| J | D | Current | a \\| b | r | A | Task |',
  ].join('\n');
  assert.deepEqual(parseTable(md), [
    { date: 'D', job: 'J', type: 'Task', status: 'Current', area: 'A', change: 'a | b', reason: 'r' },
  ]);
});

test('parseTable returns [] when there is no table', () => {
  assert.deepEqual(parseTable('just some notes, no table here'), []);
});

// ---- normalizeImport ------------------------------------------------------------

test('normalizeImport resolves labels to ids and builds fresh entries (empty store)', () => {
  const cfg = defaultConfig();
  const rows = [{ date: 'D', job: 'J', type: 'RFI', status: 'Completed', area: 'North stair', change: 'c', reason: 'r' }];
  const { entries, quarantine } = normalizeImport(rows, cfg, []);
  assert.equal(quarantine.length, 0);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].category, 'completed'); // Status label → id
  assert.equal(entries[0].type, 'rfi');           // Type label → id
  assert.equal(entries[0].who, 'North stair');    // freeform area → verbatim
  assert.equal(entries[0].supersedes, '');
  assert.ok(entries[0].id && !/\s/.test(entries[0].id)); // fresh global id assigned
});

test('normalizeImport quarantines unknown statuses/types and mints ZERO new chips', () => {
  // Type quarantine is a MANAGED-mode rule; the default is 'off' since 2026-10-02.
  const cfg = { ...defaultConfig(), types: { ...defaultConfig().types, mode: 'managed' } };
  const before = JSON.stringify(cfg);
  const rows = [
    { date: 'D1', job: 'J', type: '', status: '#To-Do', area: 'A', change: 'a', reason: '' },        // known → to-do
    { date: 'D2', job: 'J', type: '', status: '#completed', area: 'A', change: 'b', reason: '' },      // known → completed
    { date: 'D3', job: 'J', type: '', status: '#scope-change', area: 'A', change: 'c', reason: '' },   // demoted → quarantine
    { date: 'D4', job: 'J', type: 'Widget', status: 'Current', area: 'A', change: 'd', reason: '' },   // unknown type → quarantine
  ];
  const { entries, quarantine } = normalizeImport(rows, cfg, []);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((e) => e.category).sort(), ['completed', 'to-do']);
  assert.equal(quarantine.length, 2);
  assert.equal(quarantine.find((q) => q.reason === 'status').row.change, 'c');
  assert.equal(quarantine.find((q) => q.reason === 'type').row.change, 'd');
  assert.equal(JSON.stringify(cfg), before); // config untouched — no auto-mint
});

test('normalizeImport is idempotent against the existing store (content-hash dedup)', () => {
  const cfg = defaultConfig();
  const existing = [
    newEntry({ date: 'D', job: 'J', status: 'completed', area: 'North stair', type: 'rfi', change: 'c', reason: 'r' }),
  ];
  const rows = parseTable(toEntriesTable(existing, cfg)); // export → reparse
  const { entries, quarantine, merged } = normalizeImport(rows, cfg, existing);
  assert.equal(entries.length, 0);    // nothing new — already present
  assert.equal(quarantine.length, 0);
  assert.equal(merged.length, 1);     // recognised as a duplicate of the stored head
});

test('normalizeImport dedups identical rows within a single paste', () => {
  const cfg = defaultConfig();
  const row = { date: 'D', job: 'J', type: 'Task', status: 'Current', area: 'A', change: 'c', reason: 'r' };
  const { entries, merged } = normalizeImport([row, { ...row }], cfg, []);
  assert.equal(entries.length, 1);
  assert.equal(merged.length, 1);
});

test('normalizeImport assigns an id to a hand-authored row and dedups the re-import', () => {
  const cfg = defaultConfig();
  const rows = [{ date: 'D', job: 'J', type: 'Task', status: 'To-Do', area: 'A', change: 'hand', reason: 'authored' }];
  const first = normalizeImport(rows, cfg, []);
  assert.equal(first.entries.length, 1);
  assert.ok(first.entries[0].id);
  const second = normalizeImport(rows, cfg, first.entries); // re-import against what we just added
  assert.equal(second.entries.length, 0);
  assert.equal(second.merged.length, 1);
});

test('round-trip: a full exported FILE (frontmatter + table) re-imports clean (accept. test 12)', () => {
  const cfg = defaultConfig();
  const store = [
    newEntry({ date: '2026-05-19 Tue 21:04', job: '24-118', status: 'completed', area: 'North stair', type: 'rfi', change: 'Door swing', reason: 'Egress' }),
    newEntry({ date: '2026-05-20 Wed 08:15', job: '24-200', status: 'on-hold', area: 'Lobby', type: 'submittal', change: 'Panel layout', reason: 'a | b piped' }),
  ];
  const file = toEntryFile(store, cfg);          // frontmatter + 7-col table
  const rows = parseTable(file);                  // frontmatter skipped, table parsed
  assert.equal(rows.length, 2);
  const { entries, quarantine, merged } = normalizeImport(rows, cfg, store);
  assert.equal(entries.length, 0);               // idempotent — nothing new
  assert.equal(quarantine.length, 0);
  assert.equal(merged.length, 2);                // both recognised as duplicates
});

test('normalizeImport applies reconcile overrides (map an unmatched token to a managed id)', () => {
  // Type quarantine is a MANAGED-mode rule; the default is 'off' since 2026-10-02.
  const cfg = { ...defaultConfig(), types: { ...defaultConfig().types, mode: 'managed' } };
  const rows = [
    { date: 'D1', job: 'J', type: '', status: '#scope-change', area: 'A', change: 'a', reason: '' }, // unmatched status
    { date: 'D2', job: 'J', type: 'Widget', status: 'Current', area: 'A', change: 'b', reason: '' }, // unmatched type
  ];
  // baseline: both quarantine
  assert.equal(normalizeImport(rows, cfg, []).quarantine.length, 2);
  // with the admin's reconcile choices, both resolve and import
  const overrides = { status: { '#scope-change': 'on-hold' }, type: { Widget: 'task' } };
  const { entries, quarantine } = normalizeImport(rows, cfg, [], overrides);
  assert.equal(quarantine.length, 0);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].category, 'on-hold'); // mapped token → chosen id
  assert.equal(entries[1].type, 'task');
});

test('normalizeImport: managed area normalizes/quarantines; freeform accepts as-is', () => {
  const managed = { ...defaultConfig(), areas: { mode: 'managed', set: [{ id: 'lobby', label: 'Lobby', color: '#58a6ff' }] } };
  const rows = [
    { date: 'D1', job: 'J', type: '', status: 'Current', area: 'Lobby', change: 'a', reason: '' },   // known area
    { date: 'D2', job: 'J', type: '', status: 'Current', area: 'Roof', change: 'b', reason: '' },     // unknown area → quarantine
  ];
  const { entries, quarantine } = normalizeImport(rows, managed, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].who, 'lobby');           // normalized to the managed id
  assert.equal(quarantine.length, 1);
  assert.equal(quarantine[0].reason, 'area');
});

// 2026-10-01: the exporter writes `Project`; every file written before
// says `Job`. Both import, forever, and the exporter's own output round-trips.
test('parseTable reads the `Project` header exactly as it reads the legacy `Job` header', () => {
  const rows = (h) => parseTable([
    `| Date | ${h} | Type | Status | Area of Work | Change | Reason |`,
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| 2026-05-19 Tue 21:04 | 24-118 | RFI | Completed | North stair | Door swing | Egress |',
  ].join('\n'));
  const expected = [{ date: '2026-05-19 Tue 21:04', job: '24-118', type: 'RFI', status: 'Completed', area: 'North stair', change: 'Door swing', reason: 'Egress' }];
  assert.deepEqual(rows('Project'), expected);
  assert.deepEqual(rows('Job'), expected);      // legacy
  assert.deepEqual(rows('project'), expected);  // case-insensitive, like every other header
});

test('an export with the Project header round-trips through the importer', () => {
  const cfg = defaultConfig();
  const e = newEntry({ date: '2026-05-19 Tue 21:04', job: '24-118', status: 'current', area: 'Lobby', type: 'task', change: 'c', reason: 'r' });
  const table = toEntriesTable([e], cfg);
  assert.ok(table.startsWith('| Date | Project |'));
  const rows = parseTable(table);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].job, '24-118');
  const { entries } = normalizeImport(rows, cfg, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].job, '24-118');
  assert.equal(entries[0].category, 'current');
});

// Since 2026-10-02 a fresh device is types 'off'. The server validates `type` whenever the
// axis is not freeform, so an import in 'off' quarantines an unknown token for the
// review step (as managed does) instead of storing what the server will reject. A
// token naming a member is stored as its ID.
test('normalizeImport with types off: a member token stores its id, an unknown one is quarantined', () => {
  const cfg = defaultConfig();
  assert.equal(cfg.types.mode, 'off');
  const rows = [
    { date: 'D1', job: 'J', type: 'RFI', status: 'Current', area: 'A', change: 'a', reason: '' },
    { date: 'D2', job: 'J', type: 'Site Walk', status: 'Current', area: 'A', change: 'b', reason: '' },
    { date: 'D3', job: 'J', type: '', status: 'Current', area: 'A', change: 'c', reason: '' },
  ];
  const { entries, quarantine } = normalizeImport(rows, cfg, []);
  assert.deepEqual(entries.map((e) => e.type), ['rfi', '']);
  assert.equal(quarantine.length, 1);
  assert.deepEqual([quarantine[0].reason, quarantine[0].token], ['type', 'Site Walk']);
  // …and the review step's "map to →" still rescues it.
  const mapped = normalizeImport(rows, cfg, [], { type: { 'Site Walk': 'task' } });
  assert.equal(mapped.quarantine.length, 0);
});

test('normalizeImport with types freeform: an unknown token is kept as typed, a member token stores its id', () => {
  const cfg = { ...defaultConfig(), types: { ...defaultConfig().types, mode: 'freeform' } };
  const rows = [
    { date: 'D1', job: 'J', type: 'RFI', status: 'Current', area: 'A', change: 'a', reason: '' },
    { date: 'D2', job: 'J', type: 'Site Walk', status: 'Current', area: 'A', change: 'b', reason: '' },
  ];
  const { entries, quarantine } = normalizeImport(rows, cfg, []);
  assert.equal(quarantine.length, 0);
  assert.deepEqual(entries.map((e) => e.type), ['rfi', 'Site Walk']);
});
