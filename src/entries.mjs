// lib/schema/entries.mjs
// Append-only + supersede. edit = append a new entry that supersedes the
// prior; nothing is mutated in place. A supersede may change ONLY status/change/reason;
// job/area(who)/type/by are carried forward immutably (identity/attribution). Each entry
// stamps its own `date` (append time) so a chain shows both timestamps.
import { makeId } from './ids.mjs';
import { formatTimestamp } from './time.mjs';
import { closesFor, completeTargetStatus } from './config.mjs';

export function newEntry(fields = {}) {
  return {
    id: makeId(),
    supersedes: '',
    date: fields.date || formatTimestamp(),
    job: fields.job || '',
    category: fields.status || '',   // status id (internal key stays `category`)
    who: fields.area || '',          // area (internal key stays `who`)
    type: fields.type || '',         // optional type axis
    change: fields.change || '',
    reason: fields.reason || '',
    by: fields.by || 'owner',
  };
}

// The identity of a job string, for grouping. Casing and surrounding whitespace are
// not identity: a 2026-09-21 seed corpus holds 11 raw strings for 8 jobs, because a
// thumb on a phone produces that inside a week. Interior spacing is left alone, because
// collapsing it would fold two jobs a person can genuinely tell apart.
//
// It lives HERE, beside jobRollup, rather than in a view module, because it is a claim
// about the data model and the server compiles this file too (server/src/runtime/
// schema.ts imports it by relative path). A schema module reaching outward for it would
// drag a presentation module into the server's bundle for four lines.
export function jobKey(job) {
  return String(job == null ? '' : job).trim().toLowerCase();
}

export function supersededIds(entries) {
  const s = new Set();
  for (const e of entries) if (e.supersedes) s.add(e.supersedes);
  return s;
}

export function headsOf(entries) {
  const superseded = supersededIds(entries);
  return entries.filter((e) => !superseded.has(e.id));
}

export function headOf(entries, id) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const fwd = new Map();
  for (const e of entries) if (e.supersedes) fwd.set(e.supersedes, e);
  let cur = byId.get(id);
  if (!cur) return undefined;
  while (fwd.has(cur.id)) cur = fwd.get(cur.id);
  return cur;
}

export function supersede(entries, targetId, patch = {}) {
  const head = headOf(entries, targetId);
  if (!head) return entries;
  const next = {
    id: makeId(),
    supersedes: head.id,
    date: formatTimestamp(),
    job: head.job,
    who: head.who,
    type: head.type,
    by: head.by,
    category: patch.status !== undefined ? patch.status : head.category,
    change: patch.change !== undefined ? patch.change : head.change,
    reason: patch.reason !== undefined ? patch.reason : head.reason,
    ...(head.voided ? { voided: true } : {}),
  };
  return [next, ...entries]; // newest-first
}

// The one-tap Complete. Resolves through config.completeTarget (never through status
// ORDER) so reordering the status list stays purely cosmetic. No-op when the config
// names no reachable terminal status.
export function completeEntry(entries, targetId, config) {
  const terminal = completeTargetStatus(config);
  if (!terminal) return entries;
  return supersede(entries, targetId, { status: terminal.id });
}

export function chainOf(entries, id) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const head = headOf(entries, id);
  if (!head) return [];
  const chain = [head];
  let cur = head;
  while (cur.supersedes && byId.has(cur.supersedes)) {
    cur = byId.get(cur.supersedes);
    chain.push(cur);
  }
  return chain.reverse(); // root → head
}

// Live heads = heads that haven't been voided (a "delete" is an append-only tombstone,
// never a removal — Part-11 audit trail). Voided heads stay in the chain/history but drop
// out of the Log and Active views.
export function liveHeads(entries) {
  return headsOf(entries).filter((h) => !h.voided);
}

// "Delete" as append-only tombstone (2026-07-06): supersede the head with an
// identical entry flagged voided:true. Distinct from the `cancelled` status (a real
// lifecycle outcome that stays visible) — void is an editorial removal that hides the
// chain from default views while preserving the full audit history.
export function voidHead(entries, headId) {
  const head = headOf(entries, headId);
  if (!head) return entries;
  const next = {
    id: makeId(),
    supersedes: head.id,
    date: formatTimestamp(),
    job: head.job, who: head.who, type: head.type, by: head.by,
    category: head.category, change: head.change, reason: head.reason,
    voided: true,
  };
  return [next, ...entries];
}

// The ONE deliberate un-void (2026-07-06). Appends a fresh LIVE head superseding the
// tombstone, carrying its content forward with `voided` cleared. The void event stays in
// the chain (history). This is the only thing that clears `voided` — `supersede` now
// carries the flag forward, so editing/superseding a voided chain never resurrects it.
// No-op if the head is missing or not currently voided.
export function restoreHead(entries, headId) {
  const head = headOf(entries, headId);
  if (!head || !head.voided) return entries;
  const next = {
    id: makeId(),
    supersedes: head.id,
    date: formatTimestamp(),
    job: head.job,
    who: head.who,
    type: head.type,
    by: head.by,
    category: head.category,
    change: head.change,
    reason: head.reason,
  };
  return [next, ...entries];
}

// Split a list of heads into the still-open ones and the closed ones, preserving
// order in both. ONE definition of "closed" for the whole app — `closesFor(config,
// status)`, which is the user's `closes` flag, never a hardcoded status list (invariant
// 5): it catches Completed AND Cancelled AND whatever else a tenant marked terminal.
//
// The Log needs both sides, not just the open one: when the "Show completed entries"
// preference hides the closed heads it has to SAY how many it hid ("3 completed
// hidden"). A count derived from a second, separately-written predicate is exactly how
// the two sides drift, so the count and the filter come out of the same pass here.
// `activeHeads` is now defined through it, so there is nowhere left for them to disagree.
export function partitionClosed(heads, config) {
  const open = [];
  const closed = [];
  for (const h of heads) (closesFor(config, h.category) ? closed : open).push(h);
  return { open, closed };
}

export function activeHeads(entries, config) {
  return partitionClosed(liveHeads(entries), config).open;
}

// The Active screen's rollup: GROUP BY job over live heads (pass `liveHeads(entries)`),
// newest-first in, so the first head seen per job is that job's latest.
//
// Open loops are counted in TWO buckets, and the split is the whole point (F3). On a
// shared job the peer's open loops are visible and real — they belong in what the
// manager sees — but they are not ours to close: only an entry's author may supersede
// it. A single merged `openCount` driving a "close job" action would either overstate
// what the action does or silently do nothing when every open loop is the peer's.
//   - openCount:     open heads WE authored — the only ones a bulk close can act on.
//   - peerOpenCount: open heads a peer authored — shown, never closable by us.
// `isPeer` is injected (the caller passes sync-engine's isPeerEntry) so this schema
// module stays ignorant of the sync layer; with no predicate every head counts as ours,
// which is exactly the local-only case.
//
// KEYED CASE-INSENSITIVELY, whitespace trimmed (2026-09-21). It used to key on the raw
// job string, which made "24-118 Imaging Suite Fit-Out" and "24-118 imaging suite
// fit-out" two separate jobs on Active and two separate sections on Charts. That is not
// hypothetical: a seed corpus - built to be human-shaped, not to break anything -
// holds 11 raw strings for 8 jobs, because a thumb on a phone does that inside a
// week. Casing and surrounding whitespace are not job identity.
//
// Identity is the key; DISPLAY is the newest head's raw string, so the row still shows
// the user what they last typed rather than a lowercased normal form they never wrote.
// Anything that ACTS on a row must key the same way - see `completeJob` in
// ChangelogContext, which would otherwise close one spelling's loops while reporting
// the other spelling's count.
export function jobRollup(heads, config, isPeer = () => false) {
  const byJob = new Map();
  for (const h of heads) {
    const open = !closesFor(config, h.category);
    const peer = Boolean(isPeer(h));
    const key = jobKey(h.job);
    const row = byJob.get(key);
    if (!row) {
      byJob.set(key, {
        key,
        job: h.job,
        latest: h,
        count: 1,
        openCount: open && !peer ? 1 : 0,
        peerOpenCount: open && peer ? 1 : 0,
      });
    } else {
      row.count += 1;
      if (open && peer) row.peerOpenCount += 1;
      else if (open) row.openCount += 1;
    }
  }
  const rows = Array.from(byJob.values());
  // Last-touched desc. The clean `date` string (YYYY-MM-DD ddd HH:mm) sorts
  // chronologically as plain text.
  rows.sort((a, b) => (a.latest.date < b.latest.date ? 1 : a.latest.date > b.latest.date ? -1 : 0));
  return rows;
}

// Deterministic fingerprint over the identity-bearing fields — used to dedupe an
// imported hand-authored row that carries no id. Not cryptographic.
export function contentHash(e) {
  const s = [e.job, e.category, e.who, e.type, e.change, e.reason, e.date]
    .map((p) => String(p ?? '')).join('|');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(36)}`;
}

// ── Seq-aware fork resolution (backend design doc, "Fork resolution") ──────
// Two offline devices can supersede the same head; the server accepts both, so
// a synced set may hold competing successors for one predecessor — a fork,
// which the single-device functions above leave undefined (headsOf would report
// both tips as heads). Synced entries carry `seq`, the server-assigned
// per-workspace monotonic sequence; unsynced local entries carry none.
//
// The rule, applied independently at EACH fork point while walking root → tip:
//   1. an unsynced successor (no `seq`) beats any synced one — seq is assigned
//      at push, so a pending local entry will outrank everything already
//      synced the moment it lands; resolving it as the winner now means the
//      head doesn't flip when the outbox drains;
//   2. otherwise the highest `seq` wins;
//   3. two unsynced successors (one device can't produce this, but keep it
//      deterministic anyway) fall to the lexicographically greater `id`.
// The losing branch — including any sub-chain built on top of the loser — stays
// in the entry set as visible history; it just never becomes the head. The
// traversal only ever follows winning successors, so a loser's descendants
// cannot re-enter the head path.
//
// Determinism: the rule reads only `seq`/`id`, never array position, so any
// arrival order of the same entry set resolves to the same heads (the parity
// tests shuffle to prove it). With no forks and no seqs this degrades exactly
// to headsOf/headOf.
export function forkWinner(a, b) {
  const aSynced = a.seq !== undefined && a.seq !== null;
  const bSynced = b.seq !== undefined && b.seq !== null;
  if (aSynced !== bSynced) return aSynced ? b : a;  // unsynced beats synced
  if (aSynced && Number(a.seq) !== Number(b.seq)) {
    return Number(a.seq) > Number(b.seq) ? a : b;   // highest seq wins
  }
  return String(a.id) > String(b.id) ? a : b;       // deterministic last resort
}

// Map of entry id → its WINNING direct successor (losers dropped at each fork).
// Shared plumbing for the resolved* walkers below.
function winningSuccessors(entries) {
  const succ = new Map();
  for (const e of entries) {
    if (!e.supersedes) continue;
    const rival = succ.get(e.supersedes);
    succ.set(e.supersedes, rival ? forkWinner(rival, e) : e);
  }
  return succ;
}

// Seq-aware headOf: the canonical head of the chain containing `id`. Walks back
// to the chain root first — `id` may sit on a losing branch, and the head is a
// property of the chain, not of the branch you ask from — then forward through
// winning successors only.
export function resolvedHeadOf(entries, id) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  let cur = byId.get(id);
  if (!cur) return undefined;
  while (cur.supersedes && byId.has(cur.supersedes)) cur = byId.get(cur.supersedes);
  const succ = winningSuccessors(entries);
  while (succ.has(cur.id)) cur = succ.get(cur.id);
  return cur;
}

// Seq-aware headsOf: exactly ONE head per chain, forks resolved. A root is an
// entry that supersedes nothing (or a predecessor not in the set — a partial
// pull still resolves what it can see). Preserves the input array's order,
// like headsOf.
export function resolvedHeadsOf(entries) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const succ = winningSuccessors(entries);
  const headIds = new Set();
  for (const e of entries) {
    if (e.supersedes && byId.has(e.supersedes)) continue; // not a root
    let cur = e;
    while (succ.has(cur.id)) cur = succ.get(cur.id);
    headIds.add(cur.id);
  }
  return entries.filter((e) => headIds.has(e.id));
}

// Seq-aware liveHeads: resolved heads that haven't been voided (same tombstone
// rule as liveHeads, applied to the fork-resolved head).
export function resolvedLiveHeads(entries) {
  return resolvedHeadsOf(entries).filter((h) => !h.voided);
}

// Seq-aware activeHeads: resolved live heads whose status is still open.
export function resolvedActiveHeads(entries, config) {
  return resolvedLiveHeads(entries).filter((h) => !closesFor(config, h.category));
}
