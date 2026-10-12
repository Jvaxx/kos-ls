import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { findFormatOptions } from '../../src/formatter/config';

describe('Formatter options lookup', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kos-format-'));
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('the nearest directory with options wins', () => {
    writeFileSync(join(root, '.kos-format'), 'IndentWidth: 2\n');
    writeFileSync(join(root, 'a', 'ksconfig.json'), '{ "volumes": {} }');

    // a ksconfig.json without a format section is skipped
    const found = findFormatOptions(join(root, 'a', 'b', 'x.ks'));
    expect(found.options).toEqual({ IndentWidth: 2 });
    expect(found.file).toBe(join(root, '.kos-format'));

    writeFileSync(
      join(root, 'a', 'ksconfig.json'),
      '{\n  // comments allowed\n  "format": { "ColumnLimit": 100, "Bad": 1 }\n}',
    );
    const nearer = findFormatOptions(join(root, 'a', 'b'));
    expect(nearer.options).toEqual({ ColumnLimit: 100 });
    expect(nearer.errors).toEqual(['Unknown format option Bad.']);
    expect(nearer.file).toBe(join(root, 'a', 'ksconfig.json'));
  });

  test('.kos-format wins over ksconfig.json in the same directory', () => {
    writeFileSync(join(root, 'a', '.kos-format'), '{ "KeywordCase": "Upper" }');
    writeFileSync(
      join(root, 'a', 'ksconfig.json'),
      '{ "format": { "IndentWidth": 8 } }',
    );
    expect(findFormatOptions(join(root, 'a', 'x.ks')).options).toEqual({
      KeywordCase: 'Upper',
    });
  });
});
