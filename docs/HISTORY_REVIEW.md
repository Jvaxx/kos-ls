# Pre-publication history and privacy review

Reviewed on **21 October 2026**. This records scope and actions without
reproducing the removed private notes, addresses or filesystem layout.
It is a bounded review, not a guarantee that every possible secret or
privacy concern has been identified.

## Scope and findings

- Secret scanning with **Gitleaks 8.30.1**, default rules, redacted reports,
  against all local branches/tags (`--all --full-history`) and an export
  of the current source tree including pending files. No credentials were
  reported. The initial history scan processed 730 commits; Git's total
  reachable-commit count also includes merges/other refs not represented
  as distinct scanned patches.
- Additional scans of reachable blob contents and commit metadata for
  credential signatures and machine-specific paths.
- Manual review of all distinct historical handoff content and the 94
  fork commit messages before rewriting; inspection of author/committer
  identities and the old benchmark dump's machine-path fields.

The handoff versions exposed local editor/dotfiles/game-directory layout,
personal script/workflow details and development-session notes. They were
not appropriate public project documentation. The benchmark export was
machine-specific output rather than a useful portable baseline. No
credential rotation was indicated by these findings.

Fork commits also carried a personal email address. The maintainer
**explicitly chose to retain it** in author and committer metadata.
Upstream authors and their already-public attribution were not anonymized.

## Sanitization performed

With the maintainer's approval, a private backup of all refs, Git metadata
and the full pending source working tree was made outside this repository.
The commit map and detailed audit reports are private too; do not publish
those backups or reports as repository artifacts.

The rewrite was prepared in an isolated mirror and restricted to commits
**after** upstream base `aff3a4743f5492a878cbfb5d2938e2e90f83cb45`:

- Remove `handoff.md` and root `benchmark.data.json` from every fork
  revision, not merely the tip.
- Replace home-directory-specific project examples in remaining fork
  documentation/tool comments with neutral `/path/to/...` examples.
- Drop commits made empty by removing private notes; preserve technical
  changes and original author/committer identities.
- Keep all upstream commits, remote-tracking refs and historical upstream
  tags intact. Already-public upstream benchmark history and metadata
  remain; this is not a rewrite of someone else's public history.
- Update the fork's provenance reference and formatting-only blame-ignore
  hash for the rewritten commits.

The fork history changed from 94 to 80 commits. The original upstream base
remains an ancestor with its original hash. All 546 current source files
and their modes were verified unchanged while replacing the branch/index,
and the four pre-existing parser/type-checker/test edits were preserved.
Subsequent licensing/documentation changes are separate pending edits.

The public-facing refs no longer reach the removed fork notes/results.
Private backup objects and local reflogs may still retain original history
for recovery; normal Git pushes/clones do not publish those unreachable
objects or reflogs. Do not copy `.git` or push private backup refs.

## Rechecking before publication

Install Gitleaks outside the project, then run from the repository root:

```sh
gitleaks git . --log-opts='--all --full-history' --redact --no-banner
```

Also scan a clean export containing the actual files to be published,
including new uncommitted files if applicable; do not mistake a history
scan for a working-tree scan. Keep reports outside the public tree and
review archive contents, source maps and commit metadata as well.

Confirm `git log --all -- handoff.md benchmark.data.json` has no fork
entries and no branch/tag to publish points at the pre-sanitization fork.
Publish only deliberately selected refs, not a mirror of private backup
repositories. After committing final changes, repeat the scan on exactly
that tip and inspect the final package/source artifacts.

## Not covered by local history cleanup

- GitHub settings, Actions logs/artifacts, releases, attachments, external
  forks/caches and previously downloaded copies, if any.
- Private files outside this repository, system configuration or unrelated
  script repositories; none were modified by this review.
- The separate inherited-fixture rights audit and per-release dependency
  source/notice checks in [the publication checklist](PUBLISHING.md).

## Post-rewrite verification

- Gitleaks scanned 716 historical commit patches after sanitization and
  reported no credentials; the final source export, including the nested
  kOS source archive, also had no findings.
- All 5,759 reachable blobs and all commit messages were checked against
  the identified private-path markers; none remained. Every upstream ref
  and tag was verified unchanged, and no extra public-facing ref was added.
- The extracted npm package was scanned too, including bundles, maps and
  archived inputs. Its three `generic-api-key` findings were manually
  confirmed as the same minified `TokenType.global` / `ScopeKind.global`
  assignment in three bundles, traceable to `src/analysis/preResolver.ts`,
  not credential values. No broad scanner suppression was added.
- The 643 archived kOS input files matched the pinned Git blobs byte for
  byte, and regeneration reproduced both the database and report exactly.
- All 999 tests passed both in the working checkout and after installing,
  cleaning and rebuilding an extracted source package with its included
  shrinkwrap lockfile. Build, bundle, lint and formatting checks passed.

These results describe the pre-release privacy-cleanup checkpoint. Release
preparation repeats the scans against the committed candidate and exact
artifacts as described in [RELEASING.md](RELEASING.md).

During this history-cleanup operation, no remote was pushed, repository
visibility was not changed, and no credentials/public keys were revoked.
The later 2.0.0 release is hosted in the private
[Jvaxx/kos-ls repository](https://github.com/Jvaxx/kos-ls); see
[its release notes](releases/v2.0.0.md).
