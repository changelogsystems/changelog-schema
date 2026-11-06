// Type declarations for config-md.mjs.
import type { ChangelogConfig } from './config.mjs';

export declare function extractFrontmatter(md: string | null | undefined): string | null;
export declare function parseConfigMarkdown(md: string | null | undefined): Partial<ChangelogConfig> | null;
export declare function resolveConfig(sources?: {
  configMd?: string | null;
  embeddedMd?: string | null;
}): { config: ChangelogConfig; changed: boolean; source: 'config-file' | 'embedded' | 'defaults' };
