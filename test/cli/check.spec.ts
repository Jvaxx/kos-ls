import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { main, Output } from '../../src/cli/check';

describe('kos-ls check', () => {
  let root: string;
  let out: string;
  let err: string;
  const io: Output = {
    out: (text) => (out += text),
    err: (text) => (err += text),
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kos-check-cli-'));
    mkdirSync(join(root, 'src', 'lib'), { recursive: true });
    mkdirSync(join(root, 'bin'));
    writeFileSync(
      join(root, 'ksconfig.json'),
      '{ "volumes": { "1": "src" }, "exclude": ["bin"] }\n',
    );
    // main.ks uses the global of the lib.ks it runs
    writeFileSync(join(root, 'src', 'main.ks'), 'run lib.\nprint shared.\n');
    writeFileSync(
      join(root, 'src', 'lib.ks'),
      'global shared is 1.\nprint missing.\n',
    );
    writeFileSync(join(root, 'src', 'lib', 'clean.ks'), 'print 1.\n');
    writeFileSync(join(root, 'bin', 'main.ks'), 'print nothing.\n');
    out = '';
    err = '';
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('the diagnostics of the workspace, relative to the current directory', async () => {
    expect(await main([], io, root)).toBe(0);
    expect(out).toBe(
      'src/lib.ks:1:8: warning: Global variable shared was not used locally. [symbol-unused-locally]\n' +
        'src/lib.ks:2:7: warning: Symbol missing may not exist [symbol-may-not-exist]\n',
    );
    expect(err).toBe('2 warnings in 1 file\n');
  });

  test('--fail-on sets the lowest failing severity', async () => {
    expect(await main(['--fail-on', 'warning'], io, root)).toBe(1);
    out = '';
    expect(await main(['--fail-on', 'info'], io, root)).toBe(1);
  });

  test('an error fails by default', async () => {
    writeFileSync(
      join(root, 'src', 'main.ks'),
      'run lib.\nprint shared.\nprint (.\n',
    );
    expect(await main([], io, root)).toBe(1);
    expect(out).toMatch(/^src\/main\.ks:3:\d+: error: /m);
    expect(err).toMatch(/^1 error, 2 warnings in 2 files$/m);
  });

  test('the root is found from a subdirectory', async () => {
    const cwd = join(root, 'src', 'lib');
    expect(await main([], io, cwd)).toBe(0);
    expect(out).toMatch(/^\.\.\/lib\.ks:2:7: warning: Symbol missing/m);
  });

  test('--root and paths limit the report', async () => {
    expect(
      await main(['--root', root, join(root, 'src', 'main.ks')], io, '/'),
    ).toBe(0);
    expect(out).toBe('');
    expect(err).toBe('No diagnostics\n');

    expect(await main(['src/lib'], io, root)).toBe(0);
    expect(out).toBe('');

    expect(await main(['src/lib.ks'], io, root)).toBe(0);
    expect(out).toMatch(/^src\/lib\.ks:2:7: /m);
  });

  test('excluded files are not reported', async () => {
    expect(await main(['bin'], io, root)).toBe(0);
    expect(out).toBe('');
  });

  test('usage and path errors exit with 2', async () => {
    expect(await main(['--fail-on', 'fatal'], io, root)).toBe(2);
    expect(err).toMatch(/^Unknown severity fatal/);
    expect(await main(['--fail-on'], io, root)).toBe(2);
    expect(await main(['--verbose'], io, root)).toBe(2);
    expect(await main(['src/none.ks'], io, root)).toBe(2);
    expect(err).toMatch(/src\/none\.ks: no such file or directory/);
    expect(await main(['--root', join(root, 'src'), 'bin'], io, root)).toBe(2);
    expect(err).toMatch(/bin: outside the workspace root/);
    expect(await main(['--root', join(root, 'none')], io, root)).toBe(2);
    expect(out).toBe('');
  });

  test('the process exits once done', () => {
    // the compiled command (npm test builds it first): nothing the
    // in-process server started may keep the event loop alive
    const check = join(__dirname, '../../out/src/cli/check.js');
    const script =
      `require(${JSON.stringify(check)}).main([])` +
      '.then(status => (process.exitCode = status))';
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 4000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('2 warnings in 1 file\n');
  });

  test('--help', async () => {
    expect(await main(['--help'], io, root)).toBe(0);
    expect(out).toMatch(/^Usage: kos-ls check/);
  });
});
