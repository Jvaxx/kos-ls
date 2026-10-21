# Test fixture provenance

The release inventory in [fixture-provenance.json](fixture-provenance.json)
records every fixture path and SHA-256, with its upstream source path/blob
where applicable. `npm run verify:sources` checks the inventory offline.

## Inventory reviewed for 2.0.0

- **278 files** are byte-for-byte identical to `kerboscripts/` in upstream
  `jonnyboyC/kos-language-server` commit
  `aff3a4743f5492a878cbfb5d2938e2e90f83cb45`.
- **6 files** under `test/fixtures/workspaces/archive/` were created in this
  fork for workspace/volume/preload regression tests.
- No fixture content was changed as part of release preparation. No
  conflicting per-file license statement was identified in the inherited
  fixture corpus. Existing author/comment text is retained unchanged.

The inherited corpus was supplied in the upstream MIT-licensed repository;
its original MIT notice is retained in
[LICENSES/kos-language-server-MIT.txt](../LICENSES/kos-language-server-MIT.txt).
That establishes the repository provenance used here, not that John Chabot
personally authored every script or independently verified every original
script author's permissions.

The six fork-created files are supplied under this fork's distribution
terms, with existing earlier MIT grants unaffected. See
[licensing](LICENSING.md).

## Public redistribution decision

Before making the repository public, the maintainer reviewed whether the
upstream license is a sufficient basis for redistributing the inherited
examples and **decided to rely on it**. The same files are already
publicly distributed by upstream under MIT, are retained byte for byte
with their notices and are used only as test inputs. No fixture carries
a conflicting license statement.

This decision does not manufacture permissions or relicense anyone else's
work. If an original script author raises a concern, please open an
issue; the affected fixture will be clarified or replaced with an
original regression example.

New fixtures should be minimal, original regression examples where
possible; record any copied material's source and compatible terms.
