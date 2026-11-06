# changelog-schema

The schema behind [CHANGELOG](https://changelog.systems): a record of job-level changes (delays, blocks, scope changes, completions) logged against a project by the people doing the work. It's append-only, so nothing is edited in place and nothing is lost, and it moves between tools as a plain seven-column table.

This repository has two parts:

- **[SPEC.md](SPEC.md)**: the format, `changelog/v1`, written down rule by rule with a citation into the code for each.
- **`src/`**: the reference library. Plain JavaScript modules with no dependencies, which read and write the format on any JavaScript runtime.

Anything can implement the format: a phone app, a notes vault, a spreadsheet macro, a server. The CHANGELOG Obsidian plugin is one example.

## Install

Not published to a registry yet. From source:

```sh
git clone <this repository>
cd changelog-schema
npm test          # Node 22 or later; no install step, there are no dependencies
```

Then import from `src/index.mjs`, or one module at a time (`src/entries.mjs`, `src/importer.mjs`, …). `package.json` lists them under `exports`.

## Example

```js
import { defaultConfig, newEntry, completeEntry, liveHeads, toEntriesTable, parseTable, normalizeImport } from './src/index.mjs';

const config = defaultConfig();
let log = [newEntry({ job: '24-118 North Wing', status: 'current', change: 'Panel delivery slipped', reason: 'Supplier backlog' })];
log = completeEntry(log, log[0].id, config);          // appends a closing entry; the first one stays as history

const table = toEntriesTable(liveHeads(log), config); // | Date | Project | Type | Status | Area of Work | Change | Reason |
const { entries } = normalizeImport(parseTable(table), config, log);
console.log(entries.length);                          // 0: re-importing your own table adds nothing
```

## What's in `src/`

| module | what it does |
|---|---|
| `entries` | the entry record and its history: edit, complete, void, restore, heads, forks between devices |
| `config` | the vocabulary (statuses, types, areas), its defaults, and how a token resolves to a member |
| `exporter` | the seven-column table, CSV, and the config as markdown |
| `importer` | reads a table back, quarantines what it can't place, skips duplicates |
| `config-md` | reads the config back out of markdown |
| `migrate` | brings older stored data up to v1 |
| `ids`, `time` | ids and the timestamp format |

## Staying identical to the app

The CHANGELOG app keeps its own copy of this library in `lib/schema`, and the server compiles that copy too. The two have to stay the **same library**. The rule is:

1. Every file the two share is byte-identical, **except** the ones listed in [`scripts/app-divergence.json`](scripts/app-divergence.json), each with its reason. Today that's one: `exporter.mjs`, whose label-quoting fix (2026-11-05) landed here first.
2. A change to a shared file lands in **both** places, and the divergence list shrinks back to empty when it does.
3. Check it with a CHANGELOG app checkout next to this one:
   ```sh
   node scripts/check-app-sync.mjs                                   # ../changelog-app/lib/schema
   node scripts/check-app-sync.mjs --repo ../changelog-app --ref origin/staging
   ```
   It fails on any difference that isn't listed, and on a listed one that has gone away.

The check runs by hand, not in CI: the app's repository is private, so a public CI job can't see it.

## Licence

MIT. See [LICENSE](LICENSE).
