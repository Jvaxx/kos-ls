# Before making the repository public

This checklist separates completed local preparation from the remaining
publication/release checks. Nothing here publishes a repository or package.

## Rights and provenance

- [x] Resolve the kOS-derived database licensing choice: the maintainer
  selected **GPL-3.0-only for the combined distribution**, retaining
  upstream MIT terms, original kOS notices and pinned editable extraction
  inputs. See [the decision](LICENSING.md) and
  [third-party notices](../THIRD_PARTY_NOTICES.md).
- [x] Update root license, package/lockfile metadata, source-package
  allowlist and documentation to match that choice. Packages include
  project source and the kOS input snapshot rather than only bundles.
- [ ] Audit inherited fixture author/license notices and redistribution
  rights. Do not assume every script author was the upstream server author;
  GPL licensing of the combined project does not cure missing permissions.
- [ ] For each binary/package release, review actual bundled dependency
  notices and corresponding-source requirements. Retained notices and a
  lockfile identify dependencies but do not replace required source.
- [x] Preserve upstream attribution and the exact unchanged upstream base
  in [FORK.md](FORK.md), with historical release notes clearly labeled.

## Privacy and repository configuration

- [x] Review local history, handoff content, fork commit messages, author
  identities and machine paths; run a dedicated secret scanner. No
  credentials were reported. See [scope and limitations](HISTORY_REVIEW.md).
- [x] Back up and sanitize fork history with approval: remove private notes
  and fork benchmark results from all fork revisions; neutralize local
  project paths. Keep upstream history intact. The maintainer explicitly
  chose to retain the existing commit email address.
- [ ] Commit the final reviewed source changes, then repeat history and
  working-tree/archive scans against the exact tip/artifacts to be published.
  Do not publish private backups, audit reports, reflogs or old fork refs.
- [ ] Review GitHub Actions logs/artifacts, releases, attachments and
  hosting settings for private material, if such hosted material exists.
- [ ] Choose the fork's public URL. Add `repository`, `homepage` and `bugs`
  package metadata then; do not redirect fork reports upstream or guess
  an owner/URL. Keep `upstream` separate from the fork's `origin`.
- [ ] Configure issue/discussion channels, branch protection and security
  alerts as desired. Templates must not assign upstream authors or assume
  the original VS Code extension is installed.

## Verification

From a clean checkout using a CI-supported Node.js version:

```sh
npm ci
npm run clean
npm run build
npm run lint
npm run prettier:check
npm test -- --maxWorkers=2
npm run bundle
./bin/kos-ls --version
./bin/kos-ls format --help
./bin/kos-ls check --help
./bin/kos-ls size --help
npm run prepare:package
npm pack --dry-run --ignore-scripts
```

- [ ] Confirm CI passes on every supported Node.js version. Test the
  documented editor setup and CLI on a small example workspace.
- [ ] Inspect/extract the package: bundles/maps, launcher, matching project
  source/build files, generated shrinkwrap lockfile, kOS input snapshot and
  required licenses/notices.
  No private history, local reports, benchmark results or secrets. Source
  maps contain source text and must be reviewed as public material.
- [ ] Build and test the **included source**, and regenerate the database
  from the archived inputs; compare with the distributed database/report.
- [ ] Review `git status --short --ignored`: outputs should be ignored,
  while sources, lockfile, fixtures, database and third-party source inputs
  remain tracked after committing.
- [ ] Review [known limitations](ROADMAP.md), [licensing/source delivery](LICENSING.md)
  and the unreleased changelog. Choose a stable version/tag only when
  actually releasing; changing visibility does not release `2.0.0-dev`.

Making source public does not require publishing to npm. There is no
automatic publish workflow; npm ownership, credentials and release contents
must be reviewed separately if a package release is later desired.
