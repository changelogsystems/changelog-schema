// Type declarations for lib/schema/config.mjs (C1: shared schema package).
// Consumed by server/ (TypeScript) when importing the .mjs directly; the app
// (plain JS via Metro) ignores this file. Additive only — config.mjs stays
// the single implementation; keep these signatures in sync with it.

export type VocabItem = { id: string; label: string; color: string };
export type StatusItem = VocabItem & { closes: boolean };
export type VocabKind = 'status' | 'type' | 'area';

export type ChangelogConfig = {
  schema: string;
  tenant: string;
  statuses: StatusItem[];
  completeTarget: string;
  areasSeeded: boolean;
  areas: { mode: string; set: VocabItem[] };
  types: { mode: string; set: VocabItem[] };
};

export declare function slugId(label: unknown): string;
export declare const VOCAB_PALETTE: string[];
export declare const VOCAB_MODES: string[];
export declare function nextVocabColor(used?: string[]): string;
export declare function defaultConfig(): ChangelogConfig;
export declare function statusById(
  config: ChangelogConfig | null | undefined,
  id: string,
): StatusItem | undefined;
export declare function statusSlug(raw: unknown): string;
export declare function resolveStatusId(
  config: ChangelogConfig | null | undefined,
  raw: unknown,
): string | null;
export declare function closesFor(
  config: ChangelogConfig | null | undefined,
  raw: unknown,
): boolean;
export declare function migrateConfig(
  config?: unknown,
  legacyAreaChips?: unknown[],
): { config: ChangelogConfig; changed: boolean };
export declare function vocabSet(
  config: ChangelogConfig | null | undefined,
  kind: VocabKind,
): VocabItem[];
export declare function legacyDefaultConfigs(): ChangelogConfig[];
export declare function resolveVocabId(
  config: ChangelogConfig | null | undefined,
  kind: VocabKind,
  raw: unknown,
): string | null;
export declare function typeKey(
  config: ChangelogConfig | null | undefined,
  raw: unknown,
): string;
export declare function labelFor(
  config: ChangelogConfig | null | undefined,
  kind: VocabKind,
  raw: unknown,
): string;
export declare function completeTargetStatus(
  config: ChangelogConfig | null | undefined,
): StatusItem | null;
export declare function isCompleteTarget(
  config: ChangelogConfig | null | undefined,
  id: string,
): boolean;
