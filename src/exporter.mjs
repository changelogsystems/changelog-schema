// lib/schema/exporter.mjs
// The export half of the interchange. Pure + Node-testable — POJO in,
// string out, zero React/AsyncStorage. Owns the canonical byte format so every reader and
// writer agrees on one table; ExportSheet renders whatever these produce.
//
// The table is the 7-col interchange contract — `| Date | Project | Type | Status | Area of
// Work | Change | Reason |`, Type in position 3 (the column was `Job` until 2026-10-01;
// the importer accepts both headers forever) — and Type/Status/Area render as the
// configured LABELS (not stored ids), so the table reads as people wrote it. Label
// resolution is lossless: `resolveVocabId` matches a label-slug back to its id, so a
// re-import recovers the same id. An unresolvable token (a legacy `#tag`, a deleted
// vocab member, a freeform area) passes through verbatim so old rows still render, and
// an empty type emits an empty cell with the row kept.
import { labelFor } from './config.mjs';

// Table-safety only: collapse newlines and escape literal pipes so a cell can't break
// the Markdown table. Plain TEXT, never HTML — no markup to inject. The escaping matches
// the earlier `toMarkdown` byte-for-byte, so the format an existing log was written
// with is unchanged.
function cell(value) {
  return String(value == null ? '' : value)
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|');
}

const HEADER = '| Date | Project | Type | Status | Area of Work | Change | Reason |';
const RULE = '| --- | --- | --- | --- | --- | --- | --- |';

// The 7-col entries table. `entries` are stored-shape rows ({date, job, category, who,
// type, ...}); this resolves category→Status label, who→Area label, type→Type label.
export function toEntriesTable(entries, config) {
  const body = (entries || []).map((e) =>
    `| ${cell(e.date)} | ${cell(e.job)} | ${cell(labelFor(config, 'type', e.type))} | `
    + `${cell(labelFor(config, 'status', e.category))} | ${cell(labelFor(config, 'area', e.who))} | `
    + `${cell(e.change)} | ${cell(e.reason)} |`
  );
  return [HEADER, RULE, ...body].join('\n');
}

// ── CSV ──────────────────────────────────────────────────────────────────────
// The same seven columns, same order, same label resolution, as a spreadsheet file.
// This is the export for the person whose office is Excel or QuickBooks rather than
// Obsidian (the residential owner-operator), and it is deliberately NOT a second
// data model: one table, two serializations. It is one-way — the importer reads
// Markdown, and a CSV round-trip is not promised.
//
// RFC 4180: fields are quoted when they hold a comma, a double quote or a line
// break; a quote inside a field doubles. Line breaks inside a field are KEPT
// (quoted), unlike the Markdown table, which has to collapse them — a spreadsheet
// cell can hold a paragraph and the Change/Reason text is the record. Records end
// in CRLF, which every spreadsheet reads and the RFC specifies.
//
// Formula neutralisation: a spreadsheet executes a cell that begins with `=`, `+`,
// `-` or `@` (and some treat a leading tab or CR the same). A jobsite note that
// starts "-2 days on the panel" is plausible; a pasted "=HYPERLINK(...)" is the
// attack. Such a cell gets a leading apostrophe, which Excel, Sheets, Numbers and
// LibreOffice all read as "this is text" and do not display. The stored entry is
// untouched — this is a property of the file, not of the record — and the
// Markdown export, which no spreadsheet executes, is unchanged.
const CSV_HEADER = ['Date', 'Project', 'Type', 'Status', 'Area of Work', 'Change', 'Reason'];
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function csvField(value) {
  let text = String(value == null ? '' : value);
  if (FORMULA_LEAD.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// The 7-col table as CSV text (no BOM — the caller decides; see ExportSheet).
export function toEntriesCsv(entries, config) {
  const rows = (entries || []).map((e) => [
    e.date, e.job,
    labelFor(config, 'type', e.type),
    labelFor(config, 'status', e.category),
    labelFor(config, 'area', e.who),
    e.change, e.reason,
  ].map(csvField).join(','));
  return [CSV_HEADER.join(','), ...rows].map((line) => `${line}\r\n`).join('');
}

// One managed vocabulary member as an inline YAML map. Colors are quoted (a leading '#'
// starts a YAML comment otherwise). Statuses carry `closes`; types/areas do not.
function memberYaml(v, withCloses) {
  const parts = [`id: ${v.id}`, `label: ${v.label}`, `color: "${v.color}"`];
  if (withCloses) parts.push(`closes: ${!!v.closes}`);
  return `  - { ${parts.join(', ')} }`;
}

// The config zone as YAML — shared by the authoritative `_changelog-config.md` and the
// embedded snapshot inside each entry file. Emitted WITHOUT the outer `---` fences so a
// caller can place it as a standalone file body or as a file's frontmatter.
function configYaml(config) {
  const c = config || {};
  const lines = [];
  lines.push(`schema: ${c.schema || 'changelog/v1'}`);
  lines.push(`tenant: ${c.tenant || 'local'}`);
  if (c.completeTarget) lines.push(`completeTarget: ${c.completeTarget}`);
  lines.push('statuses:');
  for (const s of c.statuses || []) lines.push(memberYaml(s, true));
  lines.push('areas:');
  lines.push(`  mode: ${c.areas?.mode || 'freeform'}`);
  if ((c.areas?.set || []).length) {
    lines.push('  set:');
    for (const a of c.areas.set) lines.push(`  ${memberYaml(a, false)}`);
  } else {
    lines.push('  set: []');
  }
  lines.push('types:');
  lines.push(`  mode: ${c.types?.mode || 'off'}`);
  if ((c.types?.set || []).length) {
    lines.push('  set:');
    for (const t of c.types.set) lines.push(`  ${memberYaml(t, false)}`);
  } else {
    lines.push('  set: []');
  }
  return lines.join('\n');
}

// The authoritative config file (`_changelog-config.md`) — the config zone as a fenced
// YAML frontmatter block.
export function toConfigMarkdown(config) {
  return `---\n${configYaml(config)}\n---\n`;
}

// A self-describing entry file: the config zone embedded in frontmatter (portability —
// one file fully describes its own vocabulary) followed by the entries table. Whole-log
// when `job` is omitted; per-job when given.
export function toEntryFile(entries, config, { job } = {}) {
  const scope = job ? (entries || []).filter((e) => e.job === job) : (entries || []);
  return `---\n${configYaml(config)}\n---\n\n${toEntriesTable(scope, config)}\n`;
}
