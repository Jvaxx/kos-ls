import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TestClient } from './harness';

describe('semantic tokens', () => {
  let client: TestClient;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kos-ls-tokens-'));
  });

  afterEach(async () => {
    await client?.stop();
    rmSync(root, { recursive: true, force: true });
  });

  const tokensOf = async (text: string): Promise<string[]> => {
    writeFileSync(join(root, 'a.ks'), text);
    client = await TestClient.start(root);
    client.open('a.ks', text);
    return client.semanticTokens('a.ks');
  };

  test('keywords, literals, operators and names', async () => {
    expect(
      await tokensOf('local x is 1.5 + 2.\nprint "a" + x.\nif true stage.\n'),
    ).toEqual([
      'local keyword',
      'x variable declaration',
      'is keyword',
      '1.5 number',
      '+ operator',
      '2 number',
      'print keyword',
      '"a" string',
      '+ operator',
      'x variable',
      'if keyword',
      'true keyword',
      'stage keyword',
    ]);
  });

  test('functions, parameters and their declarations', async () => {
    expect(
      await tokensOf(
        'function f {\n    parameter p.\n    return p.\n}\nf(1).\n',
      ),
    ).toEqual([
      'function keyword',
      'f function declaration',
      'parameter keyword',
      'p parameter declaration',
      'return keyword',
      'p parameter',
      'f function',
      '1 number',
    ]);
  });

  test('builtins: functions, variables, bodies and suffixes', async () => {
    expect(
      await tokensOf(
        'print ship:partsnamed("a")[0]:name + kerbin:radius + sas + heading(1, 2).\n',
      ),
    ).toEqual([
      'print keyword',
      'ship variable readonly,defaultLibrary',
      'partsnamed method defaultLibrary',
      '"a" string',
      '0 number',
      'name property readonly,defaultLibrary',
      '+ operator',
      'kerbin variable readonly,defaultLibrary',
      'radius property readonly,defaultLibrary',
      '+ operator',
      'sas variable defaultLibrary',
      '+ operator',
      'heading function defaultLibrary',
      '1 number',
      '2 number',
    ]);
  });

  test('a suffix of an unknown type is a property', async () => {
    expect(
      await tokensOf('function f { parameter p. print p:whatever. }\n'),
    ).toContain('whatever property');
  });

  test('directives and comments', async () => {
    expect(
      await tokensOf(
        '@lazyglobal off.\n// #region a\n// plain\nprint 1. // trailing\n',
      ),
    ).toEqual([
      '@ macro',
      'lazyglobal macro',
      'off keyword',
      '// #region a macro',
      '// plain comment',
      'print keyword',
      '1 number',
      '// trailing comment',
    ]);
  });

  test('doc comment tags are split', async () => {
    expect(
      await tokensOf(
        '// @param v {Vessel} the ship\n// @return {Scalar} m\n' +
          'function f { parameter v. return 1. }\n',
      ),
    ).toEqual([
      '//  comment documentation',
      '@param keyword documentation',
      'v parameter documentation',
      '{Vessel} type documentation',
      'the ship comment documentation',
      '//  comment documentation',
      '@return keyword documentation',
      '{Scalar} type documentation',
      'm comment documentation',
      'function keyword',
      'f function declaration',
      'parameter keyword',
      'v parameter declaration',
      'return keyword',
      '1 number',
    ]);
  });

  test('a string over two lines is a token on each', async () => {
    expect(await tokensOf('print "ab\ncd" + 1.\n')).toEqual([
      'print keyword',
      '"ab string',
      'cd" string',
      '+ operator',
      '1 number',
    ]);
  });

  test('a range gives the tokens of its lines', async () => {
    writeFileSync(join(root, 'a.ks'), 'print 1.\nprint 2.\nprint 3.\n');
    client = await TestClient.start(root);
    client.open('a.ks');
    expect(
      await client.semanticTokens('a.ks', {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 8 },
      }),
    ).toEqual(['print keyword', '2 number']);
  });

  test('a file with syntax errors still gets tokens', async () => {
    const tokens = await tokensOf('local x is (1 +.\nprint x.\n');
    expect(tokens).toContain('local keyword');
    expect(tokens).toContain('print keyword');
  });
});
