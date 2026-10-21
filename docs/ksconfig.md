# Workspace configuration: `ksconfig.json`

A `ksconfig.json` at the workspace root (the folder opened by the LSP
client) configures analysis. It is read at startup and whenever it changes
on disk or in the editor. All properties are optional. The CLI locates its
root as described in [the README](../README.md#checking).

| Property | Description | Default |
| --- | --- | --- |
| `archive` | Directory corresponding to archive volume `0:` | Configuration directory |
| `volumes` | Map of other volume numbers/names to directories | None |
| `preload` | Scripts whose globals are visible to every script | None |
| `exclude` | Files/directories skipped during workspace loading and CLI reporting | None |
| `clobberBuiltins` | Allow names to hide kOS builtins, like kOS's `Config:CLOBBERBUILTINS` | `false` |
| `bodies` | Custom body names replacing the stock KSP body list | Stock KSP bodies |
| `linting` | Diagnostic rule/group severity overrides | See below |
| `format` | Formatter options, as in `.kos-format` | See [formatting](../README.md#formatting) |

Filesystem paths are relative to this configuration file. Only the root
`ksconfig.json` configures analysis. Formatting is different: options come
from the nearest `.kos-format` or `ksconfig.json` `format` section,
searched from each file's directory upwards. Nested configurations can
therefore affect formatting without changing workspace analysis.

## Example

Here `src/` represents the ship's disk (`1:`). A separate build copies the
scripts there and writes generated copies under `bin/` and `boot/`. A boot
script loads `1:/lib/std.ks` before every mission:

```json
{
  "volumes": { "1": "src" },
  "preload": ["src/lib/std.ks"],
  "exclude": ["bin", "boot"]
}
```

## Archive and volumes

`archive` maps `0:/`: with `"archive": "scripts"`, a run of
`0:/lib/orbit` is resolved under `scripts/`.

`volumes` maps other volumes by number or name (case-insensitive, with or
without a colon). A path on an unmapped volume is reported:

```json
{
  "archive": "scripts",
  "volumes": { "1": "src", "probe": "../probe-disk" }
}
```

Paths without a volume, such as `runPath("lib/orbit")`, depend on the
runtime current directory, which is not statically known. kos-ls uses the
first existing file in the calling file's directory, its mapped volume
root, then the archive. These mappings do not copy files or change the
actual game filesystem.

## Preload

Use `preload` for libraries loaded in a way static analysis cannot follow,
for example a boot file with a computed path or guarded run. Globals in
each listed file, and the files it runs, become visible throughout the
workspace. Entries are filesystem paths relative to `ksconfig.json`:

```json
{ "preload": ["src/lib/std.ks"] }
```

This models a runtime guarantee; it does not actually execute the library.

## Exclude

Excluded paths are skipped during workspace loading, and CLI diagnostics
are not reported for them. They are still analysed if another file runs
them or if they are opened in the editor. Closing an excluded document
clears its editor diagnostics.

```json
{ "exclude": ["bin", "boot"] }
```

## Builtin clobbering

`"clobberBuiltins": true` permits names to hide kOS builtins throughout
the workspace. An individual file can override it with
`@clobberbuiltins on.` or `@clobberbuiltins off.` at the top of the file.
Configure this to match the actual kOS setting; it does not change the game.

## Bodies

`bodies` replaces the list of valid body names, for example for a modded
solar system:

```json
{ "bodies": ["Earth", "Moon", "Mars"] }
```

## Linting

Severity levels are `"error"`, `"warning"`, `"info"`, `"hint"` and
`"off"`. A group applies a level to all its child rules. Group settings
currently take precedence over individual children, so avoid overlapping
group/child overrides if you want different levels within a group.
The `all` group covers every diagnostic. For example:

```json
{
  "linting": {
    "symbols-strict": "hint",
    "control-flow-break": "error",
    "parsing": "off"
  }
}
```

Rule names below are configuration keys, which may differ from the codes
printed with individual diagnostics. Defaults come from
[`src/config/models/lintRules.ts`](../src/config/models/lintRules.ts).
Disabling scanning/parsing diagnostics does not make invalid source valid.

### General rules

| Rule | Meaning | Default |
| --- | --- | --- |
| `scanning` | Invalid token, such as `variable$$$` | error |
| `parsing` | Invalid syntax, such as `set x to .` | error |
| `file-loading` | A run target cannot be loaded | warning |
| `file-loading-runtime` | A runtime-computed run path cannot be followed statically | hint |
| `unreachable-code` | Code after an unconditional break/return, or otherwise unreachable | error |
| `no-global-parameters` | Invalid global parameter declaration | error |
| `uninitialized-set` | Setting an undeclared variable with `@lazyglobal off` | warning |

### Control flow — group `control-flow`

| Rule | Meaning | Default |
| --- | --- | --- |
| `control-flow-break` | Break outside a loop | error |
| `control-flow-return` | Return outside a function or trigger | error |
| `control-flow-preserve` | Preserve outside a trigger | error |
| `control-flow-lazy-global` | `@lazyglobal` or `@clobberbuiltins` directive not at the top of the script | error |

### Deprecated commands — group `deprecated`

| Rule | Meaning | Default |
| --- | --- | --- |
| `deprecated-delete` | Deprecated `delete` statement | info |
| `deprecated-copy` | Deprecated `copy` statement | info |
| `deprecated-rename` | Deprecated `rename` statement | info |

### Symbols — group `symbols-strict`

| Rule | Meaning | Default |
| --- | --- | --- |
| `symbol-may-not-exist` | A symbol cannot be found, possibly because a runtime-loaded library is unknown | warning |
| `symbol-may-not-exist-closure` | A symbol may be undefined when a function/trigger first runs | warning |
| `symbol-wrong-kind` | A symbol has the wrong kind, such as a variable where a lock is expected | warning |
| `symbol-unused` | Local symbol is unused | warning |
| `symbol-unused-locally` | Global variable/lock is unused in its own file; other runtime uses may exist | warning |
| `symbol-shadowing` | A symbol hides one in an outer scope | warning |
| `symbol-conflict` | A symbol is redeclared in the same scope | warning |
| `symbol-clobber-builtin` | A declaration hides a builtin in a way kOS refuses without clobbering enabled | error |

Builtin-clobber checks follow the kind of declaration. Variable-like
operations (`set`, `local`, `global`, `parameter`, `toggle`, `x on.`,
`list ... in x`) may not hide builtin functions, read-only variables or
system locks (`throttle`, `steering`, `wheelThrottle`, `wheelSteering`).
A `lock` may not hide a builtin function or variable, and a `function`
may not hide any builtin. Enable clobbering only if that matches runtime.

### Types — group `type-checking`

Most type checks are hints because runtime information can be incomplete.

| Rule | Meaning | Default |
| --- | --- | --- |
| `type-wrong` | Type is incompatible with the expected type | hint |
| `type-no-call` | Value has no call signature | hint |
| `type-wrong-arity` | Wrong argument count for a kOS function, suffix or delegate | hint |
| `type-wrong-arity-user` | Wrong argument count for a script function or its delegate | warning |
| `type-list-invalid` | Invalid category in the `list` command | hint |
| `type-no-indexer` | Value cannot be indexed | warning |
| `type-missing` | A symbol's type cannot be determined at its use | hint |
| `type-not-function` | Creating a delegate from a non-function | hint |
| `type-missing-suffix` | Type has no such suffix | hint |
| `type-missing-operator` | Type does not support the unary/binary operator | hint |
| `type-no-setter` | Value is not settable | hint |
| `type-no-getter` | Value is not readable | hint |
| `type-unknown-in-doc` | Unknown/malformed type in a doc comment tag | warning |

### Comment directives — group `directives`

| Rule | Meaning | Default |
| --- | --- | --- |
| `directive-invalid-include` | `// #include` lacks a string or bare path | info |
