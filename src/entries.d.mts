// Type declarations for lib/schema/entries.mjs (C1: shared schema package).
// Consumed by server/ (TypeScript) when importing the .mjs directly; the app
// (plain JS via Metro) ignores this file. Additive only — entries.mjs stays
// the single implementation; keep these signatures in sync with it.

import type { ChangelogConfig } from './config.mjs';

export type Entry = {
  id: string;
  supersedes: string;
  date: string;
  job: string;
  category: string;
  who: string;
  type: string;
  change: string;
  reason: string;
  by: string;
  voided?: boolean;
  /** Server-assigned per-workspace monotonic sequence; absent until synced. */
  seq?: number;
  /** CLIENT-ONLY (F3): set on entries pulled from a job share — the local
   * "a peer workspace authored this" marker. Never sent to the server (toWire
   * strips it) and never present on entries the server hands out. */
  shareId?: string;
};

export declare function newEntry(fields?: {
  date?: string;
  job?: string;
  status?: string;
  area?: string;
  type?: string;
  change?: string;
  reason?: string;
  by?: string;
}): Entry;
export declare function supersededIds(entries: Entry[]): Set<string>;
export declare function headsOf(entries: Entry[]): Entry[];
export declare function headOf(entries: Entry[], id: string): Entry | undefined;
export declare function supersede(
  entries: Entry[],
  targetId: string,
  patch?: { status?: string; change?: string; reason?: string },
): Entry[];
export declare function completeEntry(
  entries: Entry[],
  targetId: string,
  config: ChangelogConfig | null | undefined,
): Entry[];
export declare function chainOf(entries: Entry[], id: string): Entry[];
export declare function liveHeads(entries: Entry[]): Entry[];
export declare function voidHead(entries: Entry[], headId: string): Entry[];
export declare function restoreHead(entries: Entry[], headId: string): Entry[];
export declare function partitionClosed(
  heads: Entry[],
  config: ChangelogConfig | null | undefined,
): { open: Entry[]; closed: Entry[] };
export declare function activeHeads(
  entries: Entry[],
  config: ChangelogConfig | null | undefined,
): Entry[];
export declare function contentHash(e: Partial<Entry>): string;
export declare function forkWinner(a: Entry, b: Entry): Entry;
export declare function resolvedHeadOf(entries: Entry[], id: string): Entry | undefined;
export declare function resolvedHeadsOf(entries: Entry[]): Entry[];
export declare function resolvedLiveHeads(entries: Entry[]): Entry[];
export declare function resolvedActiveHeads(
  entries: Entry[],
  config: ChangelogConfig | null | undefined,
): Entry[];
