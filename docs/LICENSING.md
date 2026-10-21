# Licensing decision and source delivery

## Decision — 21 October 2026

The maintainer chose to retain the kOS-derived database and documentation
and distribute the **combined kos-ls work under GPL-3.0-only**. The earlier
"database licensing review required" warning is resolved by that choice
and the source/notice arrangements below, not by claiming the extracted
material is MIT or removing attribution.

Copyright (c) 2026 Jvaxx for the fork's original contributions.
The program is distributed without warranty; see [the GPL](../LICENSE).
New fork contributions are GPL-3.0-only unless explicitly noted otherwise.
Previously granted MIT rights are not withdrawn. MIT-covered upstream
portions remain available separately under their retained MIT terms.

This is the project's documented distribution policy based on the cited
source terms, not a legal opinion about every possible downstream use.

## Evidence and scope

The database targets kOS tag `1.6.0.1`, resolved to commit
`d4388439c712994e47258ed7514e863f79da632b`:

| Evidence at that revision | Finding |
| --- | --- |
| [`LICENSE.md`](https://github.com/KSP-KOS/KOS/blob/d4388439c712994e47258ed7514e863f79da632b/LICENSE.md) | GNU GPL version 3 |
| [`doc/LICENSE.md`](https://github.com/KSP-KOS/KOS/blob/d4388439c712994e47258ed7514e863f79da632b/doc/LICENSE.md) | GNU GPL version 3 |
| [`doc/source/copyright.rst`](https://github.com/KSP-KOS/KOS/blob/d4388439c712994e47258ed7514e863f79da632b/doc/source/copyright.rst) | Explicitly identifies GPL version 3 |
| [`doc/source/conf.py`](https://github.com/KSP-KOS/KOS/blob/d4388439c712994e47258ed7514e863f79da632b/doc/source/conf.py) | Credits the kOS Team, originally Nivekk, 2013–2021 |

No separate permissive grant for the extracted prose, or explicit
"or later" grant, was identified in those pinned notices. We therefore
use `GPL-3.0-only`. The JSON contains substantial adapted prose and is
imported into the bundled server/CLI; we do not rely on a claim that it is
only uncopyrightable API facts, independent aggregation or an external link.

The original language server uses MIT, whose terms are compatible with
GPLv3 when their notice is retained. Its notice, including the earlier
fork copyright, is preserved verbatim in
[LICENSES/kos-language-server-MIT.txt](../LICENSES/kos-language-server-MIT.txt).
The original kOS GPL text and input-file notices are also retained.
See [third-party notices](../THIRD_PARTY_NOTICES.md) for modifications and
attribution. The FSF's license guidance lists the
[Expat/MIT terms as GPL-compatible](https://www.gnu.org/licenses/license-list.html#Expat).

## Corresponding source

Changing the SPDX identifier alone is not sufficient for a binary release.
GPLv3 sections 1, 4–6 require appropriate notices and corresponding source
when distributing non-source forms. Our package policy therefore includes:

- Project TypeScript, CLI/launcher, generator, overrides and checked-in
  database, not just webpack bundles or source maps.
- Build/test configuration, tests, benchmarks, documentation and the
  dependency lockfile so the package is also a usable source checkout.
  Package preparation copies `package-lock.json` to `npm-shrinkwrap.json`,
  which npm includes in tarballs and accepts for `npm ci`.
- The unmodified kOS C#/RST inputs used by extraction, with original
  notices/licenses, exact revision and checksum, in
  `third_party/kos-1.6.0.1-inputs.tar.gz`.
- Root GPL, retained upstream MIT, kOS attribution and runtime dependency
  notices in `LICENSES/`.

The input archive deliberately contains the selected source used to derive
this database, not the kOS game binary or an assertion that it is a full
kOS build checkout. See [its manifest and scope](../third_party/README.md).
It includes every C# and RST file read by the generator, so database edits
and regeneration do not depend on fetching that upstream revision later.
The previous database is a checked-in input too, as documented in
[the database guide](kos-db.md).

From an unpacked npm package, install development dependencies with
`npm ci`, then use the same build/test/bundle commands as in
[the development guide](DEVELOPMENT.md). Regeneration from the included
inputs is documented in [kos-db.md](kos-db.md#regenerating).

## Release obligations

Before each distribution of bundles or an npm package:

1. Build the bundles from the source that will actually be distributed.
   Inspect the packed file list, extract the package and verify that its
   included source builds and its kOS inputs regenerate the database.
2. Keep the GPL, upstream MIT, kOS attribution/modification notices and
   third-party dependency notices with every distribution. Do not advertise
   the combined package as MIT or as an official kOS release.
3. Include source with the binaries, as the npm allowlist does. If a future
   channel separates binaries from source, provide equally accessible,
   matching source and clear instructions, and maintain availability for
   as long as required. A generic link to another project's latest source
   or a private repository is not a substitute for matching source.
4. Review the exact bundled dependency source and notices too; the
   lockfile and license copies identify dependencies but are not by
   themselves a complete source-delivery solution for compiled libraries.
   Supply any additional required non-system dependency sources with the
   release or through a compliant source-access arrangement.
5. Update input snapshots, manifests and notices when changing the target
   kOS revision. Respect GPL obligations for further modifications and
   redistribution; consult the license for the full conditions.

The FSF explains [source access on another site](https://www.gnu.org/licenses/gpl-faq.html#SourceAndBinaryOnDifferentSites)
and [matching source for modified binaries](https://www.gnu.org/licenses/gpl-faq.html#DistributeExtendedBinary).
This policy does not imply that unrelated user Kerboscript programs or
editors become GPL merely by using the language server.

## Separate publication checks

The kOS database licensing choice does not establish redistribution rights
for every inherited third-party script fixture, nor complete a security
review of hosting settings, logs or attachments. Those remain separate
items in [the publication checklist](PUBLISHING.md).
