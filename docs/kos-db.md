# The kOS database

kos-ls knows the kOS structures, suffixes, builtin functions and bound
variables from a database generated from kOS itself:
`data/kos-<version>.json`, currently `data/kos-1.6.0.1.json`. The type
checker, hover, completion and signature help all read it. This is a
required runtime input, not disposable build output; keep it and the
generation report in version control.

The database and derived documentation are distributed under GPL-3.0-only
with the combined project. See [provenance](../THIRD_PARTY_NOTICES.md) and
[the licensing/source-delivery policy](LICENSING.md). The unmodified pinned
C#/RST extraction inputs are retained in `third_party/`, not downloaded as
part of ordinary builds.

## Files

|File|Description|
|--|--|
|`data/kos-1.6.0.1.json`|The database, checked in. Schema: `src/typeChecker/database/schema.ts`|
|`data/overrides.json`|Hand corrections, applied last|
|`docs/kos-db-report.md`|The report of the last generation|
|`tools/kos-db/`|The generator|
|`third_party/kos-1.6.0.1-inputs.tar.gz`|Pinned editable C#/RST inputs, licenses and attribution|
|`third_party/kos-1.6.0.1-inputs.json`|Exact upstream revision, selection and SHA-256|
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

Ordinary builds/tests use the checked-in database and need no kOS checkout.
To regenerate without fetching upstream, verify the SHA-256 as described in
[the input snapshot guide](../third_party/README.md), then extract to a
fresh scratch directory:

```sh
mkdir -p /tmp/kos-db-inputs
tar -xzf third_party/kos-1.6.0.1-inputs.tar.gz -C /tmp/kos-db-inputs
npm run build
npm run kos-db -- --kos /tmp/kos-db-inputs/kos-1.6.0.1 --version 1.6.0.1 \
  --previous data/kos-1.6.0.1.json --out data/kos-1.6.0.1.json
```

Alternatively, use a separate official [kOS checkout](https://github.com/KSP-KOS/KOS)
at commit `d4388439c712994e47258ed7514e863f79da632b` (tag `1.6.0.1`) as
`--kos`. The generator reads the source tree; it does not build or run kOS.

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
4. Refresh the pinned input snapshot/manifest, attribution and license
   evidence as described in [third_party/README.md](../third_party/README.md).
   Verify regeneration against those archived inputs, not just a local checkout.
5. Run the tests and the probe (`npm run probe -- test/fixtures/parser_valid`)
   and compare the diagnostics with the previous version.
