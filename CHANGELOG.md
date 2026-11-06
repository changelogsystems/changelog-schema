# Changelog

Notable changes to this library and to SPEC.md. Newest first.

## Unreleased

### Added
- `SPEC.md`: `changelog/v1`, written from the code, with a citation for every rule.
- `config-md.mjs`: `parseConfigMarkdown`, `extractFrontmatter` and `resolveConfig`, which read a config back out of markdown. The library could write a config and not read one. Moved here from the Obsidian plugin.
- `scripts/check-app-sync.mjs`: checks that this library and the CHANGELOG app's copy are the same, apart from listed differences.

### Fixed
- A vocabulary label that YAML would misread (`Foo, closes: true`, `#1 Priority`, quotes, a bare `true`) is now written as a quoted string in the config's markdown, and read back exactly. Everyday labels are written as before.

### Notes
- Extracted unchanged from the CHANGELOG app's `lib/schema` at `836ed0e`.
