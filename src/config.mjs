// lib/schema/config.mjs
// The config zone: the tenant's managed vocabulary. `id` is the immutable
// storage key; relabeling never changes it. `closes:true` is a terminal status (drives
// the Active view). Areas default freeform; the type axis ships off, with the
// construction set seeded.

export function slugId(label) {
  return String(label || '')
    .trim().toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// The 8 on-brand hues. Owned here (pure, Node-testable) and re-exported by
// constants/colors.js — one source of truth for every vocabulary's color.
export const VOCAB_PALETTE = [
  '#bc8cff', // violet
  '#58a6ff', // blue   (accent2)
  '#d29922', // amber
  '#f85149', // red
  '#39c5cf', // cyan
  '#f0883e', // orange
  '#3fb950', // green  (accent)
  '#7d8590', // slate
];

export function nextVocabColor(used = []) {
  return VOCAB_PALETTE.find((c) => !used.includes(c))
    || VOCAB_PALETTE[used.length % VOCAB_PALETTE.length];
}

// Every mode a {mode, set} vocabulary axis may carry. One source of truth for
// BOTH sides of the wire: Settings offers 'off'|'managed' for types and
// 'freeform'|'managed' for areas, and the server's full-document validation
// accepts exactly this set — the two lists diverging is how a shipped Settings
// state ('off') came to be a 400 the server bounced whole documents over.
// Semantics are uniform across axes: 'managed' validates entry tokens against
// the set, 'freeform' skips validation, 'off' hides the axis (empty values are
// never validated on any mode, so 'off' rejects nothing).
export const VOCAB_MODES = ['managed', 'freeform', 'off'];

export function defaultConfig() {
  return {
    schema: 'changelog/v1',
    tenant: 'local',
    statuses: [
      { id: 'to-do',     label: 'To-Do',     color: '#a371f7', closes: false },
      { id: 'current',   label: 'Current',   color: '#58a6ff', closes: false }, // palette blue (was Tailwind #3b82f6; migrateVocabColors rewrites stored copies)
      { id: 'on-hold',   label: 'On Hold',   color: '#d29922', closes: false },
      { id: 'completed', label: 'Completed', color: '#3fb950', closes: true  },
      { id: 'cancelled', label: 'Cancelled', color: '#8b949e', closes: true  },
    ],
    // The ✓ Complete tap's destination. Explicit, so reordering statuses is purely
    // cosmetic and can never silently retarget completion (2026-07-09).
    completeTarget: 'completed',
    // True once the legacy `areaChips` key has been folded into areas.set.
    // Fresh installs have nothing to seed.
    areasSeeded: true,
    areas: { mode: 'freeform', set: [] },
    // The type axis is OFF by default (since 2026-10-02): a new crew
    // logs without a type step until someone turns it on in Settings. The set stays
    // seeded, so turning it on offers the construction types straight away. Before
    // this it was 'managed'; a config already STORED with 'managed' keeps it (nothing
    // rewrites a stored doc), and legacyDefaultConfigs() below keeps that old default
    // recognisable as "untouched" to the sync reconcile.
    types: {
      mode: 'off',
      set: [
        { id: 'task',      label: 'Task',      color: '#bc8cff' },
        { id: 'submittal', label: 'Submittal', color: '#58a6ff' },
        { id: 'rfi',       label: 'RFI',       color: '#d29922' },
        { id: 'material',  label: 'Material',  color: '#f85149' },
        { id: 'field-dim', label: 'Field-Dim', color: '#39c5cf' },
        { id: 'conflict',  label: 'Conflict',  color: '#f0883e' },
      ],
    },
  };
}

// Earlier factory defaults that a device or a workspace may still hold, untouched:
// the type axis was 'managed' until 2026-10-02. Used only to answer "is this doc still the
// factory default?" (sync-engine isFactoryDefault), never to equate two docs — a
// types.mode difference between a device and its workspace is a real one.
export function legacyDefaultConfigs() {
  const c = defaultConfig();
  return [{ ...c, types: { ...c.types, mode: 'managed' } }];
}

export function statusById(config, id) {
  return (config?.statuses || []).find((s) => s.id === id);
}

// Normalize a raw status token to a comparable slug: strip a leading '#', lowercase,
// spaces→hyphens. '#On Hold' → 'on-hold'.
export function statusSlug(raw) {
  return slugId(String(raw || '').replace(/^#/, ''));
}

// Resolve a raw token to a managed status id, or null if unmatched. Delegates to
// resolveVocabId so there is exactly one resolution rule.
export function resolveStatusId(config, raw) {
  return resolveVocabId(config, 'status', raw);
}

// Terminal-word fallback so a pre-v1 '#completed' entry stays closed WITHOUT rewriting
// its stored value (quarantine, never silently rewrite).
const TERMINAL_WORDS = new Set(['completed', 'cancelled']);

export function closesFor(config, raw) {
  const id = resolveStatusId(config, raw);
  if (id) return !!statusById(config, id).closes;
  return TERMINAL_WORDS.has(statusSlug(raw));
}

// Promote a vocabulary set from the older `string[]` shape to `{id,label,color}[]`.
// Already-promoted members pass through untouched (idempotence), contributing their
// color to the "used" pool so a newly-promoted sibling never collides.
function promoteSet(set = [], seedColors = []) {
  const used = [...seedColors];
  return set.map((v) => {
    if (v && typeof v === 'object') {
      if (v.color) used.push(v.color);
      return v;
    }
    const label = String(v).trim();
    const color = nextVocabColor(used);
    used.push(color);
    return { id: slugId(label), label, color };
  });
}

const hasStrings = (set = []) => set.some((v) => typeof v === 'string');

// Config-zone migration. CONFIG ONLY — it never reads or writes `entries`.
// Additive and idempotent: run it on every load, it changes nothing the second time.
// `legacyAreaChips` is the read-once `areaChips` AsyncStorage array; it is folded in
// exactly once, guarded by `areasSeeded`, so a user who deletes all their areas does
// not get them resurrected on next launch.
export function migrateConfig(config, legacyAreaChips = []) {
  const base = config ? { ...config } : defaultConfig();
  let changed = false;

  const statusColors = (base.statuses || []).map((s) => s.color);

  // A doc with NO types key predates the type axis, so none of its entries carry a
  // type. It reads like a fresh install: off, with the default set seeded so the
  // Settings switch works (before 2026-10-02 this filled 'managed' with an empty set). A
  // doc that HAS a types key is taken as stored, whatever its mode.
  const types = base.types || { ...defaultConfig().types };
  if (hasStrings(types.set)) changed = true;
  const nextTypes = { ...types, set: promoteSet(types.set, statusColors) };

  const areas = base.areas || { mode: 'freeform', set: [] };
  let areaSet = areas.set || [];
  let areasSeeded = base.areasSeeded === true;
  if (!areasSeeded) {
    if (legacyAreaChips.length) {
      areaSet = [...areaSet, ...legacyAreaChips];
      changed = true;
    }
    areasSeeded = true;
    changed = true;
  }
  if (hasStrings(areaSet)) changed = true;
  const nextAreas = { ...areas, set: promoteSet(areaSet, statusColors) };

  let completeTarget = base.completeTarget;
  if (!completeTarget) {
    // Behavior-preserving: the older completeEntry scanned for exactly this.
    completeTarget = (base.statuses || []).find((s) => s.closes)?.id || '';
    changed = true;
  }

  return {
    config: { ...base, completeTarget, areasSeeded, areas: nextAreas, types: nextTypes },
    changed,
  };
}

// The three tenant vocabularies, addressed by kind. Statuses are a bare array;
// types and areas are `{mode, set}`.
const VOCAB_READER = {
  status: (c) => c?.statuses || [],
  type:   (c) => c?.types?.set || [],
  area:   (c) => c?.areas?.set || [],
};

export function vocabSet(config, kind) {
  const read = VOCAB_READER[kind];
  return read ? read(config) : [];
}

// Resolve a raw token to a managed id, or null if unmatched (a quarantine candidate —
// NEVER auto-mint). Matches by id or by label-slug; `statusSlug` strips a leading '#'
// so pre-v1 '#completed' still resolves.
export function resolveVocabId(config, kind, raw) {
  const slug = statusSlug(raw);
  if (!slug) return null;
  const hit = vocabSet(config, kind).find((v) => v.id === slug || slugId(v.label) === slug);
  return hit ? hit.id : null;
}

// The single label resolver — used both for on-screen rendering AND on the export path
// (the interchange table renders Type/Status/Area as LABELS,
// not ids, so the Markdown export reads `labelFor` too). The export stays a lossless
// round-trip anyway: `resolveVocabId` matches a raw token by id OR by label-slug, so a
// label written back out (e.g. 'Completed') resolves to the same id ('completed') an
// importer would get from the raw id itself. An unresolvable token passes through
// verbatim so a removed status, a freeform area, or an imported legacy tag still
// renders (on screen or in an export) on an old entry.
export function labelFor(config, kind, raw) {
  const id = resolveVocabId(config, kind, raw);
  if (!id) return String(raw ?? '');
  const hit = vocabSet(config, kind).find((v) => v.id === id);
  return hit ? hit.label : String(raw ?? '');
}

// The ONE key a stored type token is compared and grouped by (2026-10-02).
// Entries are INSERT-only and the type token was stored in two forms:
// the app and the importer write the vocabulary ID ('task'), the MCP connector wrote
// whatever it was handed — usually the LABEL ('Task'). Stored tokens are never
// rewritten, so every reader that compares or groups types goes through
// this: a managed member resolves by id or label-slug to its id; an unresolvable token
// (freeform mode, a removed member) still folds case and whitespace, so 'Dev' and 'dev '
// chart as one bar instead of two. A token that slugs to nothing (no ASCII letters or
// digits — '配管') keys as its trimmed self, so a typed entry is never Untyped.
// '' means untyped. A KEY, never a display label: show the stored token
// (labelFor).
export function typeKey(config, raw) {
  return resolveVocabId(config, 'type', raw) || statusSlug(raw) || String(raw ?? '').trim();
}

// The ✓ Complete tap's destination. Resolves `config.completeTarget` when it exists AND
// still closes; otherwise falls back to the first closing status — which is exactly what
// completeEntry scanned for before this field existed, so a hand-broken config degrades
// to the old behavior instead of silently no-op'ing.
export function completeTargetStatus(config) {
  const list = config?.statuses || [];
  const named = list.find((s) => s.id === config?.completeTarget && s.closes);
  return named || list.find((s) => s.closes) || null;
}

// Guardrail: the resolved ✓ target may not be removed, nor have `closes` turned off.
// This single rule subsumes "there must always be ≥1 closing status".
export function isCompleteTarget(config, id) {
  return completeTargetStatus(config)?.id === id;
}
