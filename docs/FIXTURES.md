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

## Before changing repository visibility

The repository and its first release remain **private by the maintainer's
choice**. Before public redistribution, review whether relying on the
upstream repository's license is sufficient for these third-party examples,
and seek clarification or replace any fixture whose original rights are
uncertain. This inventory does not manufacture permissions or relicense
someone else's work. A private stable release is not a claim that the
independent fixture-author rights review has been completed.

New fixtures should be minimal, original regression examples where
possible; record any copied material's source and compatible terms.
