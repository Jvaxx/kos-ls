# Editable runtime dependency sources

The six archives listed in `sources.json` contain the complete upstream
source trees for the **ten runtime packages** pinned by the release lockfile.
They are source inputs, not disposable build output. Project packages and
release source archives include them alongside the installed-package license
notices in [LICENSES/npm/](../../LICENSES/npm/).

The manifest records immutable Git revisions, download URLs, archive
SHA-256 values, archive prefixes, package directories, versions, original
licenses and npm integrity hashes. Each archived `package.json` was checked
against the corresponding locked runtime package version. Microsoft LSP
packages share one source revision, identified by their exact release tags;
other revisions come from release tags or npm's `gitHead` metadata.

Five archives are unmodified upstream snapshots. The `vscode-uri` archive
is explicitly named `-sanitized`: one bearer-style image-download URL in
its skipped `src/test/uri.test.ts` regression case was replaced with an
inert `example.invalid` URL on 21 October 2026. Runtime source, notices,
versions and all other files are unchanged. The manifest records that
modification; its download URL identifies the original upstream input,
while its checksum identifies the distributed sanitized archive.

Original notices and build files are retained. The MIT/Apache-2.0 terms
remain in force; including these sources does not imply kos-ls authored
the upstream projects.
Development-only tools are not bundled in the runtime and are installed
using the source package's lockfile as normal.

Run `npm run verify:sources` to verify archive checksums, complete runtime
version/integrity coverage and the separate fixture inventory without any
network access. Rebuilding kos-ls uses `npm ci` to obtain the pinned npm
packages; the archived source preserves their editable originals rather
than depending solely on future availability of remote repositories.

When dependencies change, select the exact matching upstream source
revision, verify its package versions, refresh the archives/manifest and
license notices, and rerun source, package and clean-install checks. Do not
replace a matching source snapshot with a link to an upstream default branch.
