// lib/schema/exporter.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toEntriesTable, toConfigMarkdown, toEntryFile, toEntriesCsv } from './exporter.mjs';
import { defaultConfig } from './config.mjs';
import { newEntry } from './entries.mjs';

const sample = () => [
  newEntry({ date: '2026-05-19 Tue 21:04', job: '24-118', status: 'completed', area: 'North stair', type: 'rfi', change: 'Door swing', reason: 'Egress' }),
  newEntry({ date: '2026-05-20 Wed 08:15', job: '24-200', status: 'current', area: 'Lobby', type: 'submittal', change: 'Panel layout', reason: 'Coordination' }),
];

test('toEntriesTable renders the 7-col table with labels (Type in position 3)', () => {
  const cfg = defaultConfig();
  const out = toEntriesTable([sample()[0]], cfg);
  assert.equal(out, [
    '| Date | Project | Type | Status | Area of Work | Change | Reason |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    '| 2026-05-19 Tue 21:04 | 24-118 | RFI | Completed | North stair | Door swing | Egress |',
  ].join('\n'));
});

test('toEntriesTable resolves ids to their configured LABELS', () => {
  const cfg = defaultConfig();
  const out = toEntriesTable(sample(), cfg);
  assert.ok(out.includes('| RFI | Completed |'));
  assert.ok(out.includes('| Submittal | Current |'));
});

test('toEntriesTable is table-safe: newlines collapse, pipes escape', () => {
  const cfg = defaultConfig();
  const e = newEntry({ date: 'D', job: 'J', status: 'current', area: 'A', type: 'task', change: 'line one\nline two', reason: 'a|b' });
  const out = toEntriesTable([e], cfg);
  assert.ok(out.includes('line one line two'));
  assert.ok(out.includes('a\\|b'));
});

test('toEntriesTable passes an unresolvable token through verbatim (legacy tag, empty type)', () => {
  const cfg = defaultConfig();
  const e = newEntry({ date: 'D', job: 'J', status: '#scope-change', area: 'A', type: '', change: 'c', reason: 'r' });
  const out = toEntriesTable([e], cfg);
  // legacy status unresolved → passthrough; empty type → empty cell, row kept
  assert.ok(out.includes('| D | J |  | #scope-change | A | c | r |'));
});

test('toConfigMarkdown emits the config zone as YAML frontmatter', () => {
  const md = toConfigMarkdown(defaultConfig());
  assert.ok(md.startsWith('---\n'));
  assert.ok(md.trimEnd().endsWith('---'));
  assert.ok(md.includes('schema: changelog/v1'));
  assert.ok(md.includes('tenant: local'));
  assert.ok(md.includes('id: to-do'));
  assert.ok(md.includes('label: Completed'));
  assert.ok(md.includes('closes: true'));
  assert.ok(md.includes('mode: freeform')); // areas
  assert.ok(md.includes('mode: off'));      // types (off by default since 2026-10-02)
  assert.ok(md.includes('id: rfi'));
});

test('toEntryFile embeds a config snapshot in frontmatter + the entries table (whole-log)', () => {
  const cfg = defaultConfig();
  const file = toEntryFile(sample(), cfg);
  assert.ok(file.includes('schema: changelog/v1'));                       // embedded config snapshot
  assert.ok(file.includes('| Date | Project | Type | Status | Area of Work | Change | Reason |'));
  assert.ok(file.includes('24-118'));
  assert.ok(file.includes('24-200'));
});

test('toEntryFile scoped to one job includes only that job', () => {
  const cfg = defaultConfig();
  const file = toEntryFile(sample(), cfg, { job: '24-118' });
  assert.ok(file.includes('24-118'));
  assert.ok(!file.includes('24-200'));
});

// ── CSV ─────────────────────────────────────────────────────────────────────

test('toEntriesCsv renders the same 7 columns with labels, CRLF records, no trailing blank', () => {
  const cfg = defaultConfig();
  const out = toEntriesCsv([sample()[0]], cfg);
  assert.equal(out,
    'Date,Project,Type,Status,Area of Work,Change,Reason\r\n'
    + '2026-05-19 Tue 21:04,24-118,RFI,Completed,North stair,Door swing,Egress\r\n');
});

test('toEntriesCsv quotes commas, doubles quotes, and KEEPS line breaks inside a field', () => {
  const cfg = defaultConfig();
  const e = newEntry({
    date: 'D', job: 'J', status: 'current', area: 'A, B', type: 'task',
    change: 'line one\nline two', reason: 'said "no"',
  });
  const out = toEntriesCsv([e], cfg);
  assert.ok(out.includes(',"A, B",'));
  assert.ok(out.includes(',"line one\nline two",'));
  assert.ok(out.includes(',"said ""no"""\r\n'));
});

test('toEntriesCsv neutralises a formula-leading cell with an apostrophe, and only those', () => {
  const cfg = defaultConfig();
  const rows = [
    newEntry({ date: 'D', job: 'J', status: 'current', area: 'A', type: 'task', change: '=HYPERLINK("x")', reason: '-2 days' }),
    newEntry({ date: 'D', job: 'J', status: 'current', area: 'A', type: 'task', change: '+1 panel', reason: '@site' }),
    newEntry({ date: 'D', job: 'J', status: 'current', area: 'A', type: 'task', change: 'plain', reason: 'a-b' }),
  ];
  const out = toEntriesCsv(rows, cfg);
  assert.ok(out.includes(`,"'=HYPERLINK(""x"")",'-2 days\r\n`));
  assert.ok(out.includes(",'+1 panel,'@site\r\n"));
  assert.ok(out.includes(',plain,a-b\r\n'));
});

test('toEntriesCsv passes unresolvable tokens through and keeps an empty type cell', () => {
  const cfg = defaultConfig();
  const e = newEntry({ date: 'D', job: 'J', status: '#scope-change', area: 'A', type: '', change: 'c', reason: 'r' });
  assert.equal(toEntriesCsv([e], cfg).split('\r\n')[1], 'D,J,,#scope-change,A,c,r');
  assert.equal(toEntriesCsv([], cfg), 'Date,Project,Type,Status,Area of Work,Change,Reason\r\n');
});
