// lib/schema/entries.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jobKey, newEntry, headsOf, headOf, supersede, completeEntry, chainOf, liveHeads, voidHead, activeHeads, partitionClosed, contentHash, restoreHead, forkWinner, resolvedHeadOf, resolvedHeadsOf, resolvedLiveHeads, resolvedActiveHeads, jobRollup } from './entries.mjs';
import { defaultConfig } from './config.mjs';
import { isGlobalId } from './ids.mjs';

test('newEntry produces a fresh head mapping status→category, area→who', () => {
  const e = newEntry({ job: '24-118', status: 'current', area: 'North stair', type: 'RFI', change: 'x', reason: 'y' });
  assert.ok(isGlobalId(e.id));
  assert.equal(e.supersedes, '');
  assert.equal(e.category, 'current');
  assert.equal(e.who, 'North stair');
  assert.equal(e.type, 'RFI');
  assert.equal(e.by, 'owner');
  assert.ok(e.date && e.date.length >= 16);
});

test('supersede appends a head that changes only status/change/reason', () => {
  const a = newEntry({ job: 'J', status: 'current', area: 'A', type: 'Task', change: 'first', reason: 'r1' });
  const list1 = [a];
  const list2 = supersede(list1, a.id, { status: 'on-hold', change: 'second' });
  assert.equal(list2.length, 2);
  const head = headsOf(list2);
  assert.equal(head.length, 1);
  assert.equal(head[0].supersedes, a.id);
  assert.equal(head[0].category, 'on-hold');
  assert.equal(head[0].change, 'second');
  assert.equal(head[0].reason, 'r1');   // carried forward (not in patch)
  assert.equal(head[0].job, 'J');       // identity carried forward
  assert.equal(head[0].who, 'A');
  assert.equal(head[0].type, 'Task');
  assert.notEqual(head[0].id, a.id);    // new id
});

test('headsOf returns exactly one head per chain', () => {
  const a = newEntry({ job: 'J', status: 'current', change: 'a' });
  let list = [a];
  list = supersede(list, a.id, { change: 'b' });
  list = supersede(list, list[0].id, { change: 'c' });
  const heads = headsOf(list);
  assert.equal(heads.length, 1);
  assert.equal(heads[0].change, 'c');
  assert.equal(chainOf(list, a.id).map((e) => e.change).join('>'), 'a>b>c'); // root→head
});

test('completeEntry supersedes to the first closes:true status and leaves Active', () => {
  const cfg = defaultConfig();
  const a = newEntry({ job: 'J', status: 'current', change: 'open' });
  let list = [a];
  assert.equal(activeHeads(list, cfg).length, 1);
  list = completeEntry(list, a.id, cfg);
  assert.equal(headsOf(list)[0].category, 'completed');
  assert.equal(activeHeads(list, cfg).length, 0); // left Active
  assert.equal(list.length, 2);                   // history preserved
});

test('activeHeads = chains whose head is open; two jobs, one closed', () => {
  const cfg = defaultConfig();
  const a = newEntry({ job: 'A', status: 'current', change: 'a' });
  const b = newEntry({ job: 'B', status: 'completed', change: 'b' });
  const list = [b, a];
  const active = activeHeads(list, cfg);
  assert.deepEqual(active.map((e) => e.job), ['A']);
});

test('partitionClosed splits by the closes FLAG, not by a status name list', () => {
  const cfg = defaultConfig();
  // Cancelled is the one that catches a hardcoded ['completed'] check out, and a
  // tenant flag flip is the one that catches a hardcoded list of any length out.
  cfg.statuses = cfg.statuses.map((s) => (s.id === 'on-hold' ? { ...s, closes: true } : s));
  const heads = [
    newEntry({ job: 'A', status: 'current', change: 'open' }),
    newEntry({ job: 'B', status: 'completed', change: 'done' }),
    newEntry({ job: 'C', status: 'cancelled', change: 'dropped' }),
    newEntry({ job: 'D', status: 'on-hold', change: 'parked' }),
    newEntry({ job: 'E', status: 'to-do', change: 'later' }),
  ];
  const { open, closed } = partitionClosed(heads, cfg);
  // Order is preserved on both sides — the Log renders `open` directly and it is
  // newest-first by construction.
  assert.deepEqual(open.map((e) => e.job), ['A', 'E']);
  assert.deepEqual(closed.map((e) => e.job), ['B', 'C', 'D']);
  // The count the Log shows as "N completed hidden" is the other side of the same pass.
  assert.equal(open.length + closed.length, heads.length);
});

test('partitionClosed treats a pre-v1 #completed token as closed (legacy passthrough)', () => {
  const cfg = defaultConfig();
  const legacy = { ...newEntry({ job: 'J', change: 'old' }), category: '#Completed' };
  const { open, closed } = partitionClosed([legacy], cfg);
  assert.equal(open.length, 0);
  assert.equal(closed.length, 1);
});

test('activeHeads is exactly partitionClosed().open over the live heads', () => {
  const cfg = defaultConfig();
  const a = newEntry({ job: 'A', status: 'current', change: 'a' });
  const b = newEntry({ job: 'B', status: 'completed', change: 'b' });
  const c = newEntry({ job: 'C', status: 'current', change: 'c' });
  const list = voidHead([c, b, a], c.id); // voided chains are out of both
  assert.deepEqual(activeHeads(list, cfg), partitionClosed(liveHeads(list), cfg).open);
  assert.deepEqual(activeHeads(list, cfg).map((e) => e.job), ['A']);
});

test('voidHead is an append-only tombstone: hidden from live/active, kept in history', () => {
  const cfg = defaultConfig();
  const a = newEntry({ job: 'J', status: 'current', change: 'oops' });
  let list = [a];
  list = voidHead(list, a.id);
  assert.equal(liveHeads(list).length, 0);          // gone from the Log
  assert.equal(activeHeads(list, cfg).length, 0);   // gone from Active
  assert.equal(headsOf(list)[0].voided, true);      // head is the tombstone
  assert.equal(chainOf(list, a.id).length, 2);      // history preserved
  assert.equal(chainOf(list, a.id)[0].change, 'oops');
});

test('contentHash is deterministic and identity-sensitive', () => {
  const base = { job: 'J', category: 'current', who: 'A', type: 'Task', change: 'c', reason: 'r', date: 'D' };
  assert.equal(contentHash(base), contentHash({ ...base }));
  assert.notEqual(contentHash(base), contentHash({ ...base, change: 'c2' }));
});

test('supersede carries the voided flag forward (no silent un-void)', () => {
  const a = newEntry({ job: 'J', status: 'current', change: 'x' });
  let list = [a];
  list = voidHead(list, a.id);
  const voidedHead = headsOf(list)[0];
  assert.equal(voidedHead.voided, true);
  const after = supersede(list, voidedHead.id, { change: 'y' });
  assert.equal(headsOf(after)[0].voided, true);   // still voided
  assert.equal(liveHeads(after).length, 0);
});

test('restoreHead un-voids a tombstone, preserving history', () => {
  const cfg = defaultConfig();
  const a = newEntry({ job: 'J', status: 'current', change: 'keep me', reason: 'r' });
  let list = [a];
  list = voidHead(list, a.id);
  assert.equal(liveHeads(list).length, 0);
  const restored = restoreHead(list, headsOf(list)[0].id);
  const head = headsOf(restored)[0];
  assert.equal(head.voided, undefined);            // live again
  assert.equal(head.change, 'keep me');            // content carried
  assert.equal(head.reason, 'r');
  assert.equal(liveHeads(restored).length, 1);
  assert.equal(activeHeads(restored, cfg).length, 1);
  assert.equal(chainOf(restored, a.id).length, 3); // create -> void -> restore
});

test('restoreHead no-ops on a non-voided or unknown head', () => {
  const a = newEntry({ job: 'J', status: 'current', change: 'x' });
  const list = [a];
  assert.equal(restoreHead(list, a.id), list);     // not voided
  assert.equal(restoreHead(list, 'nope'), list);   // unknown
});

test('completeEntry honors completeTarget regardless of status order', () => {
  const config = defaultConfig();
  // A tenant reorders Cancelled above Completed to tidy their list. Before
  // `completeTarget` existed, this silently made every ✓ tap mark items CANCELLED.
  config.statuses = [
    { id: 'current',   label: 'Current',   color: '#58a6ff', closes: false },
    { id: 'cancelled', label: 'Cancelled', color: '#8b949e', closes: true  },
    { id: 'completed', label: 'Completed', color: '#3fb950', closes: true  },
  ];
  const e = newEntry({ job: 'J', status: 'current', change: 'c' });
  const after = completeEntry([e], e.id, config);
  assert.equal(after.length, 2);
  assert.equal(after[0].category, 'completed'); // NOT 'cancelled'
  assert.equal(after[0].supersedes, e.id);
});

test('completeEntry falls back to the first closing status when the target is broken', () => {
  const config = { ...defaultConfig(), completeTarget: 'nonexistent' };
  const e = newEntry({ job: 'J', status: 'current', change: 'c' });
  const after = completeEntry([e], e.id, config);
  assert.equal(after[0].category, 'completed');
});

test('completeEntry is a no-op when no status closes', () => {
  const config = { ...defaultConfig(), statuses: [{ id: 'a', label: 'A', color: '#fff', closes: false }] };
  const e = newEntry({ job: 'J', status: 'a', change: 'c' });
  const list = [e];
  assert.equal(completeEntry(list, e.id, config), list);
});

test('type is carried forward across supersede, void and restore', () => {
  const config = defaultConfig();
  const e = newEntry({ job: 'J', status: 'current', type: 'rfi', change: 'c' });
  const sup = supersede([e], e.id, { change: 'edited' });
  assert.equal(sup[0].type, 'rfi');
  const done = completeEntry(sup, sup[0].id, config);
  assert.equal(done[0].type, 'rfi');
  const gone = voidHead(done, done[0].id);
  assert.equal(gone[0].type, 'rfi');
  const back = restoreHead(gone, gone[0].id);
  assert.equal(back[0].type, 'rfi');
});

test('supersede cannot change type even when a patch supplies one', () => {
  const e = newEntry({ job: 'J', status: 'current', type: 'rfi', change: 'c' });
  const sup = supersede([e], e.id, { type: 'submittal', status: 'on-hold' });
  assert.equal(sup[0].type, 'rfi');       // immutable — carried forward
  assert.equal(sup[0].category, 'on-hold'); // status is one of the three mutable fields
});

// ── Seq-aware fork resolution ───────────────────────────────────────────────

// Hand-built synced/unsynced entries: fork fixtures need two successors for one
// predecessor, which the local API (supersede via headOf) can never produce.
function synced(id, supersedes, seq, extra = {}) {
  return { ...newEntry({ job: 'J', status: 'current', change: id }), id, supersedes, seq, ...extra };
}
function unsynced(id, supersedes, extra = {}) {
  return { ...newEntry({ job: 'J', status: 'current', change: id }), id, supersedes, ...extra };
}

test('forkWinner: unsynced beats synced, then highest seq, then greater id', () => {
  const s5 = synced('s5', '', 5);
  const s7 = synced('s7', '', 7);
  const u1 = unsynced('u1', '');
  const u2 = unsynced('u2', '');
  assert.equal(forkWinner(s5, s7).id, 's7');   // highest seq wins
  assert.equal(forkWinner(s7, s5).id, 's7');   // symmetric
  assert.equal(forkWinner(s7, u1).id, 'u1');   // unsynced beats any seq
  assert.equal(forkWinner(u1, s7).id, 'u1');
  assert.equal(forkWinner(u1, u2).id, 'u2');   // last resort: greater id
  assert.equal(forkWinner(u2, u1).id, 'u2');
});

test('resolvedHeadsOf: highest seq wins the fork; loser stays as history, not a head', () => {
  const root = synced('root', '', 1);
  const a = synced('a', 'root', 5);   // device A's edit
  const b = synced('b', 'root', 7);   // device B's edit — synced later, wins
  const list = [b, a, root];
  const heads = resolvedHeadsOf(list);
  assert.equal(heads.length, 1);                       // ONE head (headsOf would say two)
  assert.equal(heads[0].id, 'b');
  assert.equal(headsOf(list).length, 2);               // the undefined single-device view
  assert.equal(list.length, 3);                        // loser `a` remains in the set
});

test('resolvedHeadOf resolves to the canonical head even when asked from the losing branch', () => {
  const root = synced('root', '', 1);
  const a = synced('a', 'root', 5);
  const b = synced('b', 'root', 7);
  const list = [b, a, root];
  assert.equal(resolvedHeadOf(list, 'a').id, 'b');     // loser → the chain's real head
  assert.equal(resolvedHeadOf(list, 'root').id, 'b');
  assert.equal(resolvedHeadOf(list, 'b').id, 'b');
  assert.equal(resolvedHeadOf(list, 'nope'), undefined);
});

test('a sub-chain built on the losing branch never re-enters the head path', () => {
  const root = synced('root', '', 1);
  const a = synced('a', 'root', 5);      // loses the fork at root
  const a2 = synced('a2', 'a', 9);       // device A kept editing — seq even beats b's
  const b = synced('b', 'root', 7);      // still wins: the rule applies AT the fork point
  const list = [a2, b, a, root];
  const heads = resolvedHeadsOf(list);
  assert.equal(heads.length, 1);
  assert.equal(heads[0].id, 'b');
  assert.equal(resolvedHeadOf(list, 'a2').id, 'b');    // even asked from the sub-chain
});

test('an unsynced local successor wins a fork against any synced seq', () => {
  const root = synced('root', '', 1);
  const s = synced('s', 'root', 99);
  const u = unsynced('u', 'root');       // pending push — will outrank 99 once it lands
  const list = [u, s, root];
  assert.equal(resolvedHeadsOf(list).length, 1);
  assert.equal(resolvedHeadsOf(list)[0].id, 'u');
});

test('resolvedLiveHeads/resolvedActiveHeads apply tombstone + closes rules to the resolved head', () => {
  const cfg = defaultConfig();
  const root = synced('root', '', 1);
  const kept = synced('kept', 'root', 5);
  const tomb = synced('tomb', 'root', 7, { voided: true }); // winning branch is a tombstone
  const other = synced('other', '', 8, { job: 'K', category: 'completed' });
  const list = [other, tomb, kept, root];
  assert.equal(resolvedHeadsOf(list).length, 2);            // one head per chain
  assert.deepEqual(resolvedLiveHeads(list).map((e) => e.id), ['other']); // tombstone hidden
  assert.equal(resolvedActiveHeads(list, cfg).length, 0);   // 'other' is completed
  const restored = synced('back', 'tomb', 9);               // restore supersedes the tombstone
  assert.deepEqual(resolvedLiveHeads([restored, ...list]).map((e) => e.id), ['back', 'other']);
});

test('without forks or seqs the resolved functions degrade exactly to the single-device ones', () => {
  const cfg = defaultConfig();
  const a = newEntry({ job: 'A', status: 'current', change: 'a' });
  const b = newEntry({ job: 'B', status: 'completed', change: 'b' });
  let list = [b, a];
  list = supersede(list, a.id, { change: 'a2' });
  list = voidHead(list, b.id);
  assert.deepEqual(resolvedHeadsOf(list), headsOf(list));
  assert.deepEqual(resolvedLiveHeads(list), liveHeads(list));
  assert.deepEqual(resolvedActiveHeads(list, cfg), activeHeads(list, cfg));
  assert.deepEqual(resolvedHeadOf(list, a.id), headOf(list, a.id));
});

test('any arrival order resolves to the same heads (parity fixture, all permutations)', () => {
  // One chain with a fork, a losing sub-chain, a tombstoned+restored fork
  // winner, and an unsynced local tip — the messiest shape sync can produce.
  const fixture = [
    synced('root', '', 1),
    synced('a', 'root', 3),               // loses the fork
    synced('a2', 'a', 8),                 // sub-chain on the loser
    synced('b', 'root', 4, { voided: true }), // wins the fork, then tombstoned…
    synced('b2', 'b', 6),                 // …restored
    unsynced('u', 'b2'),                  // local pending edit on the winner
    synced('solo', '', 7, { job: 'K' }),  // second, fork-free chain
  ];
  const permutations = (arr) => arr.length <= 1 ? [arr] :
    arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
  const headIds = (list) => resolvedHeadsOf(list).map((e) => e.id).sort();
  const liveIds = (list) => resolvedLiveHeads(list).map((e) => e.id).sort();
  assert.deepEqual(headIds(fixture), ['solo', 'u']);
  for (const p of permutations(fixture)) {
    assert.deepEqual(headIds(p), ['solo', 'u']);
    assert.deepEqual(liveIds(p), ['solo', 'u']);
    assert.equal(resolvedHeadOf(p, 'a2').id, 'u');
  }
});

test('a partial pull (missing predecessor) treats the orphan as a root and still resolves', () => {
  const a = synced('a', 'not-pulled-yet', 5);
  const b = synced('b', 'a', 6);
  assert.deepEqual(resolvedHeadsOf([b, a]).map((e) => e.id), ['b']);
});

// ── jobRollup: the Active screen's GROUP BY, with the F3 own/peer open split ──

const cfg = defaultConfig;
const isPeer = (e) => Boolean(e && e.shareId);
// Heads must arrive newest-first, as liveHeads produces them.
const head = (id, over = {}) => ({
  ...newEntry({ job: 'J1', status: 'current', change: id }), id, ...over,
});

test('jobRollup groups by job, newest-first, keeping each job latest head', () => {
  const rows = jobRollup([
    head('b', { job: 'J2', date: '2026-07-13 Mon 12:00' }),
    head('a', { job: 'J1', date: '2026-07-13 Mon 09:00' }),
    head('a0', { job: 'J1', date: '2026-07-12 Sun 09:00' }),
  ], cfg, isPeer);
  assert.deepEqual(rows.map((r) => r.job), ['J2', 'J1']); // last-touched desc
  assert.equal(rows[1].latest.id, 'a');
  assert.equal(rows[1].count, 2);
});

test('jobRollup counts a closing status as closed, not open', () => {
  const [row] = jobRollup([
    head('done', { category: 'completed' }),
    head('open'),
  ], cfg, isPeer);
  assert.equal(row.count, 2);
  assert.equal(row.openCount, 1);
});

test('jobRollup splits open loops into ours vs the peer\'s — a peer loop is never ours to close', () => {
  const [row] = jobRollup([
    head('mine-open'),
    head('peer-open', { shareId: 'sA' }),
    head('peer-open-2', { shareId: 'sA' }),
    head('peer-done', { shareId: 'sA', category: 'completed' }),
  ], cfg, isPeer);
  assert.equal(row.count, 4);          // all four are the job's loops
  assert.equal(row.openCount, 1);      // only ours can be bulk-closed
  assert.equal(row.peerOpenCount, 2);  // visible, but read-only
});

test('jobRollup: a job whose only open loops are the peer\'s has openCount 0 (CLOSE JOB must not offer itself)', () => {
  const [row] = jobRollup([
    head('peer-open', { shareId: 'sA' }),
    head('mine-done', { category: 'completed' }),
  ], cfg, isPeer);
  assert.equal(row.openCount, 0);
  assert.equal(row.peerOpenCount, 1);
});

test('jobRollup without a peer predicate counts every head as ours (the local-only case)', () => {
  const [row] = jobRollup([head('a'), head('b')], cfg);
  assert.equal(row.openCount, 2);
  assert.equal(row.peerOpenCount, 0);
});

// ── jobKey + the case-insensitive rollup (2026-09-21) ────────────────────────

test('jobKey folds case and trims, and does NOT collapse interior spacing', () => {
  assert.equal(jobKey('24-118 Imaging Suite Fit-Out'), jobKey('24-118 imaging suite fit-out'));
  assert.equal(jobKey('  25-044  '), '25-044');
  assert.notEqual(jobKey('A B'), jobKey('A  B'));
  assert.equal(jobKey(undefined), '');
});

test('jobRollup folds job strings that differ only in case or padding — the 11-to-8 finding', () => {
  // A seed corpus holds 11 raw job strings for 8 jobs, because a thumb on a
  // phone retypes a job number differently inside a week. Before this, Active showed
  // 11 rows and Charts 11 sections, splitting one job's open loops across two lines.
  const rows = jobRollup([
    head('a', { job: '24-118 Imaging Suite Fit-Out', date: '2026-09-18 Fri 16:00' }),
    head('b', { job: '24-118 imaging suite fit-out', date: '2026-09-17 Thu 09:00' }),
    head('c', { job: ' 24-118 Imaging Suite Fit-Out ', date: '2026-09-16 Wed 09:00' }),
  ], cfg, isPeer);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 3);
  assert.equal(rows[0].openCount, 3);
  // Display is the NEWEST head's raw string — the user sees what they last typed, not
  // a lowercased normal form nobody wrote.
  assert.equal(rows[0].job, '24-118 Imaging Suite Fit-Out');
  assert.equal(rows[0].key, '24-118 imaging suite fit-out');
});

test('jobRollup still keeps genuinely different jobs apart', () => {
  const rows = jobRollup([
    head('a', { job: '24-118', date: '2026-09-18 Fri 16:00' }),
    head('b', { job: '24-119', date: '2026-09-17 Thu 09:00' }),
  ], cfg, isPeer);
  assert.equal(rows.length, 2);
});
