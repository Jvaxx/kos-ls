#!/usr/bin/env node
// Headless LSP client: starts a kls server over stdio, opens files under a
// workspace root and prints the diagnostics it publishes.
//
//   node tools/lsp-probe.js [--server <cmd...> --] <root> [file...]
//
// Without files, every .ks under <root> is opened. The default server is
// this checkout's compiled out/src/server.js.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const rpc = require('vscode-jsonrpc/node');

let args = process.argv.slice(2);
let server = ['node', path.join(__dirname, '../out/src/server.js'), '--stdio'];
if (args[0] === '--server') {
  const end = args.indexOf('--');
  server = args.slice(1, end);
  args = args.slice(end + 1);
}
const root = path.resolve(args[0]);
const walk = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.name.startsWith('.') ? [] : e.isDirectory() ? walk(path.join(dir, e.name))
      : e.name.endsWith('.ks') ? [path.join(dir, e.name)] : []);
const files = args.length > 1 ? args.slice(1).map(f => path.resolve(f)) : walk(root);

const proc = spawn(server[0], server.slice(1), { stdio: ['pipe', 'pipe', 'inherit'] });
const conn = rpc.createMessageConnection(
  new rpc.StreamMessageReader(proc.stdout), new rpc.StreamMessageWriter(proc.stdin));
const uri = f => 'file://' + f;
const diags = new Map();
conn.onNotification('textDocument/publishDiagnostics', p => diags.set(p.uri, p.diagnostics));
conn.onNotification('window/logMessage', () => {});
conn.onRequest('workspace/configuration', p => p.items.map(() => null));
conn.onRequest('client/registerCapability', () => null);
conn.listen();

(async () => {
  await conn.sendRequest('initialize', {
    processId: process.pid, rootUri: uri(root), rootPath: root,
    capabilities: { workspace: { configuration: true } },
  });
  conn.sendNotification('initialized', {});
  if (process.env.PROBE_OPEN_DELAY) await new Promise(r => setTimeout(r, +process.env.PROBE_OPEN_DELAY));
  for (const f of files) {
    conn.sendNotification('textDocument/didOpen', {
      textDocument: { uri: uri(f), languageId: 'kerboscript', version: 1, text: fs.readFileSync(f, 'utf8') },
    });
  }
  // kls debounces workspace loading and propagation (4 s): wait for it to settle
  await new Promise(r => setTimeout(r, 7000));
  const sev = ['', 'error', 'warning', 'info', 'hint'];
  for (const f of files) {
    for (const d of diags.get(uri(f)) ?? []) {
      const { line, character } = d.range.start;
      console.log(`${path.relative(root, f)}:${line + 1}:${character + 1}: ${sev[d.severity]}: ${d.message}`);
    }
  }
  proc.kill();
  process.exit(0);
})();
