import { execFileSync } from 'child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

describe('development output cleanup', () => {
  let root: string;
  let script: string;

  const file = (relative: string) => {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'keep or remove exactly this file\n');
    return path;
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kos-clean-'));
    script = join(root, 'tools', 'clean.js');
    mkdirSync(dirname(script));
    copyFileSync(join(__dirname, '../../tools/clean.js'), script);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('removes known root outputs even when invoked from another directory', () => {
    file('package-lock.json');
    const outputs = [
      'out/src/server.js',
      'dist/server.js',
      'coverage/index.html',
      'npm-shrinkwrap.json',
      'junit.xml',
      'TEST.xml',
      'benchmark.data.json',
      'benchmark.data.csv',
      'benchmark.data.xml',
      'scanner.profile.json',
      'scanner.profile.html',
      'scanner.cpuprofile',
    ].map(file);

    execFileSync(process.execPath, [script], { cwd: tmpdir() });

    for (const output of outputs) {
      expect(existsSync(output)).toBe(false);
    }
  });

  test('preserves development inputs, dependencies and nested fixtures', () => {
    const kept = [
      'bin/kos-ls',
      'src/server.ts',
      'package-lock.json',
      'node_modules/example/index.js',
      'data/kos-1.6.0.1.json',
      'data/overrides.json',
      'docs/kos-db-report.md',
      'third_party/kos-1.6.0.1-inputs.tar.gz',
      'LICENSES/kos-language-server-MIT.txt',
      'benchmark/scanner.benchmark.ts',
      'test/fixtures/archive/bin/main.ks',
      'test/fixtures/out/main.ks',
      'test/fixtures/benchmark.data.json',
      'kos-ls-2.0.0-dev.tgz',
      'debug.log',
    ].map(file);

    execFileSync(process.execPath, [script], { cwd: root });

    for (const path of kept) {
      expect(readFileSync(path, 'utf8')).toBe(
        'keep or remove exactly this file\n',
      );
    }
  });

  test('preserves the only lockfile in an unpacked source package', () => {
    const shrinkwrap = file('npm-shrinkwrap.json');
    execFileSync(process.execPath, [script], { cwd: root });
    expect(existsSync(shrinkwrap)).toBe(true);
  });

  test('can run repeatedly when outputs do not exist', () => {
    execFileSync(process.execPath, [script], { cwd: root });
    expect(() =>
      execFileSync(process.execPath, [script], { cwd: root }),
    ).not.toThrow();
    expect(existsSync(script)).toBe(true);
  });
});
