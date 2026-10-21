# Fork history, scope and migration

## Provenance

kos-ls is maintained by Jvaxx as an independent fork of
[John Chabot's kos-language-server](https://github.com/jonnyboyC/kos-language-server).
The fork starts from upstream commit
[`aff3a4743f5492a878cbfb5d2938e2e90f83cb45`](https://github.com/jonnyboyC/kos-language-server/commit/aff3a4743f5492a878cbfb5d2938e2e90f83cb45)
(`Fix jst.config.js`, upstream `server/package.json` version `1.1.7`).
Upstream history is retained in Git. The first fork commit is now `0a5d283`
(`Fork as kos-ls: server-only repository`). Before publication, private
handoff notes and fork benchmark results were removed from fork history;
upstream commits were not rewritten. See [the history review](HISTORY_REVIEW.md).

The parser, scanner, resolver, control-flow analysis, type-checking model
and core LSP features originate upstream. The changes below are work in
this fork, not features attributed to the original author. This project
does not claim upstream or kOS endorsement, and makes no promise about
upstream's current maintenance status.

The fork's package version is `2.0.0-dev`; it has not had a stable release.
Upstream's recorded releases are preserved separately in
[the upstream changelog](UPSTREAM_CHANGELOG.md). Their VS Code instructions
and version numbers describe that project, not this fork.

## Differences

| Area | Fork changes relative to the upstream base |
| --- | --- |
| Repository | Only the server; upstream's `server/` is now the repository root. The VS Code client, extension manifests, grammar submodule, snippets and editor-specific launch/telnet/documentation commands are not included. |
| Runtime and commands | Node.js 22+, package/executable `kos-ls`, with `kls` as a compatibility alias. Server and CLI are bundled from this checkout. |
| Workspace model | Root `ksconfig.json` read before initialization completes, reloaded on changes; volume mappings, preloaded libraries and excluded paths; queued dependency propagation and order-independent cross-file analysis. |
| Builtins | Checked-in kOS 1.6.0.1 database generated from C# and Sphinx documentation, with explicit overrides; most handwritten builtin definitions replaced. Primitive and generic collection models remain in TypeScript. |
| Analysis | Flow unions, forward references to functions, runtime-derived structures and unknown-type leniency; declaration/set chains, bare file names and `@clobberbuiltins`; system-lock handling and corrected builtin reference tracking. |
| Documentation | Markdown hover/completion/signature documentation, parameter names and documentation, user `//` doc comments with typed `@param`/`@return` tags, inferred-type inlay hints. |
| Editing | Semantic tokens, targeted diagnostic quick fixes, document and range formatting with file-based options, disk-size code lenses. |
| CLI | `format` for formatting, `check` for workspace diagnostics, `size` for stripped source and dependency-size estimates. |
| Reliability and development | Exit on client disconnect, corrected completion casing and cursor-boundary handling, real-server integration tests, database tests, ESLint, Prettier and CI. |

This is a feature comparison, not a claim of complete kOS compatibility.
See [limitations and next steps](ROADMAP.md).

## Migrating an upstream setup

1. Build this checkout as described in [the README](../README.md). Point
   the LSP client at `kos-ls --stdio` (or this checkout's `bin/kos-ls`).
   Do not assume installing upstream's npm package or VS Code extension
   installs this fork. Avoid running both servers on the same buffer.
2. Use the `kos-ls` client-settings section. The legacy `kos-vscode`
   section is read only when `kos-ls` is absent. Supported settings are
   `completionCase` and `trace.server.level`; removed extension settings
   for KSP paths, telnet and inspector ports do nothing here.
3. Keep workspace analysis settings in the **root** `ksconfig.json`.
   Existing `archive`, `bodies` and `linting` remain supported. Add
   `volumes`, `preload`, `exclude` or `clobberBuiltins` as needed;
   see [the configuration reference](ksconfig.md).
4. Formatting is configured in `.kos-format` or a `ksconfig.json`
   `format` section, searched from each file upwards. Editor tab settings
   are deliberately ignored. A nested `ksconfig.json` can affect
   formatting but not workspace analysis.
5. Revisit diagnostic overrides: kOS 1.6.0.1 types and builtin-clobber
   checks can reveal new diagnostics. User-function argument counts are
   warnings; most other type checks are hints. Runtime-computed run paths
   cannot be followed automatically: use `preload` or `// #include` where
   appropriate, rather than assuming all globals are discoverable.

`serverInfo.name`, diagnostic sources and command IDs use `kos-ls`.
The retained `kls` alias does not imply binary or release equivalence with
upstream. This fork does not ship a VS Code extension, but a generic LSP
client in VS Code can still launch it.

## Attribution and licensing

The combined fork and database are distributed under
[GPL-3.0-only](../LICENSE). Upstream's MIT terms and the previous fork MIT
notice are preserved in [LICENSES/kos-language-server-MIT.txt](../LICENSES/kos-language-server-MIT.txt);
those grants are not withdrawn. See [the licensing decision](LICENSING.md)
and [third-party notices](../THIRD_PARTY_NOTICES.md) for the kOS material
and inherited fixtures.
Please file fork bugs and feature requests in this repository; upstream
issue numbers mentioned in Git history refer to the original repository.
