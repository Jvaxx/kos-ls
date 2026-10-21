# Contributing to kos-ls

This is the independent kos-ls fork, not the upstream VS Code extension.
Please file reports and pull requests in **this repository**. Credit and
upstream base information are in [fork history](../docs/FORK.md).

## Reporting a problem

- Search existing issues first and use the bug report template.
- Include the fork version/commit, Node.js version, OS and LSP client
  version. Distinguish an installed `kos-ls` from an old upstream `kls`.
- Supply the smallest script and `ksconfig.json` that reproduce the issue,
  expected behavior and actual diagnostics or output. Include doc tags or
  formatter options if relevant, and the kOS version for language issues.
- Reproduce with `kos-ls check`, `kos-ls format` or the headless probe when
  possible; see [development](../docs/DEVELOPMENT.md).
- Redact tokens, private paths and unrelated scripts from logs and samples.
  Do not put credentials or sensitive reports in public issues.

Feature requests should explain the workflow, a concrete example and why
existing configuration or LSP features are insufficient. Editor-specific
integration is not automatically part of this server's scope.

## Patches

1. Read [the development guide](../docs/DEVELOPMENT.md),
   [configuration reference](../docs/ksconfig.md) and
   [known limitations](../docs/ROADMAP.md) as relevant.
2. Keep changes focused; add a regression test for behavior fixes. Prefer
   checked-in, minimal fixtures over paths to a local game installation.
3. Run build, lint, formatting checks, tests and bundle as documented.
   Update user docs and the unreleased changelog for visible changes.
4. Commit sources, tests and the lockfile when dependencies change, not
   disposable outputs. Keep generated database changes separate and
   review their generation report; see [the database guide](../docs/kos-db.md).
5. Explain what changed, why, how it was tested and any compatibility risk
   in the pull request. Link this repository's issues; qualify upstream
   issue references explicitly.

New contributions are GPL-3.0-only unless explicitly noted otherwise;
see [the licensing decision](../docs/LICENSING.md). Preserve upstream MIT
and other third-party notices. Do not add copied code, documentation or
scripts without recording their source and compatible terms. Update
[third-party notices](../THIRD_PARTY_NOTICES.md) and source-delivery inputs
when introducing or changing derived material.
