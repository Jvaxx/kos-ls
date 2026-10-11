import { spawn, ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

// the compiled server: `npm test` builds it first (pretest)
const server = join(__dirname, '../../out/src/server.js');

const message = (body: object) => {
  const json = JSON.stringify({ jsonrpc: '2.0', ...body });
  return `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
};

const initialize = message({
  id: 1,
  method: 'initialize',
  params: { processId: null, rootUri: null, capabilities: {} },
});

/**
 * Resolve with the exit code once the process exits, or 'running' after
 * the timeout
 */
const exitWithin = (child: ChildProcess, ms: number) =>
  new Promise<number | string | null>((resolve) => {
    const timer = setTimeout(() => resolve('running'), ms);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

const start = () => {
  const child = spawn(process.execPath, [server, '--stdio'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return child;
};

const firstOutput = (child: ChildProcess) =>
  new Promise<void>((resolve) => child.stdout!.once('data', () => resolve()));

(existsSync(server) ? describe : describe.skip)('server process', () => {
  let child: ChildProcess;

  afterEach(() => {
    child?.kill('SIGKILL');
  });

  test('exits when the client closes its stdin', async () => {
    child = start();
    child.stdin!.write(initialize);
    await firstOutput(child);

    child.stdin!.end();
    expect(await exitWithin(child, 3000)).toBe(0);
  });

  test('exits when the client stops reading its stdout', async () => {
    child = start();
    child.stdin!.write(initialize);
    await firstOutput(child);

    // the client went away without closing our stdin: writing fails
    child.stdout!.destroy();
    child.stdin!.write(
      message({ id: 2, method: 'workspace/symbol', params: { query: '' } }),
    );
    expect(await exitWithin(child, 3000)).toBe(0);
  });

  test('exits on the exit notification', async () => {
    child = start();
    child.stdin!.write(initialize);
    await firstOutput(child);

    child.stdin!.write(message({ id: 2, method: 'shutdown' }));
    child.stdin!.write(message({ method: 'exit' }));
    expect(await exitWithin(child, 3000)).toBe(0);
  });
});
