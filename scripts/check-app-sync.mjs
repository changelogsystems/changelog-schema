#!/usr/bin/env node
// Is src/ the same library as the CHANGELOG app's lib/schema?
//
//   node scripts/check-app-sync.mjs                         # ../changelog-app/lib/schema (a working tree)
//   node scripts/check-app-sync.mjs --app <dir>             # any lib/schema directory
//   node scripts/check-app-sync.mjs --repo <dir> --ref <r>  # lib/schema at a git ref, via `git show`
//
// Every file the two share must be byte-identical, except those listed in
// scripts/app-divergence.json with a reason. Fails (exit 1) on an unlisted difference,
// on a file present on one side only that isn't listed as package-only, and on a listed
// divergence that is no longer a difference (the list must not go stale).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const allow = JSON.parse(readFileSync(join(ROOT, 'scripts', 'app-divergence.json'), 'utf8'));
const argv = process.argv.slice(2);
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };

const isSchemaFile = (f) => f.endsWith('.mjs') || f.endsWith('.d.mts');

let appFiles;
let readApp;
let label;
if (opt('--ref')) {
  const repo = resolve(opt('--repo') || join(ROOT, '..', 'changelog-app'));
  const ref = opt('--ref');
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'buffer', maxBuffer: 1 << 26 });
  appFiles = git('ls-tree', '--name-only', ref, 'lib/schema/').toString().split('\n').filter(Boolean)
    .map((p) => p.replace(/^lib\/schema\//, '')).filter(isSchemaFile);
  readApp = (f) => git('show', `${ref}:lib/schema/${f}`);
  label = `${repo} @ ${ref}`;
} else {
  const dir = resolve(opt('--app') || join(ROOT, '..', 'changelog-app', 'lib', 'schema'));
  if (!existsSync(dir)) { console.error(`✗ not found: ${dir} (pass --app <lib/schema dir> or --repo/--ref)`); process.exit(2); }
  appFiles = readdirSync(dir).filter(isSchemaFile);
  readApp = (f) => readFileSync(join(dir, f));
  label = dir;
}

const ours = readdirSync(SRC).filter(isSchemaFile);
const problems = [];
const notes = [];
for (const f of appFiles) {
  if (!ours.includes(f)) { problems.push(`missing here: ${f} (in the app, not in src/)`); continue; }
  const same = readApp(f).equals(readFileSync(join(SRC, f)));
  const listed = Object.hasOwn(allow.files, f);
  if (same && listed) problems.push(`stale divergence entry: ${f} is identical now; remove it from app-divergence.json`);
  else if (!same && !listed) problems.push(`differs: ${f} (not listed in app-divergence.json)`);
  else if (!same) notes.push(`known difference: ${f}: ${allow.files[f]}`);
}
for (const f of ours) {
  if (appFiles.includes(f)) continue;
  if (Object.hasOwn(allow.packageOnly, f)) notes.push(`package only: ${f}`);
  else problems.push(`only here: ${f} (not in the app, not listed as package-only)`);
}

console.log(`compared src/ with ${label}: ${appFiles.length} app files`);
for (const n of notes) console.log(`  · ${n}`);
if (problems.length) {
  for (const p of problems) console.error(`  ✗ ${p}`);
  process.exit(1);
}
console.log('✓ in sync (identical apart from the listed differences)');
