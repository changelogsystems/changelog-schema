import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFrontmatter, parseConfigMarkdown, resolveConfig } from './config-md.mjs';
import { defaultConfig } from './config.mjs';
import { newEntry } from './entries.mjs';
import { toConfigMarkdown, toEntryFile } from './exporter.mjs';

test('parseConfigMarkdown round-trips the SDK\'s own toConfigMarkdown', () => {
  const src = defaultConfig();
  const parsed = parseConfigMarkdown(toConfigMarkdown(src));
  assert.equal(parsed.schema, src.schema);
  assert.equal(parsed.tenant, src.tenant);
  assert.equal(parsed.completeTarget, src.completeTarget);
  assert.deepEqual(parsed.statuses, src.statuses);
  assert.deepEqual(parsed.types.set, src.types.set);
  // The shipped default, whatever it is ('off' since 2026-10-02; it was 'managed').
  assert.equal(parsed.types.mode, src.types.mode);
  assert.equal(parsed.areas.mode, 'freeform');
  assert.deepEqual(parsed.areas.set, []);
});

test('closes survives the round-trip as a real boolean on exactly the terminal statuses', () => {
  const parsed = parseConfigMarkdown(toConfigMarkdown(defaultConfig()));
  const closing = parsed.statuses.filter((s) => s.closes).map((s) => s.id);
  assert.deepEqual(closing, ['completed', 'cancelled']);
  for (const s of parsed.statuses) assert.equal(typeof s.closes, 'boolean');
});

test('a populated areas set round-trips at its deeper indent', () => {
  const src = { ...defaultConfig(), areas: { mode: 'managed', set: [
    { id: 'drafting', label: 'drafting', color: '#39c5cf' },
    { id: 'shop', label: 'shop', color: '#3fb950' },
  ] } };
  const parsed = parseConfigMarkdown(toConfigMarkdown(src));
  assert.equal(parsed.areas.mode, 'managed');
  assert.deepEqual(parsed.areas.set, src.areas.set);
});

test('a label containing a comma is not split into two fields', () => {
  const src = { ...defaultConfig(), types: { mode: 'managed', set: [
    { id: 'rfi', label: 'RFI, formal', color: '#d29922' },
  ] } };
  const parsed = parseConfigMarkdown(toConfigMarkdown(src));
  assert.deepEqual(parsed.types.set, [{ id: 'rfi', label: 'RFI, formal', color: '#d29922' }]);
});

test('the embedded snapshot inside a self-describing entry file parses, table and all', () => {
  const config = defaultConfig();
  const file = toEntryFile([newEntry({ job: 'J1', status: 'current', type: 'task' })], config);
  const parsed = parseConfigMarkdown(file);
  assert.deepEqual(parsed.statuses, config.statuses);
  assert.equal(extractFrontmatter(file).includes('| Date |'), false);   // table stayed out of the block
});

test('a file with no frontmatter, or frontmatter with no statuses, parses to null', () => {
  assert.equal(parseConfigMarkdown('# just a note\n\ntext\n'), null);
  assert.equal(parseConfigMarkdown('---\ntags:\n  - changelog\n---\n\n# CHANGELOG\n'), null);
  assert.equal(extractFrontmatter('no fences here'), null);
});

test('resolveConfig order: config file wins over the embedded snapshot', () => {
  const fileConfig = { ...defaultConfig(), tenant: 'from-file' };
  const embedded = toConfigMarkdown({ ...defaultConfig(), tenant: 'from-embedded' });
  const r = resolveConfig({ configMd: toConfigMarkdown(fileConfig), embeddedMd: embedded });
  assert.equal(r.source, 'config-file');
  assert.equal(r.config.tenant, 'from-file');
});

test('resolveConfig order: the embedded snapshot wins over the defaults', () => {
  const r = resolveConfig({ configMd: null, embeddedMd: toConfigMarkdown({ ...defaultConfig(), tenant: 'from-embedded' }) });
  assert.equal(r.source, 'embedded');
  assert.equal(r.config.tenant, 'from-embedded');
});

test('resolveConfig order: an unparseable config file falls through, it does not throw', () => {
  const r = resolveConfig({ configMd: '# not a config\n', embeddedMd: null });
  assert.equal(r.source, 'defaults');
  assert.deepEqual(r.config.statuses, defaultConfig().statuses);
});

test('resolveConfig normalizes through the SDK — a partial config gets completeTarget back', () => {
  const partial = '---\nschema: changelog/v1\nstatuses:\n  - { id: open, label: Open, color: "#58a6ff", closes: false }\n  - { id: shut, label: Shut, color: "#3fb950", closes: true }\n---\n';
  const r = resolveConfig({ configMd: partial });
  assert.equal(r.source, 'config-file');
  assert.equal(r.config.completeTarget, 'shut');
  assert.equal(r.config.areasSeeded, true);
});
