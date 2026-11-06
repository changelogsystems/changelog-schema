# CHANGELOG schema v1 (`changelog/v1`)

**Status:** draft, written from the reference implementation in `src/`. Normative wherever it says MUST, SHOULD or MAY. Every rule cites the line of code it was read from (`src/<module>.mjs:<line>`). **Where this document and the code disagree, the code is right and this document is wrong.** Please report it.

CHANGELOG is a record of job-level changes: delays, blocks, scope changes, completions, logged against a project by the people doing the work. This spec defines the record, its append-only history, the vocabulary it's written in, and a plain-text table for moving it between tools. It doesn't depend on any particular host: a phone app, a notes vault, a spreadsheet and a server can all implement it. The Obsidian plugin is one example integration.

Contents: [1 Entries](#1-entries) · [2 Timestamps](#2-timestamps) · [3 Ids](#3-ids) · [4 History](#4-history-append-only-chains) · [5 Forks](#5-forks-two-devices-one-head) · [6 Vocabulary](#6-vocabulary-the-config) · [7 The interchange table](#7-the-interchange-table) · [8 Importing a table](#8-importing-a-table) · [9 The config as markdown](#9-the-config-as-markdown) · [10 CSV](#10-csv-one-way) · [11 Migration](#11-migration) · [12 Known limits](#12-known-limits-of-v1) · [13 Where the code and older notes disagree](#13-where-the-code-and-older-notes-disagree)

---

## 1 · Entries

**1.1** An entry is a flat record with these fields (`src/entries.d.mts:8-26`; constructed by `newEntry`, `src/entries.mjs:10-23`):

| field | meaning | default when created |
|---|---|---|
| `id` | the entry's identity (§3) | a new id (`entries.mjs:12`) |
| `supersedes` | the `id` this entry replaces, or `''` for the first entry in a chain (§4) | `''` (`:13`) |
| `date` | when this entry was appended (§2) | now (`:14`) |
| `job` | the project it belongs to, free text | `''` (`:15`) |
| `category` | the **status** (§6) | `''` (`:16`) |
| `who` | the **area of work** (§6) | `''` (`:17`) |
| `type` | the **type** (§6), optional | `''` (`:18`) |
| `change` | what changed, free text | `''` (`:19`) |
| `reason` | why, free text | `''` (`:20`) |
| `by` | a display name for who logged it. It is **not** identity | `'owner'` (`:21`) |
| `voided` | present and `true` on a tombstone (§4.5) | absent |
| `seq` | a server-assigned sequence, present only on synced entries (§5) | absent (`entries.d.mts:20-21`) |

**1.2** The stored keys `category` and `who` are intentionally different from their display names, *Status* and *Area of Work*. Implementations MUST keep the stored keys (`entries.mjs:16-17`) and MAY label them however they like.

**1.3** A reader MUST tolerate fields it doesn't know. A sync layer may add its own (`shareId` is one, `entries.d.mts:22-25`; it's client-only and never part of the interchange).

**1.4** Entry lists are **newest first**: every operation in §4 prepends (`entries.mjs:75`, `:122`, `:145`). So the first match for a job in a list is its latest entry.

**1.5** The project identity used for grouping is the `job` string **trimmed and lower-cased**; interior spacing is significant (`jobKey`, `entries.mjs:34-36`). A display SHOULD show the newest entry's raw string (`jobRollup`, `:190-210`).

## 2 · Timestamps

**2.1** `date` is `YYYY-MM-DD ddd HH:mm` with an English three-letter weekday, for example `2026-05-19 Tue 21:04` (`formatTimestamp`, `src/time.mjs:5-14`).

**2.2** It is the writer's **local** wall-clock time and carries **no time zone** (`time.mjs:7-12` read local `getFullYear`/`getHours`).

**2.3** It sorts chronologically as plain text, and implementations MAY sort on it that way (`entries.mjs:218-220`). It MUST NOT be used as identity (§3), and it orders nothing across devices: synced order is `seq` (§5).

## 3 · Ids

**3.1** An `id` is an opaque, globally unique string. New ids SHOULD be a platform UUID; where none is available, a time-plus-random token (`makeId`, `src/ids.mjs:5-10`).

**3.2** A v1 id never contains whitespace. Anything that does is a pre-v1 timestamp id (`isGlobalId`, `ids.mjs:15-17`), and migration replaces it (§11.1).

**3.3** Identity is the `id` alone. Edits, voids, de-duplication of synced entries and sync acknowledgements all match on it.

## 4 · History: append-only chains

Nothing in a log is changed in place or removed. Every change is a new entry.

**4.1 · Edit.** An edit appends a new entry whose `supersedes` is the current head's `id` (`supersede`, `src/entries.mjs:59-76`). Only `category` (status), `change` and `reason` may differ from the head (`:70-72`). `job`, `who`, `type` and `by` MUST be carried forward unchanged (`:66-69`). The new entry gets its own `date` (`:65`), so a chain shows when each step happened.

**4.2 · Head.** A chain's **head** is its newest entry: the one no other entry supersedes (`headsOf`, `entries.mjs:44-47`; `headOf` follows `supersedes` forward from any member, `:49-57`). A chain read root to head is `chainOf` (`:87-98`).

**4.3 · Complete.** "Complete" is an edit whose status is the config's completion target (§6.4) (`completeEntry`, `entries.mjs:81-85`). If the config names no reachable terminal status, completing does nothing.

**4.4 · Closed.** A head is **closed** when its status has `closes: true` in the config (`closesFor`, `src/config.mjs:111-115`). A status the config doesn't know is closed only if its slug is `completed` or `cancelled` (`:109`, `:114`), so pre-v1 entries stay closed without being rewritten. Implementations MUST derive closed-ness this way and never from a fixed list of statuses (`partitionClosed`, `entries.mjs:158-163`; `activeHeads`, `:165-167`).

**4.5 · Void.** Deleting is a **tombstone**: an edit that copies the head and sets `voided: true` (`voidHead`, `entries.mjs:111-123`). A voided head drops out of live views (`liveHeads`, `:103-105`) and stays in the history. Voiding is not the `cancelled` status: a cancelled entry is a real outcome and stays visible.

**4.6 · Voided stays voided.** Editing a voided chain carries `voided` forward (`entries.mjs:73`), so an edit can never bring a deleted chain back.

**4.7 · Restore.** The only way to clear `voided` is a **restore**: a new live head that supersedes the tombstone and carries its content forward (`restoreHead`, `entries.mjs:130-146`). It does nothing if the head isn't voided (`:132`). The void stays in the chain.

## 5 · Forks: two devices, one head

**5.1** Two devices offline can each supersede the same head, so a synced set may hold two successors for one entry. Readers that see synced data MUST resolve this with `forkWinner` at **each** fork point, walking root to tip (`src/entries.mjs:234-266`):

1. an entry with no `seq` (not yet synced) beats one with a `seq` (`:261`);
2. otherwise the higher `seq` wins (`:262-264`);
3. otherwise the lexicographically greater `id` wins (`:265`).

**5.2** The losing branch, including anything built on it, stays in the set as history and never becomes the head (`winningSuccessors`, `:270-278`; `resolvedHeadOf`, `:284-292`; `resolvedHeadsOf`, `:298-309`).

**5.3** The result depends only on `seq` and `id`, never on array order (`:254-257`). With no forks and no `seq`, it is the same as §4.2.

**5.4** `resolvedLiveHeads` and `resolvedActiveHeads` apply §4.4 and §4.5 to resolved heads (`:313-320`).

## 6 · Vocabulary: the config

A workspace's vocabulary is its **config**: statuses, types and areas, each a list of `{ id, label, color }` (`src/config.d.mts:6-18`; defaults `defaultConfig`, `src/config.mjs:44-80`).

**6.1 · Identity.** A member's `id` never changes. Renaming changes `label` only. An entry stores the **id** (`importer.mjs:131`, `:135-136`), and a display shows the label (`labelFor`, `config.mjs:213-218`).

**6.2 · Resolution.** A raw token resolves to a member if it equals the member's `id` **or** the slug of its `label`, after stripping one leading `#` (`resolveVocabId`, `config.mjs:198-203`; `statusSlug`, `:97-99`; `slugId`, `:7-14`). A token that doesn't resolve is **never** turned into a new member: it passes through verbatim for display (`labelFor`, `:213-218`) and is quarantined on import (§8.3).

**6.2a · The slug.** The slug of a string is made in this order (`slugId`, `config.mjs:7-14`): trim it; lower-case it; replace each run of whitespace with `-`; delete every character that isn't `a`–`z`, `0`–`9` or `-`; collapse runs of `-` into one; strip a leading or trailing `-`. So `On Hold`, ` on  hold ` and `#On Hold` (after the `#` is stripped) all slug to `on-hold`, while `on_hold` slugs to `onhold` and doesn't match it. A string with no ASCII letters or digits slugs to `''`.

**6.3 · Statuses.** A bare list. Each has `closes` (§4.4). The shipped defaults are (`config.mjs:48-54`):

| id | label | closes |
|---|---|---|
| `to-do` | To-Do | no |
| `current` | Current | no |
| `on-hold` | On Hold | no |
| `completed` | Completed | **yes** |
| `cancelled` | Cancelled | **yes** |

**6.4 · Completion target.** `completeTarget` names the status "Complete" moves to (`config.mjs:57`). If it's missing or no longer closes, the first closing status is used (`completeTargetStatus`, `:239-243`). The target MUST NOT be removed or have `closes` turned off (`isCompleteTarget`, `:247-249`). Reordering statuses never retargets completion.

**6.5 · Types and areas** are `{ mode, set }` (`config.mjs:61`, `:68-78`). `mode` is one of `managed`, `freeform` or `off` (`VOCAB_MODES`, `:34-42`):
- `managed`: a token must resolve to a member of `set`;
- `freeform`: any token is accepted;
- `off`: the axis is hidden. An empty value is never rejected on any mode (`:39-41`).

**6.6 · Shipped type defaults.** The type axis ships **`off`**, with six **construction** types seeded so turning it on offers them at once (`config.mjs:62-78`): Task, Submittal, RFI, Material, Field-Dim, Conflict (ids `task`, `submittal`, `rfi`, `material`, `field-dim`, `conflict`). These six are the only types this library ships (§13.1).

**6.7 · Areas** ship `freeform` with an empty set (`config.mjs:61`).

**6.8 · Comparing types.** Code that compares or groups by type MUST use `typeKey` (`config.mjs:231-233`): a managed member's id, else the slug, else the trimmed token. `''` means untyped. A token with no ASCII letters or digits keys as itself, so it's never "untyped".

**6.9** `schema` is `'changelog/v1'` and `tenant` defaults to `'local'` (`config.mjs:46-47`). Colours come from an eight-hue palette (`VOCAB_PALETTE`, `:18-27`; `nextVocabColor`, `:29-32`). Colour is presentation and carries no meaning.

## 7 · The interchange table

**7.1** The plain-text exchange format is a Markdown table with exactly these seven columns, in this order (`src/exporter.mjs:26-27`):

```
| Date | Project | Type | Status | Area of Work | Change | Reason |
| --- | --- | --- | --- | --- | --- | --- |
```

**7.2** Each row writes `date`, `job`, the **label** of `type`, the label of `category` and the label of `who`, then `change` and `reason` (`toEntriesTable`, `exporter.mjs:31-38`). An unresolvable token is written as-is (`config.mjs:213-218`), and an empty type is an empty cell.

**7.3** In a cell, a line break becomes one space and a `|` is written `\|` (`cell`, `exporter.mjs:20-24`). The table is plain text: nothing is HTML-escaped.

**7.4** The table carries **no `id`, no `supersedes` and no `voided`.** It is a view of entries, not a copy of the log. See §12.1.

## 8 · Importing a table

**8.1 · Finding the table.** The header is the first table row that holds both a `Date` column and a project column. The project column is `Project` or the legacy `Job` (`canonHeader`, `src/importer.mjs:37-47`; `parseTable`, `:53-63`). Columns are matched **by name**, case-insensitively, so the legacy six-column table (no Type; `Area of Work` or `Area`) and a reordered table both parse (`:33-36`, `:65-69`). Prose around the table is ignored.

**8.2 · Rows.** Separator rows are skipped (`:31`, `:75`). The table ends at the first line that doesn't start with `|` (`:74`). Cells are split on unescaped `|` and `\|` becomes `|` (`splitRow`, `:12-26`; `:28`).

**8.3 · Normalising** (`normalizeImport`, `importer.mjs:109-164`):
- **status** MUST resolve (§6.2), or the row is **quarantined** (`:117-118`);
- **type**: on a `managed` or `off` axis it MUST resolve or the row is quarantined; on `freeform` it's accepted, and stored as the member's id when it resolves (`:120-138`);
- **area**: on a `managed` axis it MUST resolve or the row is quarantined; otherwise the raw text is kept (`:140-147`);
- an importer MAY take a reviewer's mapping of an unmatched token to an **existing** member (`overrides`, `:105-108`, `:114`). It never creates a member.

**8.4 · De-duplication.** A table row has no id, so a row's identity is a fingerprint of job, status, area, type, change, reason and date (`contentHash`, `src/entries.mjs:224-232`). A row whose fingerprint is already in the log, or earlier in the same paste, is skipped (`importer.mjs:113`, `:153-155`). Re-importing the same table adds nothing. A new row gets a new id (`:157-160`).

## 9 · The config as markdown

**9.1** A config is written as a YAML block between `---` fences (`toConfigMarkdown`, `src/exporter.mjs:135-137`). The same block MAY head an entry file, followed by the table: a **self-describing file** (`toEntryFile`, `:142-145`), whole-log or for one project.

**9.2 · Grammar.** The block is (`configYaml`, `exporter.mjs:106-131`):

```yaml
schema: changelog/v1
tenant: local
completeTarget: completed
statuses:
  - { id: to-do, label: To-Do, color: "#a371f7", closes: false }
areas:
  mode: freeform
  set: []
types:
  mode: off
  set:
    - { id: task, label: Task, color: "#bc8cff" }
```

- Colours are always double-quoted (`:98`).
- A label is written bare when it's an **everyday label**, and as a YAML double-quoted string otherwise, with `\`, `"`, newline and tab escaped (`labelYaml`, `:81-92`). An everyday label starts with an ASCII letter or digit; contains only ASCII letters, digits, spaces and `. _ ( ) / & ' -`; doesn't end in a space, `(`, `/`, `&` or `-`; and isn't one of the YAML keywords `true`, `false`, `yes`, `no`, `on`, `off`, `null` or `~` in any case (`:86-87`). This was fixed in this library on 2026-11-05; see §13.4.
- That is the whole grammar: top-level `key: value` lines; `statuses` as a list of one-line `{ … }` flow maps; `areas` and `types` as two-space-indented `mode:` and `set:`, with `set` either `[]` or a list of flow maps one indent deeper. Nothing else is written, and a reader need accept nothing else.

**9.3 · Reading.** `parseConfigMarkdown` reads exactly that grammar (`src/config-md.mjs:88`):
- a quoted value is read to its closing quote and is never coerced (`readQuoted`, `:30-47`; `:49-71`);
- a bare value runs to the next `key:`, so files written before labels were quoted still read (`:24-25`, `:64-68`).
It is not a general YAML parser.

**9.4 · Which config applies.** When a reader has several, the order is: the standalone config file, then the block heading the entry file, then the defaults. Whichever wins is run through `migrateConfig` (§11.2) (`resolveConfig`, `config-md.mjs:139`).

## 10 · CSV (one way)

**10.1** The same seven columns, in the same order and with the same labels, MAY be written as CSV (`toEntriesCsv`, `src/exporter.mjs:60-79`).

**10.2** It follows RFC 4180: a field is quoted when it holds a comma, a quote or a line break; quotes double; line breaks inside a field are kept; records end in CRLF (`csvField`, `:63-67`; `:78`).

**10.3** A field beginning with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'`, so a spreadsheet won't run it as a formula (`:61`, `:65`). This changes the file, not the record.

**10.4** CSV is **one-way**: there is no CSV importer, and a round trip isn't promised (`:44-45`).

## 11 · Migration

**11.1 · Entries** (`migrateEntries`, `src/migrate.mjs:9-23`):
- a pre-v1 id (one with whitespace, §3.2) gets a new id;
- missing `supersedes`, `by` and `type` get `''`, `'owner'` and `''`;
- stored statuses are **never** rewritten (`:3-5`): normalising old values is the importer's quarantine step, not migration.
It's idempotent.

**11.2 · Config** (`migrateConfig`, `src/config.mjs:141-180`) is additive and idempotent, and touches only the config, never entries:
- a config with no `types` key gets the default (off, seeded) (`:147-151`);
- string vocabulary members are promoted to `{ id, label, color }` with unused palette colours (`promoteSet`, `:117-132`);
- a missing `completeTarget` becomes the first closing status (`:169-174`);
- legacy area chips are folded in once, guarded by `areasSeeded` (`:155-165`).

**11.3 · Colours.** The one legacy default colour, `#3b82f6`, is rewritten to the palette blue on statuses and types. Every other colour is left alone (`migrateVocabColors`, `src/migrate.mjs:34-58`).

**11.4 · Pre-v1 status chips** seed extra statuses (`buildConfig`, `src/migrate.mjs:66-86`). The pre-v1 defaults `start`, `delayed`, `blocked`, `scope-change`, `interruption` and `idea` are **not** statuses in v1 and aren't re-added (`:60-64`).

## 12 · Known limits of v1

**12.1 · The table can't carry an edit.** Because the table has no id (§7.4), completing a loop in one tool and importing the closing row elsewhere produces two independent entries, the open one and the closed one, not a chain (`importer.mjs:101-103`). A reader of that import will still show the loop open. An optional eighth `id` column has been proposed as the v1.1 fix. **It isn't part of v1**, and v1 readers MUST keep matching columns by name (§8.1), so an extra column is harmless.

**12.2** The importer reads Markdown only (§10.4).

**12.3 · The de-duplication fingerprint is small.** `contentHash` is a 32-bit, non-cryptographic hash (`src/entries.mjs:224-232`). Two different rows that happen to share a fingerprint would make the importer skip the second as a duplicate (§8.4). That's rare in practice, but it isn't impossible.

## 13 · Where the code and older notes disagree

The code wins in every case below.

**13.1 · Only six types ship.** Earlier descriptions of CHANGELOG mention more. `defaultConfig` ships the six construction types, off (`config.mjs:62-78`); any other type is added to a config like any member (§6.1).

**13.2 · The type axis default** was `managed` until 2026-10-02 and is `off` since (`config.mjs:62-67`). `legacyDefaultConfigs` keeps the old default recognisable (`:82-89`). A stored config keeps whatever mode it has.

**13.3 · The project column** was headed `Job` until 2026-10-01 and is `Project` since (`exporter.mjs:6-8`). Readers MUST accept both (`importer.mjs:40`).

**13.4 · Label quoting.** The CHANGELOG app's own copy of `exporter.mjs` still writes labels bare (the 2026-11-05 fix is in this repository first; see README → *Staying identical to the app*). A file it writes is still readable here (§9.3).
