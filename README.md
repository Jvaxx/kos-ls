# kos-ls

A language server for Kerboscript, the language of the
[kOS](https://github.com/KSP-KOS/KOS) mod for Kerbal Space Program.

kos-ls is a maintained fork of John Chabot's
[kos-language-server](https://github.com/jonnyboyC/kos-language-server),
which is no longer maintained. It is a standalone server for any LSP client
(Neovim first); the VS Code extension of the original project is not part of
this fork.

Status: under active rework, see [docs/ROADMAP.md](docs/ROADMAP.md).

## Building

Requires Node.js 22 or later.

```sh
npm install
npm run build     # TypeScript to out/
npm test
npm run bundle    # single-file server in dist/, used by bin/kos-ls
npm link          # puts kos-ls (and the kls alias) on the PATH
```

## Neovim

```lua
vim.lsp.config("kos_ls", {
    cmd = { "kos-ls", "--stdio" },
    filetypes = { "kerboscript" },
    root_markers = { "ksconfig.json", ".git" },
})
vim.lsp.enable("kos_ls")
```

## Client settings

Read from the `kos-ls` settings section (`kos-vscode`, the section of
kos-language-server, is still read when `kos-ls` is absent):

|Setting|Values|Default|
|--|--|--|
|`completionCase`|`lowercase`, `uppercase`, `camelcase`, `pascalcase`|`camelcase`|
|`trace.server.level`|`verbose`, `info`, `log`, `warn`, `error`, `none`|`error`|

```lua
vim.lsp.config("kos_ls", {
    settings = { ["kos-ls"] = { completionCase = "lowercase" } },
})
```

## Workspace configuration

A `ksconfig.json` at the root of the workspace sets the archive (`0:`)
and other volume directories, files preloaded at runtime (such as a
library a boot file loads), excluded directories, custom bodies and lint
levels. See [docs/ksconfig.md](docs/ksconfig.md).

## Developer tools

`npm run probe -- <root> [files...]` starts the server headlessly, opens the
files (all `.ks` under `<root>` by default) and prints the diagnostics it
publishes. `--server <cmd...> --` runs another server instead, for
comparisons.

## License

MIT, see [LICENSE](LICENSE).
