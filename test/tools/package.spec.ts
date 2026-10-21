import { execFileSync, spawnSync } from 'child_process';
import { createHash } from 'crypto';
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
import { join } from 'path';
import { gunzipSync } from 'zlib';

const project = join(__dirname, '../..');

describe('source-package preparation', () => {
  let root: string;
  let script: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kos-source-package-'));
    mkdirSync(join(root, 'tools'));
    script = join(root, 'tools/prepare-package.js');
    copyFileSync(join(project, 'tools/prepare-package.js'), script);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  test('ships an exact lockfile copy even when invoked outside the root', () => {
    const lock = '{"lockfileVersion":3,"packages":{}}\n';
    writeFileSync(join(root, 'package-lock.json'), lock);
    execFileSync(process.execPath, [script], { cwd: tmpdir() });
    expect(readFileSync(join(root, 'npm-shrinkwrap.json'), 'utf8')).toBe(lock);
    expect(readFileSync(join(root, 'package-lock.json'), 'utf8')).toBe(lock);
  });

  test('retains the canonical shrinkwrap in an unpacked source package', () => {
    const lock = '{"lockfileVersion":3}\n';
    writeFileSync(join(root, 'npm-shrinkwrap.json'), lock);
    execFileSync(process.execPath, [script], { cwd: root });
    expect(readFileSync(join(root, 'npm-shrinkwrap.json'), 'utf8')).toBe(lock);
    expect(existsSync(join(root, 'package-lock.json'))).toBe(false);
  });

  test('refuses preparation without any source lockfile', () => {
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('requires a dependency lockfile');
  });
});

describe('distribution provenance', () => {
  test('editable dependency inputs and every fixture match their inventory', () => {
    const output = execFileSync(
      process.execPath,
      [join(project, 'tools/check-sources.js')],
      { cwd: tmpdir(), encoding: 'utf8' },
    );
    expect(output).toContain('10 runtime dependency sources and 284 fixtures');
  });

  test('package and lock agree on GPLv3 and preserve editable source inputs', () => {
    const pkg = JSON.parse(
      readFileSync(join(project, 'package.json'), 'utf8'),
    ) as { license: string; files: string[] };
    const lock = JSON.parse(
      readFileSync(
        join(
          project,
          existsSync(join(project, 'package-lock.json'))
            ? 'package-lock.json'
            : 'npm-shrinkwrap.json',
        ),
        'utf8',
      ),
    ) as { packages: Record<string, { license: string }> };
    expect(pkg.license).toBe('GPL-3.0-only');
    expect(lock.packages[''].license).toBe(pkg.license);
    expect(pkg.files).toEqual(
      expect.arrayContaining([
        'src/',
        'tools/',
        'data/',
        'test/',
        'third_party/',
        'LICENSES/',
        'npm-shrinkwrap.json',
        'tsconfig.json',
        'webpack.config.js',
      ]),
    );
    expect(readFileSync(join(project, 'LICENSE'), 'utf8')).toContain(
      'Version 3, 29 June 2007',
    );
    expect(
      readFileSync(
        join(project, 'LICENSES/kos-language-server-MIT.txt'),
        'utf8',
      ),
    ).toContain('Copyright (c) 2018 John Chabot');
  });

  test('pinned editable kOS inputs match their checksum and attribution', () => {
    const manifest = JSON.parse(
      readFileSync(
        join(project, 'third_party/kos-1.6.0.1-inputs.json'),
        'utf8',
      ),
    ) as {
      archive: string;
      sha256: string;
      revision: string;
      license: string;
      prefix: string;
    };
    const archive = readFileSync(
      join(project, 'third_party', manifest.archive),
    );
    expect(createHash('sha256').update(archive).digest('hex')).toBe(
      manifest.sha256,
    );
    expect(manifest.revision).toBe('d4388439c712994e47258ed7514e863f79da632b');
    expect(manifest.license).toBe('GPL-3.0-only');
    const tar = gunzipSync(archive);
    for (const name of [
      'LICENSE.md',
      'doc/LICENSE.md',
      'doc/source/copyright.rst',
      'doc/source/conf.py',
      'src/kOS.Safe/Encapsulation/Structure.cs',
    ]) {
      expect(tar.includes(Buffer.from(manifest.prefix + name))).toBe(true);
    }
  });
});
