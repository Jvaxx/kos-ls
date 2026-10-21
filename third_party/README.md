# Pinned third-party source inputs

The kOS database inputs below and the [runtime dependency sources](npm/README.md)
are versioned editable source snapshots shipped with releases. Run
`npm run verify:sources` to verify them offline.

## kOS database source inputs

`kos-1.6.0.1-inputs.tar.gz` contains **643 unmodified source/license files**
from kOS commit `d4388439c712994e47258ed7514e863f79da632b` (tag `1.6.0.1`).
The archive is distributed under GPL-3.0-only with the combined project.
Attribution: kOS Team, originally Nivekk, and individual contributors;
original notices are preserved inside the archive.

The companion `kos-1.6.0.1-inputs.json` records the exact selection,
SHA-256, revision and extraction prefix. The files are:

- All `src/**/*.cs` (including tests; the generator skips test projects
  by path as usual).
- All `doc/source/**/*.rst`.
- `LICENSE.md`, `doc/LICENSE.md` and `doc/source/conf.py`.

These are the complete text inputs read by `tools/kos-db/generate.ts`,
plus attribution/license material. This is **not** the whole kOS game/mod
source tree, its images, game dependencies, or a working kOS build checkout.
No game binary is included. Ordinary kos-ls builds do not use this archive;
it preserves preferred editable inputs for the derived database and makes
regeneration possible without another download.

### Verify and extract

From the repository/package root:

```sh
node -e 'const f=require("fs"),c=require("crypto"),m=require("./third_party/kos-1.6.0.1-inputs.json"); if(c.createHash("sha256").update(f.readFileSync("third_party/"+m.archive)).digest("hex")!==m.sha256) process.exit(1)'
mkdir -p /tmp/kos-db-inputs
tar -xzf third_party/kos-1.6.0.1-inputs.tar.gz -C /tmp/kos-db-inputs
```

Use `/tmp/kos-db-inputs/kos-1.6.0.1` as `--kos` for regeneration;
see [the database guide](../docs/kos-db.md#regenerating). Choose a fresh
scratch directory; the archive paths are rooted under `kos-1.6.0.1/`.

### Refreshing the snapshot

Use an unmodified official kOS checkout at the intended revision. Select
exactly the paths above, archive them with `git archive --format=tar
--prefix=kos-<version>/ <revision> -- <selected paths...>`, and gzip with a
zero timestamp. Record its SHA-256 and file count in the manifest.
Verify every extracted file against its Git blob, regenerate the database
and report, run tests, and review notices before committing the update.

This source snapshot and manifest are versioned inputs, **not** generated
build clutter. Cleanup must not remove them. See
[licensing/source delivery](../docs/LICENSING.md) and
[third-party notices](../THIRD_PARTY_NOTICES.md).
