# Development

## Setup and checks

Requires Node.js 22 or later and npm. CI tests Node.js 22 and 24.
No KSP installation or kOS checkout is required for ordinary builds or
tests: the builtin database and test fixtures are checked in.

```sh
npm ci
npm run clean
npm run build
npm run lint
npm run prettier:check
npm test -- --maxWorkers=2
npm run bundle
./bin/kos-ls --version
```

`npm test` builds first. Always use it after source changes: some CLI and
process tests execute `out/`, so running bare Jest can test stale code.
The worker limit is optional and useful on memory-constrained machines.
For a focused run: `npm test -- --runInBand test/integration/completion.spec.ts`.

`npm run prettier` formats TypeScript/JavaScript in `src/`, `test/`,
`benchmark/` and `tools/`. The formatting-only commit is listed in
`.git-blame-ignore-revs`; optionally enable it locally:

```sh
git config blame.ignoreRevsFile .git-blame-ignore-revs
```

## Build outputs and installed commands

- `npm run build`: TypeScript, declarations, maps and imported data in
  `out/`, including tests, benchmarks and database tools.
- `npm run bundle`: webpack builds the server and three CLI entry points
  in `dist/`, with source maps.
- `bin/kos-ls`: small source-controlled launcher that reads **`dist/`**.
  Rebundle after changes to update an `npm link` installation or a client
  configured to use this launcher. Building only `out/` is not enough.

The package's `files` allowlist includes runtime bundles/maps and launcher,
**matching project source** (including tests, tools and build configuration),
the pinned kOS extraction inputs and licensing notices. This is deliberate
GPL source delivery, not accidental publication of build clutter. Local
reports, private Git history and dependencies are excluded. npm also
includes the root README, package metadata and license. To inspect contents
without publishing or creating an archive:

```sh
npm run build
npm run bundle
npm run prepare:package
npm pack --dry-run --ignore-scripts
```

`prepare:package` copies the canonical `package-lock.json` to generated
`npm-shrinkwrap.json`: npm excludes the former from tarballs, but includes
the latter, so extracted sources still support `npm ci`. Do not maintain
the two independently; regenerate it after lockfile changes. A real
`npm pack` runs `prepack` (build, bundle, tests and package preparation).
The licensing
choice is recorded in [LICENSING.md](LICENSING.md): GPL-3.0-only for the
combined distribution, with retained upstream notices. Extract a candidate
package and verify its included source builds; review the remaining
[publication/release checks](PUBLISHING.md) before distributing it.

## Repository map

| Path | Purpose |
| --- | --- |
| `src/scanner/`, `src/parser/` | Tokens, retained comment trivia and AST |
| `src/analysis/`, `src/controlFlow/`, `src/typeChecker/` | Names, dependency scopes, control flow and type models |
| `src/services/`, `src/kls.ts`, `src/server.ts` | LSP orchestration and editor features |
| `src/formatter/`, `src/cli/` | Formatting and command-line entry points |
| `src/generator/` | Upstream expression generator and manual fuzzing harness, not the kOS database generator |
| `data/`, `tools/kos-db/` | Checked-in builtin data, overrides and their generator |
| `test/` | Unit tests, real-server integration/process tests and regression fixtures |
| `benchmark/`, `zakzak.config.json` | Scanner, parser, resolver, control-flow and type-checker benchmark suites |
| `tools/lsp-probe.js` | Headless LSP client for reproductions and comparisons |
| `docs/` | User reference, provenance, development and publication documentation |
| `third_party/`, `LICENSES/` | Pinned kOS extraction sources, manifests and retained third-party terms |

## Generated-file policy and cleanup

Keep sources, tests (including fixture `bin/` directories), the lockfile,
benchmark suites, grammar specification, database generator/overrides,
versioned builtin database and its generation report, plus the pinned kOS
source snapshot and license notices. The database is required at runtime;
its report helps review extraction gaps, and the source snapshot preserves
editable inputs for regeneration/source delivery. None is disposable build
output.

Do not commit `node_modules/`, `out/`, `dist/`, coverage, JUnit reports,
benchmark results, CPU profiles, npm archives or logs. These are ignored.
The old machine-specific fork benchmark dump was removed from fork
history during the [privacy cleanup](HISTORY_REVIEW.md). Superseded
`benchmark/old/` experiments were removed from the current tree; their
already-public upstream history remains.

```sh
npm run clean
```

This removes only known root build/report outputs (`out/`, `dist/`,
`coverage/`, generated shrinkwrap, JUnit XML, benchmark exports and
profiles). In an unpacked package, where shrinkwrap is the only lockfile,
it is preserved. Cleanup leaves `node_modules/`, the canonical lockfile,
all source data and nested test fixtures
alone. It also removes the bundles used by linked commands: rebuild and
rebundle before using them again. npm package archives and logs are
ignored but not deleted automatically.

## Headless LSP probe

Build first; the probe defaults to `out/src/server.js`, not `dist/`.
It opens all `.ks` files under the root unless explicit files are given:

```sh
npm run probe -- test/fixtures/parser_valid
npm run probe -- --ask textDocument/hover \
  test/fixtures/parser_valid/integration/basic.ks:1:1 \
  test/fixtures/parser_valid
npm run probe -- --server /path/to/other-server --stdio -- \
  test/fixtures/parser_valid
```

`--server` comes first, then any `--ask` arguments, then the workspace
root and files. Positions are 1-based. Position requests include hover,
completion and signature help; completion also resolves the first item.
The probe waits at least seven seconds and until diagnostics have been
quiet for `PROBE_QUIET` milliseconds (default 6000). `PROBE_OPEN_DELAY`
can delay document opening to reproduce initialization races.

For CLI/editor consistency checks, compare sorted diagnostics from
`kos-ls check --fail-on hint --root test/fixtures/parser_valid` with the
probe. The fixture corpus intentionally contains errors and legacy kOS
code, so nonzero `check` status is expected; compare the changes rather
than treating the corpus as warning-free. Prefer specific regression tests
over hard-coded diagnostic counts that become stale.

## Benchmarks and fuzzing

`npm run bench` builds first, then runs the five retained Zakzak suites
against `test/fixtures/parser_valid`. The compiled suites resolve that
checked-in directory; no sibling `kerboscripts/` checkout is needed.
Settings in `zakzak.config.json` include memory benchmarking and CPU
profiling, so a full run can be expensive. Results are machine-dependent:
record the commit, Node.js version, platform and settings when comparing.
Generated exports/profiles are disposable, not portable baselines.

For manual parser fuzzing, `node out/src/generator/testRun.js` generates
expressions until it finds a failure; it may run indefinitely. Stop it
manually when finished and turn any useful failure into a regression test.

Database regeneration is separate; see [the database guide](kos-db.md).
Do not regenerate the versioned database as an incidental part of a build.

## Implementation details worth preserving

- TypeScript uses `module: node20`, `moduleDetection: legacy` and
  `isolatedModules`. `src/utilities/types.ts` is intentionally a global
  type-only script; adding imports or runtime values changes its meaning.
- Type modules have initialization cycles. Tests that use the database
  loader import a primitive first; preserve the established ordering.
- LSP diagnostic messages can be markup: use `diagnosticText` when
  converting them to plain text.
- In-process CLI initialization uses `processId: null`, avoiding the
  language-server library's parent-process watchdog keeping it alive.
- LSP stdout is protocol-only. Log errors to stderr or through the
  connection; preserve clean shutdown on closed pipes.
- Disk-size details use a `window/showMessage` **notification**, not a
  blocking request. Test changes to code-lens refresh behavior.
- Formatter options come from files, not editor indentation settings.
  Preserve token/comment equivalence and idempotence tests.

See [contributing](../.github/CONTRIBUTING.md) for patch expectations.
