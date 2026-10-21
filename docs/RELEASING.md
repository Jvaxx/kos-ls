# Releasing kos-ls

Repository: [Jvaxx/kos-ls](https://github.com/Jvaxx/kos-ls).
Releases: [GitHub releases](https://github.com/Jvaxx/kos-ls/releases).
The repository is currently private; release downloads require access.
A stable GitHub release does **not** publish a package to npm or change
repository visibility.

## Prepare and commit

1. Review [licensing/source delivery](LICENSING.md),
   [fixture provenance](FIXTURES.md), [privacy review](HISTORY_REVIEW.md)
   and [publication checks](PUBLISHING.md). Refresh dependency source
   snapshots/notices when changing the lockfile.
2. Set a SemVer version without prematurely making a tag:
   `npm version <version> --no-git-tag-version --ignore-scripts`.
   Update the changelog, README, fork status, release notes and package
   repository/homepage/issue links.
3. Use Node.js 22.13 or later. Run `npm ci`, `npm run verify:sources`,
   build, lint, formatting checks, the full tests and bundle. Test the
   supported Node.js 22 and 24 lines. Confirm CLI/LSP smoke checks and
   regenerate the database/report from the archived inputs.
4. Commit focused changes and push only the intended `main` branch to
   **origin**, not upstream. Wait for
   [CI](https://github.com/Jvaxx/kos-ls/actions/workflows/node.js.yml)
   to pass on the exact candidate commit. Do not push private backup refs
   or all inherited upstream tags.

## Build assets from the candidate commit

Use a fresh detached checkout of the committed candidate, not a dirty
working tree. Build and bundle there, run package preparation, then:

```sh
npm run verify:sources
npm run prepare:package
npm pack --ignore-scripts --pack-destination /path/to/release-assets
npm sbom --omit=dev --sbom-format=spdx > /path/to/release-assets/kos-ls-<version>.spdx.json
```

`npm pack --ignore-scripts` is safe here only because the clean checkout
has already been built/tested/bundled. Normal `npm pack` runs `prepack`.
The installable `.tgz` includes matching project source, tests, shrinkwrap,
editable kOS/runtime dependency inputs and license notices. It is portable
across supported Node.js platforms; it is not a native executable.

Also create an explicit source archive of that exact committed tree:

```sh
git archive --format=tar --prefix=kos-ls-<version>/ HEAD | gzip -n \
  > /path/to/release-assets/kos-ls-<version>-source.tar.gz
```

Extract both archives. Verify the lockfile and source manifests, reinstall
and build/test from the extracted source package, and install the `.tgz`
into a temporary npm prefix. Smoke-test `kos-ls --version`, CLI commands
and stdio LSP startup. Inspect the SPDX inventory for the exact runtime
versions and review it for local paths or private metadata.

## Scan, tag and publish

- Run a dedicated secret scanner against the exact candidate history,
  clean source tree and extracted release artifacts, including nested
  source archives. Review false positives individually; do not broadly
  exclude generated bundles. Keep redacted reports outside the repository.
- Generate `SHA256SUMS` for the `.tgz`, explicit source archive and SPDX
  inventory. Verify checksums locally before upload.
- Create an annotated `v<version>` tag on the tested commit. Push that tag
  explicitly, wait for tag CI, and create a **draft** GitHub release with
  the verified assets and curated installation/migration/limitation notes.
- Check the tag target, version, prerelease flag, visibility, asset names
  and checksums. Download the draft assets with authenticated `gh` and
  verify them again before publishing. Use a prerelease flag only when
  intended; `v2.0.0` is the maintainer-selected stable first fork release.
- Publish the draft only after those checks. Confirm the final release
  URL, tag target and asset set; leave the working tree clean.

Publishing a GitHub release does not authorize a later visibility change
or npm publication. Recheck the outstanding items in [PUBLISHING.md](PUBLISHING.md)
before either action.
