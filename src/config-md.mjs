// config-md.mjs
// Reads the config zone back out of markdown: the inverse of exporter.mjs's
// `toConfigMarkdown` / `toEntryFile`. Before this module the library could write a
// config and not read one back; it began in the Obsidian plugin (2026-07-27) as a
// narrow reader and moved here, so every consumer reads the config zone the same way.
//
// The grammar is what `exporter.configYaml` emits and nothing more. It is not a
// general YAML parser and must not become one: a consumer that needs general YAML
// already has a parser, and reaching for this instead is a bug.
import { defaultConfig, migrateConfig } from './config.mjs';

// Pull the first `---` fenced block. Works for the standalone `_changelog-config.md`
// (frontmatter is the whole file) and for `toEntryFile` output (frontmatter, then table).
/** @param {string|null|undefined} md @returns {string|null} */
export function extractFrontmatter(md) {
  const text = String(md || '');
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/.exec(text);
  return m ? m[1] : null;
}

// Split an inline `{ id: x, label: y, color: "#z", closes: false }` map.
// A quoted value (exporter.labelYaml quotes a label that needs it) is read to its
// closing quote, escapes and all, so `, closes:` inside a label is label text. A bare
// value runs to the next `, key:`: a keyed scan rather than a split on ',' so a label
// written bare before labels were quoted, comma and all, still reads as it always did.
const KEY_AT = /\s*([A-Za-z_][\w-]*)\s*:\s*/y;
const NEXT_KEY = /,\s*[A-Za-z_][\w-]*\s*:/g;
const ESCAPES = { n: '\n', t: '\t', '"': '"', '\\': '\\' };

function readQuoted(body, start) {
  const q = body[start];
  let out = '';
  let i = start + 1;
  while (i < body.length) {
    const ch = body[i];
    if (q === '"' && ch === '\\' && i + 1 < body.length) {
      out += ESCAPES[body[i + 1]] ?? body[i + 1];
      i += 2;
      continue;
    }
    if (q === "'" && ch === "'" && body[i + 1] === "'") { out += "'"; i += 2; continue; }
    if (ch === q) return { value: out, end: i + 1 };
    out += ch;
    i += 1;
  }
  return { value: out, end: body.length };
}

function parseInlineMap(body) {
  const out = {};
  let i = 0;
  while (i < body.length) {
    KEY_AT.lastIndex = i;
    const key = KEY_AT.exec(body);
    if (!key) break;
    i = KEY_AT.lastIndex;
    if (body[i] === '"' || body[i] === "'") {
      const { value, end } = readQuoted(body, i);
      out[key[1]] = value;   // a quoted scalar is a string, never coerced
      const comma = body.indexOf(',', end);
      i = comma === -1 ? body.length : comma + 1;
      continue;
    }
    NEXT_KEY.lastIndex = i;
    const next = NEXT_KEY.exec(body);
    const end = next ? next.index : body.length;
    out[key[1]] = coerce(body.slice(i, end));
    i = next ? next.index + 1 : body.length;
  }
  return out;
}

function coerce(raw) {
  const v = String(raw).trim().replace(/,$/, '').trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

const MEMBER_RE = /^\s*-\s*\{(.*)\}\s*$/;

// Parse the config zone out of a markdown file. Returns null when the file carries no
// frontmatter or no recognizable config — the caller falls through to the next source.
/** @param {string|null|undefined} md */
export function parseConfigMarkdown(md) {
  const fm = extractFrontmatter(md);
  if (fm == null) return null;

  const config = { statuses: [], areas: { mode: 'freeform', set: [] }, types: { mode: 'off', set: [] } };
  let section = null;   // 'statuses' | 'areas' | 'types'
  let inSet = false;    // inside an areas/types `set:` list

  for (const line of fm.split(/\r?\n/)) {
    if (!line.trim()) continue;

    const member = MEMBER_RE.exec(line);
    if (member && section) {
      const v = parseInlineMap(member[1]);
      if (!v.id) continue;
      if (section === 'statuses') config.statuses.push({ ...v, closes: v.closes === true });
      else config[section].set.push(v);
      continue;
    }

    const kv = /^(\s*)([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, indent, key, rawValue] = kv;
    const value = coerce(rawValue);

    if (indent.length === 0) {
      inSet = false;
      if (key === 'statuses' || key === 'areas' || key === 'types') { section = key; continue; }
      section = null;
      if (key === 'schema' || key === 'tenant' || key === 'completeTarget') config[key] = value;
      continue;
    }

    // Indented keys belong to the open areas/types section.
    if (section === 'areas' || section === 'types') {
      if (key === 'mode') { config[section].mode = value; inSet = false; }
      else if (key === 'set') inSet = rawValue.trim() === '';   // `set: []` closes it immediately
    }
  }

  if (!config.statuses.length) return null;   // nothing usable — let the caller fall through
  void inSet;
  return config;
}

// The config zone's resolution order: the authoritative `_changelog-config.md`
// first, then the snapshot embedded in the log file's own frontmatter, then the shipped
// defaults. Whatever wins is run through the SDK's `migrateConfig`, so a hand-edited or
// partial config is normalized (string vocab sets promoted, `completeTarget` backfilled)
// by the same code path the app uses rather than by a second set of rules here.
/** @param {{configMd?: string|null, embeddedMd?: string|null}} [sources] */
export function resolveConfig({ configMd = null, embeddedMd = null } = {}) {
  const fromFile = configMd ? parseConfigMarkdown(configMd) : null;
  if (fromFile) return { ...migrateConfig(fromFile), source: 'config-file' };

  const fromEmbedded = embeddedMd ? parseConfigMarkdown(embeddedMd) : null;
  if (fromEmbedded) return { ...migrateConfig(fromEmbedded), source: 'embedded' };

  return { ...migrateConfig(defaultConfig()), source: 'defaults' };
}
