# The kOS database

kos-ls knows the kOS structures, suffixes, builtin functions and bound
variables from a database generated from kOS itself:
`data/kos-<version>.json`, today `data/kos-1.6.0.1.json`. The type checker,
hover, completion and signature help all read it.

## Files

|File|Description|
|--|--|
|`data/kos-1.6.0.1.json`|The database, checked in. Schema: `src/typeChecker/database/schema.ts`|
|`data/overrides.json`|Hand corrections, applied last|
|`docs/kos-db-report.md`|The report of the last generation|
|`tools/kos-db/`|The generator|
|`src/typeChecker/database/loader.ts`|Builds the type checker's types from the database|

The database holds, for every structure, its base structure and suffixes
(access, type, parameters, aliases, units), and for functions and bound
variables their types. Types are kOS type expressions such as
`List<Part>` or `Scalar | TimeStamp`. Every entry carries its
documentation in Markdown and a link to the kOS documentation.

## Sources

The generator merges, in this order:

1. **The kOS C#** (`src/**/*.cs`): `AddSuffix` registrations give the
   suffix names, aliases, types and access (`SetSuffix` is settable),
   `[KOSNomenclature]` and the base classes the structures, `[Function]`
   classes the builtins, `AddBoundVariable` the bound variables.
   `OptionalArgsSuffix` parameters come from its array of default values.
2. **The kOS documentation** (`doc/source/**/*.rst`): descriptions, units,
   parameter names and docs, and the precise types the C# leaves out
   (it says `ListValue` where the documentation says a list of `Part`).
3. **The previous database** (`--previous`): what neither source states,
   such as element types, optional parameters of functions and their
   signatures. The C# wins where they disagree.
4. **`data/overrides.json`**, deep-merged last: objects merge, other
   values replace, `null` removes an entry, keys match case-insensitively
   and `$comment` is ignored. Use it only where the C# and the
   documentation are both wrong or silent, e.g. the signature of
   `body(name)` (the C# of functions states no types, and its
   documentation gives neither the parameter nor the return type), or the stock
   resources that kOS resolves as suffixes of Vessel and Stage at runtime.

The report lists what the merge could not settle: conflicts between the
sources, undocumented entries, and the entries the overrides add. The
sections "Types that differ from the C#" and "Documented access that
differs from the C#" keep the C#: for kOS 1.6.0.1 every entry there was
checked against the C# and the documentation is the one out of date
(e.g. TimeSpan fields are settable, `GUI:TOOLTIP` is get-only).

## Regenerating

With a kOS repository checked out at the tag of the version:

```sh
git -C /path/to/KOS checkout 1.6.0.1
npm run build
npm run kos-db -- --kos /path/to/KOS --version 1.6.0.1 \
  --previous data/kos-1.6.0.1.json --out data/kos-1.6.0.1.json
```

Regenerating from itself is a fixed point: the command above changes
nothing unless the generator or the overrides changed. Review the diff of
the database and of the report before committing.

Options: `--report` (default `docs/kos-db-report.md`), `--overrides`
(default `data/overrides.json`), `--docs-base` (default
`https://ksp-kos.github.io/KOS/`).

## A new kOS version

1. Check out the new tag in the kOS repository.
2. Run the generator with `--previous` pointing at the current database
   and `--out` at `data/kos-<new version>.json`.
3. Read the report, fix the overrides if needed, and point the import in
   `src/typeChecker/database/loader.ts` at the new file.
4. Run the tests and the probe (`npm run probe -- test/fixtures/parser_valid`)
   and compare the diagnostics with the previous version.
