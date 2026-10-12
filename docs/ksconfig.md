# Workspace configuration: `ksconfig.json`

A `ksconfig.json` at the root of the workspace (the folder the client
opens) configures how kos-ls reads the scripts. It is read at startup and
again whenever it changes, on disk or in the editor. All properties are
optional.

|Name|Description|
|--|--|
|archive|The directory of the archive, volume `0:`, relative to this file. Default: this file's directory|
|volumes|Directories of other kOS volumes, relative to this file|
|preload|Files run before every script at runtime: their globals are visible in every file|
|exclude|Files and directories that are not analysed unless opened or run by another file|
|clobberBuiltins|`true` lets names hide kOS builtins in every file, as kOS's `Config:CLOBBERBUILTINS` setting does. Default: `false`; a file can still set `@clobberbuiltins on.` or `off.`|
|bodies|A list of custom bodies for the language server to consider valid. By default the stock KSP bodies are assumed|
|linting|A collection of rules and levels indicating what level lints should be reported|
|format|Formatter options, as in a `.kos-format` file; see the README|

Paths in these properties are relative to `ksconfig.json`.

Only the `ksconfig.json` at the root configures the analysis. The
formatter is different: it takes its options from the nearest
`.kos-format` or `ksconfig.json` `format` section from each file's
directory up, so a `ksconfig.json` in a subdirectory can set the format
of the files below it, and nothing else.

## Example

A layout where `src/` is edited and its files are copied to the ship's
disk (`1:`) by a build, which also writes generated copies to `bin/` and
`boot/`; the boot file loads `1:/lib/std.ks` before every mission:

```json
{
  "volumes": { "1": "src" },
  "preload": ["src/lib/std.ks"],
  "exclude": ["bin", "boot"]
}
```

# Archive

The directory that corresponds to the archive, `0:/`. Paths like
`runpath("0:/lib/orbit")` are resolved from it.

```json
{
  "archive": "scripts"
}
```

# Volumes

kOS paths can name a volume by number or name: `1:/lib/std.ks`,
`probe:/data.json`. `volumes` maps volumes other than the archive to
directories, by number or name (case-insensitive, with or without the
colon). A path on a volume with no directory is reported.

```json
{
  "volumes": { "1": "src", "probe": "../probe-disk" }
}
```

Paths without a volume (`runpath("lib/orbit")`) are relative to the
current directory at runtime, which is not known statically. kos-ls takes
the first existing file among: the calling file's directory, the root of
the volume the calling file is on, and the archive.

# Preload

Some files are run at runtime in a way that cannot be followed, e.g. a
boot file that loads a library only if it exists on the ship's disk:

```
if exists("1:/lib/std.ks") { runoncepath("1:/lib/std.ks"). }
```

The globals of the files listed in `preload`, and of the files they run,
are visible in every other file of the workspace, without "symbol may not
exist" warnings.

```json
{
  "preload": ["src/lib/std.ks"]
}
```

# Exclude

Files and directories, e.g. generated copies of the scripts, that are not
analysed when the workspace is loaded and whose diagnostics are not
reported. They are still analysed when opened in the editor, and when
another file runs them.

```json
{
  "exclude": ["bin", "boot"]
}
```

# Bodies

A list of custom bodies to consider valid

## Example
This `ksconfig.json` will set "Earth", "Moon" and "Mars" as the only valid bodies

```json
{
  "bodies": ["Earth", "Moon", "Mars"]
}
```

# Linting
This section is used to control the level linting rules are reported. Some rules correspond to a collection of child rules. All rules can be set to the max level `"error"` or the lowest level `"off"`.

## Example

```json
{
  "linting": {
    "symbols-strict": "hint",
    "control-flow-break": "error",
    "parsing": "off",
  }
}
```

This will set all symbol lints to the hint level and break outside a loop to error, and parsing errors off.

## Available Levels
1. `"error"`
1. `"warning"`
1. `"info"`
1. `"hint"`
1. `"off"`

## Available Rules

### **All**:

This rule is the global sets all other rules. Typically the use case would be to turn off all rules.

### **Misc**

These rules are not part of a grouping other than `all` and represent an assortment of lints.

|Name|Description|Default Level|
|--|--|--|
|scanning|This provides an error when an invalid token is encountered such as `variable$$$`|error|
|parsing|This provides an error when invalid syntax is encountered such as `set x to .`|error|
|file-loading|This provides an error when the file cannot in a run statement|warning|
|file-loading-runtime|This applies to a run statement whose path is built at runtime, such as `runPath(name).`: the script it runs is not analysed|hint|
|unreachable-code|This provides an error when code is unreachable. This typically occurs when a statement occurs after a break or return statement|error|
|no-global-parameters|This provides an error when `global parameter example.` is used as globals. This will throw in kOS|error|
|uninitialized-set|This is a warning when an undeclared variable is set with `@lazyglobal off`|warning|

### **Control Flow**
The `control-flow` grouping contains rules related to control flow in your script. Below are the fules related to `control-flow`

|Name|Description|Default Level|
|--|--|--|
|control-flow-break|This provides an error when a break appears outside of a loop body|error|
|control-flow-return|This provides an error when a return appears outside of a function body or trigger|error|
|control-flow-preserve|This provides an error when preserve appears outside of a trigger body|error|
|control-flow-lazy-global|This provides an error when a directive (`@lazyglobal`, `@clobberbuiltins`) does not appear at the top of a script|error|

### **Deprecated**

The `deprecated` grouping contains rules related to deprecated functionality. This include deprecated statements listed below

|Name|Description|Default Level|
|--|--|--|
|deprecated-delete|This provides a warning that the `delete` statement is deprecated|info|
|deprecated-copy|This provides a warning that the `copy` statement is deprecated|info|
|deprecated-rename|This provides a warning that the `rename` statement is deprecated|info|

### **Symbols-Strict**

The `symbols-strict` grouping contains rules related to symbols. This includes unused, undeclared, or shadowed symbols. Below are all child rules of `symbols-strict`.

|Name|Description|Default Level|
|--|--|--|
|symbol-may-not-exist|This applies to symbols that cannot be found. The language server is imperfect cannot determine symbols from dynamic run statements such as `runOnce(someExpression).`|warning|
|symbol-may-not-exist-closure|This applies to symbols that the server cannot determine are defined before a function body or trigger is executed the first time.|warning|
|symbol-wrong-kind|This is applied to situations where a lock is expected but a variable or function is provided|warning|
|symbol-unused|This applies to situations where a local variable is declared but not used|warning|
|symbol-unused-locally|This applies to global variables that are not used locally. This is for locks and variables that are declared global but not used in there file. There are cases where the this may occur such as global constants, but the server cannot track global usage|warning|
|symbol-shadowing|This applies to cases were a symbol is redeclared in an inner scope. This is not an error but can lead to logic bugs where the outer symbol is expected|warning|
|symbol-conflict|This applies to cases were a symbol is redeclared in the same scope. This is an error in kOS|warning|
|symbol-clobber-builtin|A declaration hides a builtin that kOS does not let it hide: `set`, `local`, `global`, `parameter`, `toggle`, `x on.` and `list ... in x` may not hide a builtin function, read-only variable or system lock (`throttle`, `steering`, `wheelThrottle`, `wheelSteering`); `lock` a builtin function or variable; `function` any builtin. kOS refuses to compile it unless `@clobberbuiltins on.` (or `clobberBuiltins` in `ksconfig.json`)|error|

### **Type-Checking**

The `type-checking` grouping are rules related to types in kerboscript. This includes unused, undeclared, or shadowed symbols. Below are all child rules of `type-checking`. Note. most of the rules for the type checker are at the hint level as the overall confidence in it's accuracy is somewhat low.


|Name|Description|Default Level|
|--|--|--|
|type-wrong|This applies to situations where the type checker determines the wrong type|hint|
|type-no-call|This applies to situations where the type checker determined the given type does not have a call signature|hint|
|type-wrong-arity|This applies to situations where a function or delegate is called with the wrong number of arguments|hint|
|type-list-invalid|This applies to the list command when an invalid list string is given|hint|
|type-no-indexer|This applies to situations where the type checker determined the given type does not have an indexer|warning|
|type-missing|This applies to situations where the type checker cannot determine the type of a symbol where it is used|hint|
|type-not-function|This applies to situations where a delegate is created from something other than a function|hint|
|type-missing-suffix|This applies to situation where the type checker determines a given type does not have a given suffix|hint|
|type-missing-operator|This applies to situations where the type checker determines a given type does not have the request binary or unary operator|hint|
|type-no-setter|This applies to situation where the type checker determines a given type cannot be set|hint|
|type-no-getter|This applies to situation where the type checker determines a given type cannot be read|hint|
|type-unknown-in-doc|This applies to a type in a doc comment tag (`@param name {Type}`, `@return {Type}`) that names no kOS structure, or is malformed|warning|

### **Directives**

The `directives` grouping contains rules related to directive comments. Below are all child rules of `directives`.

|Name|Description|Default Level|
|--|--|--|
|directive-invalid-include|This applies to a `// #include` directive that is not followed by a string or a bare path|info|


