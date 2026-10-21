# Changelog

This file records changes in the **kos-ls fork**. No stable fork release
has been published. The original project's release notes are preserved in
[docs/UPSTREAM_CHANGELOG.md](docs/UPSTREAM_CHANGELOG.md); those versions and
VS Code features are not releases of this fork.

## Unreleased — 2.0.0-dev

Based on upstream `aff3a4743f5492a878cbfb5d2938e2e90f83cb45`
(source package 1.1.7). See [fork provenance and migration](docs/FORK.md).

### Packaging and compatibility

- Server-only repository, with upstream's server moved to the root;
  remove the VS Code client, extension manifests and grammar submodule.
- Rename the package, diagnostic source and server identity to `kos-ls`.
  Provide `kos-ls` and the compatibility alias `kls`.
- Require Node.js 22 or later; modernize dependencies, linting, formatting
  and CI. Remove the obsolete async-iteration runtime flag.
- Read `kos-ls` client settings, with `kos-vscode` only as a fallback;
  remove settings that belonged to the old extension and were unused.

### Project analysis and correctness

- Load root `ksconfig.json` before answering initialization; reload it
  from disk or editor changes. Add volume mappings, preloaded scripts,
  excluded paths and workspace-wide builtin-clobber configuration.
- Queue analysis and rebuild connected dirty scripts consistently,
  independent of document-open order. Clear diagnostics for removed files
  and excluded scripts when closed.
- Exit cleanly when the client disconnects instead of spinning on a
  broken protocol stream. Catch and log editor-request errors.
- Support comma-chained declarations/sets, variable and bareword file
  arguments, `@clobberbuiltins` and kOS's builtin-name restrictions.
- Correct system-lock resolution, duplicate diagnostics on refused sets,
  builtin usage cleanup, references, rename and cursor token selection.
- Apply completion casing to suffixes; restore completion immediately
  after a colon; use single-character completion/signature triggers.

### Types and documentation

- Replace most handwritten builtin definitions with a generated,
  checked-in kOS 1.6.0.1 database: structures, suffixes, functions,
  variables and documentation, with explicit overrides and a generation
  coverage/conflict report.
- Improve forward function references, variable flow unions, function and
  variable namesakes, derived runtime structures and unknown-type handling.
- Add builtin Markdown documentation to hover, resolved completion and
  signature help, including parameter names, per-parameter documentation
  and links to kOS documentation.
- Retain scanner comment trivia; recognize function/parameter doc comments
  with typed `@param` and `@return` tags and report unknown tag types.
- Add inferred-type inlay hints and signature help for incomplete calls.
- Check `print at` coordinates and run-command arguments. Report wrong
  user-function argument counts as warnings, distinct from builtin hints.
- Give runtime-computed run paths a dedicated hint and lint rule.

### Editing and command line

- Add semantic tokens (full/range) with standard token types/modifiers.
- Add quick fixes for missing periods, builtin-clobber errors, misspelled
  names/suffixes/doc types, undeclared sets and invalid directives.
- Add token-preserving document/range formatting and `kos-ls format`,
  file-based options, layout search, argument packing, short anonymous
  functions and comment reflow.
- Add `kos-ls check` for workspace diagnostics with failure thresholds.
- Add disk-size code lenses, dependency-size details and `kos-ls size`
  with an optional maximum-size threshold.

### Development and repository hygiene

- Add real-server integration/process tests, database generator/loader
  tests and fixture-based formatter equivalence/idempotence checks.
- Retain a headless LSP probe and the active benchmark suites; repair
  benchmark fixture paths for the server-only repository layout.
- Document fork provenance, migration, development, limitations and
  publication requirements; replace upstream placeholder templates.
- Separate historical upstream release notes, remove private handoff
  notes and obsolete benchmark experiments/results, and add safe cleanup
  of disposable outputs. Preserve useful fixtures, tools and versioned data.
- Resolve kOS-derived database licensing by distributing the combined
  work under GPL-3.0-only; retain the previous MIT notice verbatim and
  include matching project source, pinned kOS inputs and third-party
  notices with packages.
- Back up and sanitize private notes/results and local paths from fork
  history while preserving upstream commits and the chosen commit email;
  update provenance/blame references and record the review scope.
