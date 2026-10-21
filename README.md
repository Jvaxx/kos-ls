# kos-ls

A language server for Kerboscript, the language of the
[kOS](https://github.com/KSP-KOS/KOS) mod for Kerbal Space Program.

**kos-ls is an independent, server-only fork** of John Chabot's
[kos-language-server](https://github.com/jonnyboyC/kos-language-server),
maintained here by Jvaxx. The original author and contributors built the
scanner, parser, analysis and LSP foundation; this fork extends that work.
It is not an official kOS project or the upstream VS Code extension.

**Current release:** [2.0.0](https://github.com/Jvaxx/kos-ls/releases/tag/v2.0.0)
(stable). Targets kOS **1.6.0.1** (KSP 1.12).
Uses standard LSP, with Neovim as the primary tested client. Other editors
need an LSP client configured to launch this server.

## What is different from upstream?

- **Standalone tooling:** no bundled VS Code extension, editor commands,
  TextMate grammar or snippets. Run `kos-ls --stdio` from your LSP client.
- **Project analysis:** startup configuration, volume mappings, runtime
  preloads and exclusions; consistent cross-file analysis and clean exit
  when the client disconnects.
- **kOS 1.6.0.1 knowledge:** a versioned database generated from kOS source
  and documentation, replacing most hand-written builtin definitions.
- **Richer editor features:** documented hover/completion/signatures, typed
  doc comments, semantic tokens, inlay hints, quick fixes and disk-size
  code lenses, alongside definition, references, rename, symbols and folding.
- **Formatting and CLI:** document/range formatting and `kos-ls format`,
  `kos-ls check`, and `kos-ls size` for scripts, hooks and CI.

See [fork history and migration](docs/FORK.md) for the exact upstream base,
compatibility changes and scope; [CHANGELOG.md](CHANGELOG.md) for fork
changes; and [the roadmap](docs/ROADMAP.md) for limitations and future work.
Please report fork issues in [Jvaxx/kos-ls](https://github.com/Jvaxx/kos-ls/issues),
not upstream. [CI](https://github.com/Jvaxx/kos-ls/actions/workflows/node.js.yml)
tests Node.js 22 and 24.

## Install the release

Requires **Node.js 22.13 or later** and npm. Download the package and
checksums from the [2.0.0 release](https://github.com/Jvaxx/kos-ls/releases/tag/v2.0.0):

```sh
curl -fLO https://github.com/Jvaxx/kos-ls/releases/download/v2.0.0/kos-ls-2.0.0.tgz
curl -fLO https://github.com/Jvaxx/kos-ls/releases/download/v2.0.0/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
npm install --global ./kos-ls-2.0.0.tgz
kos-ls --version
```

The release asset includes ready-to-run bundles and matching editable
source. No npm registry release has been made; `npm install -g kos-ls`
is not the installation method for this fork. See [release notes](docs/releases/v2.0.0.md)
for assets, migration and limitations.

## Build and run from source

Requires **Node.js 22.13 or later** and npm. Clone this fork, then:

```sh
git clone https://github.com/Jvaxx/kos-ls.git
cd kos-ls
npm ci            # install the locked development dependencies
npm run build     # TypeScript, tests and tools to out/
npm test
npm run verify:sources # verify pinned sources and fixture inventory offline
npm run bundle    # server and CLI bundles to dist/, used by bin/kos-ls
./bin/kos-ls --version
npm link          # optional: puts kos-ls (and the kls alias) on PATH
```

Then configure your LSP client to run `kos-ls --stdio`, or use the absolute
path to this checkout's `bin/kos-ls`. Re-run `npm run bundle` after changes:
`npm run build` alone does not update the launcher. An old `kls` executable
may belong to upstream; prefer the unambiguous `kos-ls` command.

These instructions install the checkout, not the upstream npm package or
Marketplace extension. See [development](docs/DEVELOPMENT.md) for the full
workflow, tests, benchmarks, packaging and cleanup.

## Neovim

For Neovim 0.11 or later:

```lua
vim.filetype.add({ extension = { ks = "kerboscript" } })
vim.lsp.config("kos_ls", {
    cmd = { "kos-ls", "--stdio" },
    filetypes = { "kerboscript" },
    root_markers = { "ksconfig.json", ".git" },
})
vim.lsp.enable("kos_ls")
```

## Client settings

Read from the `kos-ls` settings section (`kos-vscode`, the section of
kos-language-server, is still read when `kos-ls` is absent):

|Setting|Values|Default|
|--|--|--|
|`completionCase`|`lowercase`, `uppercase`, `camelcase`, `pascalcase`|`camelcase`|
|`trace.server.level`|`verbose`, `info`, `log`, `warn`, `error`, `none`|`error`|

```lua
vim.lsp.config("kos_ls", {
    settings = { ["kos-ls"] = { completionCase = "lowercase" } },
})
```

## Workspace configuration

A `ksconfig.json` at the root of the workspace sets the archive (`0:`)
and other volume directories, files preloaded at runtime (such as a
library a boot file loads), excluded directories, custom bodies and lint
levels. See [docs/ksconfig.md](docs/ksconfig.md).

## Doc comments

The block of `//` lines directly above a `function` or a `parameter`
statement documents it (a blank line breaks the attachment). Hover,
completion and signature help show it, as they show the kOS
documentation of builtins.

```
// Burn time for a maneuver.
// @param dv {Scalar} delta-v in m/s
// @param ves {Vessel} the vessel
// @return {Scalar} seconds
function burnTime {
    parameter dv, ves is ship.
    return dv / ves:availablethrust.
}
```

Types in tags are kOS structure names in any case, or expressions such as
`List<Part>` or `Scalar | Vector`. They type the parameters inside the
function (suffix completion and checking) and the calls, and an argument
that cannot convert to its tagged type gets a hint. An untagged parameter
is a `Structure`, accepted everywhere. A comment above a `parameter`
statement documents its parameters, before the `@param` tags of the
function.

## Semantic highlighting

The server classifies every token (`textDocument/semanticTokens`, full
and range), so highlighting follows the analysis instead of a syntax
file: a name is highlighted as what it resolves to.

| Token type | |
|---|---|
| `keyword` | keywords and commands, `true`/`false`, a doc comment's `@param`/`@return` |
| `variable`, `parameter`, `function` | names, by the symbol they resolve to (locks are variables) |
| `property`, `method` | suffixes (`ship:altitude`, `ship:partsnamed(...)`) |
| `number`, `string`, `operator`, `comment` | literals (bare file names are strings), operators, comments |
| `type` | `{Type}` in a doc comment tag |
| `macro` | `@lazyglobal`, `@clobberbuiltins`, `// #include` and `// #region` |

Modifiers: `declaration` (where a name is declared), `defaultLibrary`
(kOS builtins: functions, variables, bodies, suffixes, and the system
locks `steering`, `throttle`, `wheelSteering` and `wheelThrottle`,
`lock steering to ...` included), `readonly`
(builtin variables and suffixes that cannot be set, bodies included),
`documentation` (doc comment tags).

Neovim uses them as soon as the server is attached, through the
`@lsp.type.<type>`, `@lsp.mod.<modifier>` and
`@lsp.typemod.<type>.<modifier>` highlight groups, e.g.:

```lua
vim.api.nvim_set_hl(0, "@lsp.typemod.variable.defaultLibrary", { link = "@variable.builtin" })
vim.api.nvim_set_hl(0, "@lsp.typemod.function.defaultLibrary", { link = "@function.builtin" })
vim.api.nvim_set_hl(0, "@lsp.type.macro", { link = "PreProc" })
```

## Quick fixes

Code actions (`vim.lsp.buf.code_action()` in Neovim) fix these
diagnostics:

| Diagnostic | Fixes |
|---|---|
| `Expected "."` | insert the period |
| a name hides a builtin | rename it everywhere (`r` to `r_`), or add `@clobberbuiltins on.` at the top of the file (or turn an `off` one on) |
| a symbol or suffix may not exist | change it to a close name that exists (up to three; at most a third of the letters differ) |
| an unknown type in a doc comment tag | change it to a close structure name |
| `set` of an undeclared variable with `@lazyglobal off` | declare it with `global` (preferred at the top level) or `local` (preferred in a block) |
| a directive not at the top of the file | move it there, or remove it |
| `declare global parameter` | remove `global` |

The preferred fix, if any, is marked as such. To apply it without a
menu:

```lua
vim.lsp.buf.code_action({
    filter = function(action) return action.isPreferred end,
    apply = true,
})
```

## Formatting

The server formats documents and ranges (`textDocument/formatting`,
`rangeFormatting`; `vim.lsp.buf.format()` in Neovim), and so does the
command line:

```sh
kos-ls format file.ks dir/      # in place; directories are searched for .ks
kos-ls format --check .         # list the files to format, exit 1 if any
kos-ls format < in.ks > out.ks  # standard input to standard output
```

The style is clang-format's LLVM style with 4-space indentation: attached
braces, 80 columns, one statement per line, one space around binary
operators, lowercase keywords. Every comment is kept: one following code
stays on its line (consecutive ones are aligned, and lines aligned under
it continue it). Comments past the column limit are reflowed, like
clang-format: words move to the next comment line unless it starts a list
item or a tag, or they end a sentence; blank comment lines, `#` directives, code
fences and indented text are left alone. A long statement is broken where the
whole layout costs least, like clang-format: at the outermost level, at
the operator of lowest priority (`or` before `and` before `+` before
`*`), keeping a parenthesis or call whole when it fits on the next line;
broken lines continue aligned with their operand group or after the open
bracket. A short anonymous function stays on one line when it fits
(`{ return a + 1. }`). The header blocks of a `from` loop stay on one
line. A file with syntax errors is not formatted.

Options are read from the nearest `.kos-format` file, or `format` section
of a `ksconfig.json`, from the file's directory up (editor tab settings
are ignored, so the editor and the command line agree). Unlike the
analysis, which reads only the root `ksconfig.json`, this may be a
`ksconfig.json` in a subdirectory. A `.kos-format` is clang-format's flat
YAML or JSON:

```yaml
IndentWidth: 4              # columns per block level
ContinuationIndentWidth: 4  # broken lines not aligned to a bracket
ColumnLimit: 80             # 0: no limit
BreakBeforeBraces: Attach   # Attach, Stroustrup (else on its own line), Allman
BreakBeforeBinaryOperators: None  # None: `a +` / `b`; All: `a` / `+ b`
KeywordCase: Lower          # Lower (runPath, runOncePath), Upper, Preserve
MaxEmptyLinesToKeep: 1
SpacesBeforeTrailingComments: 1
AlignTrailingComments: true
BinPackArguments: true      # false: the arguments of a call on one line, or one per line
AllowShortLambdasOnASingleLine: All  # All, Empty (only `{}`), None
ReflowComments: true
```

The last three follow clang-format's LLVM defaults; set them to `false`,
`None` and `false` for the layout of earlier versions.

## Checking

`kos-ls check` prints the diagnostics an editor would get for the whole
workspace, for CI or a git hook: same `ksconfig.json` (volumes, preload,
exclude, lint rules), each file analysed with the scripts it runs.

```sh
kos-ls check                    # the workspace of the current directory
kos-ls check src/lib            # report only these files or directories
kos-ls check --fail-on warning  # fail on warnings too (default: error;
                                # also info or hint)
kos-ls check --root ~/Ships/Script
```

The root is the nearest directory with a `ksconfig.json` from the current
directory up, else the current directory. Each diagnostic is printed as
`path:line:column: severity: message [code]`, a summary goes to standard
error. Exit status: 0 when no diagnostic reaches the `--fail-on` severity,
1 when one does, 2 on a usage error or a path that cannot be checked.

## Disk size

A probe's disk holds a few KB, so each script gets a code lens on its
first line with the space it needs once stripped of comments and
indentation, alone and with every file it runs (the preloaded files of
`ksconfig.json` included, each file counted once):

```
685 B on disk (1323 B source) · 1353 B with the 2 files it runs
```

Running the lens (the `kos-ls.diskUsage` command, with the script's uri
as argument) shows the size of each of those files, in a
`window/showMessage` notification. In Neovim 0.12:

```lua
vim.lsp.codelens.enable()                              -- show the lenses
vim.keymap.set("n", "<leader>l", vim.lsp.codelens.run) -- run the one on the cursor line
```

The lens follows edits and the files a script runs (the server asks for
a refresh, `workspace/codeLens/refresh`).

`kos-ls size` prints the same for the whole workspace, or for files and
directories. The root is found as for `kos-ls check`:

```sh
kos-ls size                     # every script of the workspace
kos-ls size --files src/mission # with the files counted in each total
kos-ls size --max 5000          # exit 1 when a total is larger
kos-ls size --root ~/Ships/Script
```

```
path                 stripped   source    total files
src/boot/main.ks         1442     3299     1629     2  (2 runs not followed)
src/mission/hello.ks      685     1323     1353     3
```

Stripped means each line without its `//` comment and the whitespace
around it, lines kept (an emptied line still costs its line break, so
the line numbers of kOS errors match the source), blank lines at the
end dropped, `\n` line breaks; kOS counts UTF-8 bytes. A string over
several lines keeps its whitespace. A run whose file is not known (a
path built at runtime, a missing file) is not counted, and reported as
not followed. Compiled `.ksm` sizes are not computed, and a boot file
is counted only when a script runs it.

## Development and contributing

See [the development guide](docs/DEVELOPMENT.md) for the repository layout,
checks, headless LSP probe, benchmarks and generated-file policy, and
[contributing guidelines](.github/CONTRIBUTING.md) for reports and patches.
The [database guide](docs/kos-db.md) explains how to regenerate the kOS data;
[the generation report](docs/kos-db-report.md) records its coverage and gaps.

## License and acknowledgements

The combined kos-ls server and kOS-derived database are distributed under
**GPL-3.0-only**, see [LICENSE](LICENSE). The upstream MIT terms and earlier
fork MIT notice are preserved in
[LICENSES/kos-language-server-MIT.txt](LICENSES/kos-language-server-MIT.txt);
existing MIT grants are not withdrawn. kOS documentation is credited to
the kOS Team, Nivekk and contributors.

See [the licensing decision and source-delivery policy](docs/LICENSING.md),
[third-party notices](THIRD_PARTY_NOTICES.md),
[the historical privacy review](docs/HISTORY_REVIEW.md) and
[the publication checklist](docs/PUBLISHING.md). release packages include the
project source, build inputs and pinned kOS/runtime dependency sources
alongside the runtime bundles.
