# Publication and release checks

Repository: [Jvaxx/kos-ls](https://github.com/Jvaxx/kos-ls).
The repository is **public**; **2.0.0** is its first stable GitHub
release. Neither publishes to npm. See [RELEASING.md](RELEASING.md) for
the repeatable release procedure and [2.0.0 notes](releases/v2.0.0.md).

## Completed preparation

- [x] Choose GPL-3.0-only for the combined server/database; retain upstream
  MIT grants, kOS notices, editable extraction inputs and source delivery.
  See [licensing](LICENSING.md) and [third-party notices](../THIRD_PARTY_NOTICES.md).
- [x] Align root license, package/lock metadata, documentation and the
  source-inclusive package allowlist. Supply an exact generated shrinkwrap.
- [x] Archive complete editable source for all ten runtime dependencies,
  recording exact revisions, versions, npm integrity values and source
  checksums; retain dependency notices and add offline verification.
- [x] Inventory every fixture: 278 unchanged upstream files, six
  fork-created files. Record source blobs and hashes without claiming the
  upstream server author wrote every script; see [fixture review](FIXTURES.md).
- [x] Preserve upstream attribution, the exact base and historical releases.
- [x] Review/sanitize local fork history and private notes, preserve upstream
  history, scan for secrets, and keep private recovery backups outside the
  repository. Retain the commit email as explicitly requested; see
  [privacy review](HISTORY_REVIEW.md).
- [x] Create `Jvaxx/kos-ls` (initially private) and configure
  repository/homepage/issue links. Keep `origin` separate from `upstream`,
  enable issues/security alerts, disable the unused wiki and use read-only
  Actions permissions.

## For every release

- [ ] Commit all reviewed changes, then scan the exact candidate history,
  clean source tree and extracted artifacts, including nested source inputs.
  Do not publish backup refs, reflogs, raw audit reports or local paths.
- [ ] Run source verification, build, lint, formatting, full tests and
  bundle; confirm [CI](https://github.com/Jvaxx/kos-ls/actions/workflows/node.js.yml)
  passes on Node.js 22 and 24 for the exact candidate and tag.
- [ ] Regenerate the database/report from archived kOS inputs and compare
  byte-for-byte. Verify source manifests and current dependency notices.
- [ ] Extract the package, install using its shrinkwrap, and build/test its
  included source. Test a clean temporary-prefix installation of the `.tgz`,
  CLI commands and stdio LSP startup. Inspect source maps as public material.
- [ ] Include source, licenses, notices, source-input snapshots and SPDX
  runtime inventory. Generate and verify SHA-256 checksums for all assets.
- [ ] Verify the annotated tag target and draft release, download assets
  and recheck checksums, then publish with the intended stable/prerelease
  flag. Confirm the resulting URL and asset set.
- [ ] Keep tracked build artifacts/reports out of Git and leave a clean
  working tree. Source snapshots and inventories remain versioned inputs.

## Making the repository public

Completed on 21 October 2026, before the visibility change:

- [x] Decide the independent fixture-author permission question: rely on
  upstream's MIT grant and replace any fixture on request; see
  [FIXTURES.md](FIXTURES.md).
- [x] Review hosted material: all four Actions run logs contain no
  credentials, personal paths or addresses; there are no Actions
  artifacts; the 2.0.0 release has exactly its four checksummed assets.
- [x] Gitleaks 8.30.1 found no credentials in the published refs (`main`
  and `v2.0.0`, 686 commits) or the clean source tree. In the extracted
  release assets, it reported only the three known minified
  `TokenType.global` false positives described in
  [the history review](HISTORY_REVIEW.md). Only `main` and `v2.0.0` are
  pushed to `origin`. The commit email is retained as accepted.
- [x] Update documentation and release notes for public installation and
  add a [security policy](../.github/SECURITY.md).

After the visibility change:

- [ ] Enable private vulnerability reporting, which the security policy
  relies on, and Dependabot alerts.
- [ ] Protect `main` against force pushes and deletion. Branch protection
  is unavailable for private repositories on the current plan.

There is no automatic npm publish workflow. Review npm ownership, naming,
credentials, registry visibility and source-delivery requirements separately
before any registry publication.
