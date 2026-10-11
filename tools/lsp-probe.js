#!/usr/bin/env node
// Headless LSP client: starts a kls server over stdio, opens files under a
// workspace root and prints the diagnostics it publishes.
//
//   node tools/lsp-probe.js [--server <cmd...> --]
//     [--ask <method> <file>:<line>:<col>]... <root> [file...]
//
// Without files, every .ks under <root> is opened. The default server is
// this checkout's compiled out/src/server.js. Each --ask sends a position
// request (e.g. textDocument/hover, textDocument/completion,
// textDocument/signatureHelp; 1-based line and column) and prints its
// JSON result instead of the diagnostics. For a completion, the first
// item is also resolved (completionItem/resolve).
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const rpc = require('vscode-jsonrpc/node');
const { URI } = require('vscode-uri');

let args = process.argv.slice(2);
let server = ['node', path.join(__dirname, '../out/src/server.js'), '--stdio'];
if (args[0] === '--server') {
  const end = args.indexOf('--');
  server = args.slice(1, end);
  args = args.slice(end + 1);
}
const asks = [];
while (args[0] === '--ask') {
  const [method, where] = args.slice(1, 3);
  const [file, line, col] = where.split(':');
  asks.push({ method, file: path.resolve(file), line: +line - 1, character: +col - 1 });
  args = args.slice(3);
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
// the server's own form (spaces are %20): a raw path names another document
const uri = f => URI.file(f).toString();
const diags = new Map();
let lastPublish = Date.now();
conn.onNotification('textDocument/publishDiagnostics', p => {
  diags.set(p.uri, p.diagnostics);
  lastPublish = Date.now();
});
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
  // kls debounces workspace loading and propagation (4 s): wait for it to
  // settle, then until no diagnostics were published for PROBE_QUIET ms
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await sleep(7000);
  const quiet = +(process.env.PROBE_QUIET ?? 6000);
  while (Date.now() - lastPublish < quiet) {
    await sleep(quiet - (Date.now() - lastPublish));
  }
  if (asks.length > 0) {
    for (const { method, file, line, character } of asks) {
      const result = await conn.sendRequest(method, {
        textDocument: { uri: uri(file) }, position: { line, character },
      });
      console.log(`${method} ${path.relative(root, file)}:${line + 1}:${character + 1}`);
      console.log(JSON.stringify(result, null, 2));
      const items = Array.isArray(result) ? result : result?.items;
      if (method === 'textDocument/completion' && items?.length > 0) {
        console.log('completionItem/resolve');
        console.log(JSON.stringify(await conn.sendRequest('completionItem/resolve', items[0]), null, 2));
      }
    }
    proc.kill();
    process.exit(0);
  }
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
