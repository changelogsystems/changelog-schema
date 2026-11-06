// lib/schema/importer.mjs
// The import half of the interchange — where three paste bugs die:
// tables are PARSED (not dumped as raw text), unknown tokens are QUARANTINED (never
// auto-minted into new chips), and re-import is IDEMPOTENT (content-hash dedup, no
// duplicates). Pure + Node-testable — POJO in, POJO out, zero React/AsyncStorage.
import { resolveVocabId } from './config.mjs';
import { newEntry, contentHash } from './entries.mjs';

// Split a markdown table row into trimmed cell strings, honoring an escaped pipe (`\|`)
// as literal content rather than a cell boundary. Hand-rolled (no look-behind regex) so
// it runs identically under Node and Hermes.
function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cur += '\\|'; i++; continue; } // keep escape; unescaped below
    if (ch === '|') { cells.push(cur); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

const unescapeCell = (c) => String(c).replace(/\\\|/g, '|');

// A markdown rule/separator row: only dashes, colons, pipes and spaces (`| --- | --- |`).
const isRuleRow = (t) => /^\|?[\s:|-]+\|?$/.test(t) && t.includes('-');

// Canonical field key for a header cell. Maps both the 7-col v1 header and the 6-col
// legacy header (no Type; "Area of Work" or a bare "Area"), and both spellings of the
// project column ("Project" now, "Job" in every file written before 2026-10-01).
// Unknown headers → null.
function canonHeader(h) {
  const t = String(h).trim().toLowerCase();
  if (t === 'date') return 'date';
  if (t === 'job' || t === 'project') return 'job'; // `Project` since 2026-10-01; `Job` is the legacy header every older file carries
  if (t === 'type') return 'type';
  if (t === 'status') return 'status';
  if (t === 'area of work' || t === 'area') return 'area';
  if (t === 'change') return 'change';
  if (t === 'reason') return 'reason';
  return null;
}

// Parse a markdown table into structured rows (never dump a table as raw text). Detects the header line (a table row carrying both Date and Project/Job), maps columns
// by NAME so a 6-col legacy table, a 7-col v1 table, and a reordered table all parse.
// Prose before/after the table is ignored. Cell values are the RAW display strings
// (labels or legacy `#tags`) — normalization to ids happens in normalizeImport.
export function parseTable(md) {
  const lines = String(md || '').split(/\r?\n/);

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith('|')) continue;
    const keys = splitRow(lines[i]).map(canonHeader);
    if (keys.includes('date') && keys.includes('job')) { headerIdx = i; break; }
  }
  if (headerIdx < 0) return [];

  const colOf = {};
  splitRow(lines[headerIdx]).forEach((h, idx) => {
    const key = canonHeader(h);
    if (key && colOf[key] === undefined) colOf[key] = idx;
  });

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t.startsWith('|')) break;     // table ended
    if (isRuleRow(t)) continue;        // separator row
    const cells = splitRow(lines[i]);
    const get = (field) => {
      const idx = colOf[field];
      return idx === undefined ? '' : unescapeCell(cells[idx] ?? '');
    };
    rows.push({
      date: get('date'), job: get('job'), type: get('type'),
      status: get('status'), area: get('area'),
      change: get('change'), reason: get('reason'),
    });
  }
  return rows;
}

// Normalize parsed rows against the managed config and merge them into the store
// For each row:
//   status → a managed id (resolveVocabId matches by id or label-slug, strips a leading
//            '#'); UNMATCHED → quarantine, never a new chip.
//   type   → managed: resolve or quarantine; freeform/off: accept as-is; empty: skipped.
//   area   → managed: resolve or quarantine; freeform: accept the raw text.
// Dedup is content-hash based: the 7-col table carries no id, so identity is the
// fingerprint over {job,status,area,type,change,reason,date}. A row whose hash already
// exists (in the store OR earlier in this same paste) is MERGED (skipped), making
// re-import idempotent. A genuinely new row gets a fresh global id.
//
// (Forward seam: when an id-carrying interchange format lands, a row's own id enables
// true reconcile-as-supersede. Unreachable from the id-less table,
// so v1 dedups on the hash.)
//
// `overrides` is the review step's reconcile map: { status:{rawToken:id}, type:{…},
// area:{…} }. A raw token the admin has mapped to a managed id resolves to it directly,
// bypassing quarantine — the mechanism behind the ImportSheet's "map to →" picker. The
// admin never mints a chip here; they only point an unmatched token at an EXISTING one.
export function normalizeImport(rows, config, existing = [], overrides = {}) {
  const entries = [];
  const quarantine = [];
  const merged = [];
  const seen = new Set((existing || []).map((e) => contentHash(e)));
  const ov = (kind, token) => overrides?.[kind]?.[token];

  for (const row of rows || []) {
    const statusId = ov('status', row.status) || resolveVocabId(config, 'status', row.status);
    if (!statusId) { quarantine.push({ reason: 'status', token: row.status, row }); continue; }

    let typeId = '';
    if (row.type) {
      const typeOv = ov('type', row.type);
      if (typeOv) {
        typeId = typeOv;
      } else if (config?.types?.mode !== 'freeform') {
        // managed AND off: a type must name a member, or it is quarantined for the
        // review step's "map to →". The server validates `type` whenever the axis is
        // not freeform — off included (server handlers/entries.ts) — so an unknown
        // token accepted here would park in Needs attention on the first sync (since
        // 2026-10-02 a fresh device is 'off'). A member's token is stored
        // as its ID ('RFI' → 'rfi'), never the label.
        typeId = resolveVocabId(config, 'type', row.type);
        if (!typeId) { quarantine.push({ reason: 'type', token: row.type, row }); continue; }
      } else {
        // freeform: never quarantined; a member's token still stores as its ID.
        typeId = resolveVocabId(config, 'type', row.type) || row.type;
      }
    }

    let areaValue = row.area || '';
    if (areaValue && ov('area', areaValue)) {
      areaValue = ov('area', areaValue);
    } else if (config?.areas?.mode === 'managed' && areaValue) {
      const areaId = resolveVocabId(config, 'area', areaValue);
      if (!areaId) { quarantine.push({ reason: 'area', token: areaValue, row }); continue; }
      areaValue = areaId;
    }

    const candidate = {
      job: row.job, category: statusId, who: areaValue, type: typeId,
      change: row.change, reason: row.reason, date: row.date,
    };
    const hash = contentHash(candidate);
    if (seen.has(hash)) { merged.push(row); continue; }
    seen.add(hash);

    entries.push(newEntry({
      date: row.date, job: row.job, status: statusId, area: areaValue,
      type: typeId, change: row.change, reason: row.reason,
    }));
  }

  return { entries, quarantine, merged };
}
