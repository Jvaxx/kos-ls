# Status and roadmap

kos-ls 2.0.0 is a stable, server-only fork targeting **kOS 1.6.0.1**
(KSP 1.12), primarily tested with Neovim. This is a current status summary,
not a release commitment. See [fork history and migration](FORK.md) and
[the changelog](../CHANGELOG.md) for completed changes.

## Implemented

- Standalone server/CLI, Node.js 22+, renamed package and executable.
- Root configuration loaded at startup and on change; archive and volume
  resolution, runtime preloads, exclusions, queued dependency propagation
  and deterministic cross-file analysis.
- Generated, versioned kOS database and overrides, with a regeneration
  report and tests; improved flow and builtin typing.
- Builtin documentation in hover, completion and signature help; typed
  user doc comments and inferred-type inlay hints.
- Token-preserving document/range formatter and `kos-ls format`, with
  file-based options, layout search and comment reflow.
- Semantic tokens, diagnostic quick fixes, disk-size code lenses and
  `kos-ls check` / `kos-ls size` for command-line workflows.
- Parser and resolver fixes, system-lock support, builtin-clobber checks,
  reference-tracking fixes and clean process shutdown.
- Unit, integration and process tests, fixture-based formatter checks,
  linting, pinned formatting tool and Node.js CI matrix.

## Known limitations

### Static analysis and kOS coverage

- Computed run paths and runtime-loaded libraries are not fully
  discoverable. `preload` and `// #include` make known dependencies
  explicit; a runtime-path hint identifies runs that cannot be followed.
- Typing is deliberately lenient when information is unknown. Addon
  availability and dynamic suffixes depend on the actual game setup;
  diagnostics do not replace executing scripts in kOS.
- The database is pinned to 1.6.0.1, not automatically updated to the
  installed game. Some entries lack documentation or need overrides;
  see [the generation report](kos-db-report.md).
- The list category in `list engines in x` is not specially classified
  by semantic highlighting. Semantic tokens support full and range
  requests, not deltas.

### Formatting

- Layout penalties approximate clang-format; this is not clang-format
  or a guarantee of identical output. The defaults are LLVM-inspired
  with four-space indentation.
- Tabs (`UseTab`) are not implemented. Trailing comments are reflowed
  separately rather than counted in the code line's layout cost.
- Files with syntax errors are not formatted. User doc comments attach
  to functions and parameter statements, not arbitrary declarations.

### Quick fixes and size estimates

- No automatic rewrite of deprecated `copy`, `rename` and `delete`:
  their file/volume semantics differ from the replacement functions.
- Disk usage estimates stripped UTF-8 source, not compiled `.ksm` files,
  filesystem overhead or external build-time path rewrites. Unknown
  dependencies are reported as not followed, not counted as zero-sized
  known files. Boot files count only when explicitly run or preloaded.

## Next priorities

1. **Before making the currently private repository public:** complete the
   remaining independent fixture-rights and visibility checks in
   [the publication checklist](PUBLISHING.md). Repeat source/security checks
   for every release; see [releasing](RELEASING.md).
   The [GPLv3 distribution decision](LICENSING.md) and
   [fork-history privacy cleanup](HISTORY_REVIEW.md) are complete.
2. Keep dependencies, supported Node.js versions and LSP compatibility
   tested; add regression cases with each analysis or parser fix.
3. Improve database coverage by reviewing generation warnings against
   the pinned kOS source and documentation. New kOS versions require an
   explicit regeneration and compatibility review.
4. Measure formatter and analysis performance on the retained fixtures
   before changing algorithms or optimizing for large workspaces.

Editor extensions, game launch/telnet integration, compiled-script size
prediction and a full kOS interpreter are outside the current scope.
