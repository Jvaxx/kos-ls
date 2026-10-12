import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { main, Output } from '../../src/cli/format';

describe('kos-ls format', () => {
  let root: string;
  let out: string;
  let err: string;
  const io = (stdin = ''): Output => ({
    out: (text) => (out += text),
    err: (text) => (err += text),
    stdin: () => stdin,
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kos-format-cli-'));
    mkdirSync(join(root, 'lib'));
    writeFileSync(join(root, 'a.ks'), 'PRINT  1.\n');
    writeFileSync(join(root, 'lib', 'b.ks'), 'print 1.\n');
    writeFileSync(join(root, 'lib', 'notes.txt'), 'PRINT  1.\n');
    out = '';
    err = '';
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('--check lists the files to format and changes nothing', () => {
    expect(main(['--check', root], io())).toBe(1);
    expect(out).toBe(`${join(root, 'a.ks')}\n`);
    expect(readFileSync(join(root, 'a.ks'), 'utf8')).toBe('PRINT  1.\n');
  });

  test('files are formatted in place', () => {
    expect(main([join(root, 'a.ks'), join(root, 'lib')], io())).toBe(0);
    expect(readFileSync(join(root, 'a.ks'), 'utf8')).toBe('print 1.\n');
    expect(readFileSync(join(root, 'lib', 'notes.txt'), 'utf8')).toBe(
      'PRINT  1.\n',
    );
    expect(main(['--check', root], io())).toBe(0);
  });

  test('the options of each file are used', () => {
    writeFileSync(join(root, 'lib', '.kos-format'), 'KeywordCase: Upper\n');
    writeFileSync(join(root, 'lib', 'b.ks'), 'print 1.\n');
    expect(main([root], io())).toBe(0);
    expect(readFileSync(join(root, 'lib', 'b.ks'), 'utf8')).toBe('PRINT 1.\n');
    expect(readFileSync(join(root, 'a.ks'), 'utf8')).toBe('print 1.\n');
  });

  test('syntax errors are reported and the file left alone', () => {
    writeFileSync(join(root, 'bad.ks'), 'print (1.\n');
    expect(main([root], io())).toBe(2);
    expect(err).toMatch(/bad\.ks: Syntax error at 1:/);
    expect(readFileSync(join(root, 'bad.ks'), 'utf8')).toBe('print (1.\n');
    expect(readFileSync(join(root, 'a.ks'), 'utf8')).toBe('print 1.\n');
  });

  test('standard input to standard output', () => {
    expect(main([], io('IF a {print 1.}'))).toBe(0);
    expect(out).toBe('if a {\n    print 1.\n}\n');
    out = '';
    expect(main(['--check', '-'], io('print 1.\n'))).toBe(0);
    expect(out).toBe('');
  });

  test('usage', () => {
    expect(main(['--nope'], io())).toBe(2);
    expect(err).toContain('Usage: kos-ls format');
    expect(main(['--help'], io())).toBe(0);
    expect(out).toContain('--check');
  });
});
