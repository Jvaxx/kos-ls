import { spawnSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { main, Output } from '../../src/cli/size';

describe('kos-ls size', () => {
  let root: string;
  let out: string;
  let err: string;
  const io: Output = {
    out: text => (out += text),
    err: text => (err += text),
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kos-size-cli-'));
    mkdirSync(join(root, 'src', 'lib'), { recursive: true });
    mkdirSync(join(root, 'bin'));
    writeFileSync(
      join(root, 'ksconfig.json'),
      '{ "volumes": { "1": "src" }, "exclude": ["bin"] }\n',
    );
    // 34 bytes, 27 stripped
    writeFileSync(join(root, 'src', 'main.ks'), 'run lib.\n  runpath("lib/a"). // a\n');
    // 9 bytes
    writeFileSync(join(root, 'src', 'lib.ks'), 'print 1.\n');
    // a and b run each other: 13 and 18 bytes
    writeFileSync(join(root, 'src', 'lib', 'a.ks'), 'run "lib/b".\n');
    writeFileSync(join(root, 'src', 'lib', 'b.ks'), 'runpath("lib/a").\n');
    writeFileSync(join(root, 'bin', 'main.ks'), 'print 2.\n');
    out = '';
    err = '';
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('a row per file of the workspace, excluded ones left out', async () => {
    expect(await main([], io, root)).toBe(0);
    expect(out).toBe(
      'path         stripped   source    total files\n' +
        'src/lib.ks          9        9        9     1\n' +
        'src/lib/a.ks       13       13       31     2\n' +
        'src/lib/b.ks       18       18       31     2\n' +
        'src/main.ks        27       34       67     4\n',
    );
    expect(err).toBe('4 files\n');
  });

  test('--files lists the files of each total', async () => {
    expect(await main(['--files', 'src/main.ks'], io, root)).toBe(0);
    expect(out).toBe(
      'path        stripped   source    total files\n' +
        'src/main.ks       27       34       67     4\n' +
        '  src/lib.ks 9\n' +
        '  src/lib/a.ks 13\n' +
        '  src/lib/b.ks 18\n',
    );
    expect(err).toBe('1 file\n');
  });

  test('--max fails when a total is larger', async () => {
    expect(await main(['--max', '40'], io, root)).toBe(1);
    expect(out).toMatch(/^src\/main\.ks .* 4 {2}\(27 B over 40\)$/m);
    expect(err).toBe('1 of 4 files over 40 B\n');

    out = '';
    err = '';
    expect(await main(['--max', '67'], io, root)).toBe(0);
    expect(err).toBe('4 files, all within 67 B\n');
  });

  test('runs that cannot be followed are noted', async () => {
    writeFileSync(join(root, 'src', 'boot.ks'), 'runpath("1:/" + core:tag).\n');
    expect(await main(['src/boot.ks'], io, root)).toBe(0);
    expect(out).toMatch(/^src\/boot\.ks .* 1 {2}\(1 run not followed\)$/m);
  });

  test('paths and --root limit the list', async () => {
    expect(await main(['src/lib'], io, root)).toBe(0);
    expect(out.split('\n').filter(line => line.startsWith('src/'))).toEqual([
      expect.stringMatching(/^src\/lib\/a\.ks /),
      expect.stringMatching(/^src\/lib\/b\.ks /),
    ]);

    out = '';
    expect(
      await main(['--root', root, join(root, 'src', 'lib.ks')], io, '/'),
    ).toBe(0);
    // shown relative to the current directory, /
    expect(out).toContain(`\n${join(root, 'src', 'lib.ks').slice(1)} `);

    err = '';
    expect(await main(['bin'], io, root)).toBe(0);
    expect(err).toBe('No Kerboscript files\n');
  });

  test('usage errors', async () => {
    expect(await main(['--max'], io, root)).toBe(2);
    expect(err).toMatch(/^Missing value for --max/);
    err = '';
    expect(await main(['--max', '1k'], io, root)).toBe(2);
    expect(err).toMatch(/^Not a number of bytes: 1k/);
    err = '';
    expect(await main(['--bogus'], io, root)).toBe(2);
    expect(err).toMatch(/^Unknown option --bogus/);
    err = '';
    expect(await main(['src/none.ks'], io, root)).toBe(2);
    expect(err).toBe('src/none.ks: no such file or directory\n');
    expect(out).toBe('');
  });

  test('the process exits once done', () => {
    // the compiled command (npm test builds it first)
    const size = join(__dirname, '../../out/src/cli/size.js');
    const script =
      `require(${JSON.stringify(size)}).main(['--max', '40'])` +
      '.then(status => (process.exitCode = status))';
    const result = spawnSync(process.execPath, ['-e', script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 4000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('1 of 4 files over 40 B\n');
  });

  test('--help', async () => {
    expect(await main(['--help'], io, root)).toBe(0);
    expect(out).toMatch(/^Usage: kos-ls size /);
  });
});
