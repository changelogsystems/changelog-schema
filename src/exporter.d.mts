// Type declarations for lib/schema/exporter.mjs (C1: shared schema package).
// Consumed by server/ (TypeScript) when importing the .mjs directly; the app
// (plain JS via Metro) ignores this file. Additive only — exporter.mjs stays
// the single implementation; keep these signatures in sync with it.

import type { ChangelogConfig } from './config.mjs';
import type { Entry } from './entries.mjs';

export declare function toEntriesTable(
  entries: Entry[] | null | undefined,
  config: ChangelogConfig | null | undefined,
): string;
export declare function toConfigMarkdown(config: ChangelogConfig | null | undefined): string;
export declare function toEntryFile(
  entries: Entry[] | null | undefined,
  config: ChangelogConfig | null | undefined,
  options?: { job?: string },
): string;
