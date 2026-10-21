# Third-party notices and provenance

The combined kos-ls distribution is **GPL-3.0-only**; see [LICENSE](LICENSE)
and [the licensing decision](docs/LICENSING.md). Third-party components
retain their original terms and notices. Existing MIT grants are not
withdrawn, and no third-party material is represented as newly MIT-licensed.

## kos-language-server

Derived from [John Chabot's kos-language-server](https://github.com/jonnyboyC/kos-language-server),
base commit `aff3a4743f5492a878cbfb5d2938e2e90f83cb45`.

Copyright (c) 2018 John Chabot.
Copyright (c) 2026 Jvaxx (kos-ls fork).

The MIT license notice previously at the repository root is preserved
verbatim in [LICENSES/kos-language-server-MIT.txt](LICENSES/kos-language-server-MIT.txt).
MIT-covered portions may still be used separately under those terms.
See [fork history](docs/FORK.md) for changes and attribution.

The historical changelog and inherited parser fixtures come from that
repository too. Preserve author/license notices in individual fixtures.
The [fixture inventory and review](docs/FIXTURES.md) trace all 278 inherited
files byte-for-byte to upstream and distinguish six fork-created files.
They are redistributed under upstream's MIT grant; see the fixture review
for the basis of that decision.

## kOS-derived database

`data/kos-1.6.0.1.json` is derived from
[kOS 1.6.0.1](https://github.com/KSP-KOS/KOS/tree/d4388439c712994e47258ed7514e863f79da632b),
commit `d4388439c712994e47258ed7514e863f79da632b`.
The database, its documentation and derived corrections are distributed
under GPL-3.0-only as part of this work.

Documentation attribution, retained from `doc/source/conf.py`:

> 2013-2021, Developed and maintained by kOS Team, Originally By Nivekk

Individual kOS contributors retain their rights and source notices.
The Free Software Foundation's copyright on the GPL text is not a claim
that it authored kOS or its documentation.

### Sources and terms

- [kOS C# source](https://github.com/KSP-KOS/KOS/tree/d4388439c712994e47258ed7514e863f79da632b/src)
- [Sphinx documentation source](https://github.com/KSP-KOS/KOS/tree/d4388439c712994e47258ed7514e863f79da632b/doc/source)
- [Root GPLv3 license](https://github.com/KSP-KOS/KOS/blob/d4388439c712994e47258ed7514e863f79da632b/LICENSE.md)
- [Documentation GPLv3 license](https://github.com/KSP-KOS/KOS/blob/d4388439c712994e47258ed7514e863f79da632b/doc/LICENSE.md)
- [Explicit documentation license statement](https://github.com/KSP-KOS/KOS/blob/d4388439c712994e47258ed7514e863f79da632b/doc/source/copyright.rst)

The pinned source states GPL version 3 without an additional grant of
later versions; this project uses the conservative identifier
`GPL-3.0-only`, not `GPL-3.0-or-later`. A verbatim copy of the kOS license
is retained in [LICENSES/kOS-GPL-3.0.md](LICENSES/kOS-GPL-3.0.md).

### Modifications and source delivery

The database was generated and modified for kos-ls in October 2026:
C# metadata extracted, reStructuredText converted to Markdown, entries
merged/refined using previous definitions, and corrections applied from
`data/overrides.json`. These are not unmodified kOS documentation files,
and kos-ls is not an official or endorsed kOS release.

The complete selected C#/RST extraction inputs, unchanged from the pinned
revision, are in `third_party/kos-1.6.0.1-inputs.tar.gz`, with a SHA-256
manifest. The archive retains source notices and both original licenses.
It is source material, not a disposable build artifact; see
[third_party/README.md](third_party/README.md) for its precise scope.

Packages include the project TypeScript, generator, overrides, database,
lockfile, build configuration and this source snapshot, not just compiled
bundles. See [docs/LICENSING.md](docs/LICENSING.md) for source-delivery and
release obligations, and [docs/kos-db.md](docs/kos-db.md) for regeneration.

## npm dependencies

Runtime dependencies currently declare MIT or Apache-2.0 terms, both
compatible with GPLv3. Their notices are retained separately in
[LICENSES/npm/](LICENSES/npm/) and in any webpack-generated
`dist/*.LICENSE.txt` files. Do not remove the original licenses or imply
that dependencies were authored by kos-ls contributors.

`package-lock.json` pins the exact dependency tree and integrity hashes.
The [six archives and manifest in third_party/npm/](third_party/npm/README.md)
contain complete editable source trees for all ten locked runtime
packages, including the original TypeScript and build files where
applicable. One skipped `vscode-uri` regression-test URL was neutralized
on 21 October 2026 to avoid redistributing an embedded image-download
bearer token; runtime source and all original notices are unchanged, and
the source manifest records the modification. Archive package versions were checked against npm versions;
`npm run verify:sources` checks hashes and full version/integrity coverage
offline. These sources accompany release packages, not merely links to
upstream default branches. Refresh them and their notices when dependencies
change; development tools have their own terms.
