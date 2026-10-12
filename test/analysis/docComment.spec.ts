import { Scanner } from '../../src/scanner/scanner';
import { TokenType } from '../../src/models/tokentypes';
import { Token } from '../../src/models/token';
import {
  docLines,
  parseDocComment,
  parameterTag,
} from '../../src/analysis/docComment';

/**
 * The first token of a type in a source
 */
const first = (source: string, type: TokenType): Token =>
  new Scanner(source).scanTokens().tokens.find((t) => t.type === type)!;

describe('doc comments', () => {
  test('the block directly above, without trailing or detached comments', () => {
    const source = [
      '// detached',
      '',
      'print 1. // trailing',
      '// first',
      '//second',
      'function f { }',
    ].join('\n');

    expect(docLines(first(source, TokenType.function))).toEqual([
      'first',
      'second',
    ]);
  });

  test('lines aligned under a trailing comment continue it', () => {
    const source = [
      'print 1. // trailing',
      '         // continued',
      '// first',
      'function f { }',
    ].join('\n');
    expect(docLines(first(source, TokenType.function))).toEqual(['first']);

    const only = 'print 1. // trailing\n         // continued\nfunction f { }';
    expect(parseDocComment(first(only, TokenType.function))).toBeUndefined();
  });

  test('a blank line breaks the attachment', () => {
    const source = '// above\n\nfunction f { }';
    expect(parseDocComment(first(source, TokenType.function))).toBeUndefined();
  });

  test('a directive is no documentation', () => {
    const source = '// #region tools\n// Tool.\nfunction f { }';
    expect(docLines(first(source, TokenType.function))).toEqual(['Tool.']);
  });

  test('description and tags', () => {
    const source = [
      '// Burn time for a maneuver.',
      '//',
      '// Uses `ISP`.',
      '// @param dv {Scalar} delta-v',
      '//   in m/s',
      '// @param {Vessel} ves the vessel',
      '// @param bare',
      '// @return {Scalar} seconds',
      'function burnTime { }',
    ].join('\n');

    expect(parseDocComment(first(source, TokenType.function))).toMatchObject({
      doc: 'Burn time for a maneuver.\n\nUses `ISP`.',
      params: [
        { name: 'dv', type: 'Scalar', doc: 'delta-v\n  in m/s' },
        { name: 'ves', type: 'Vessel', doc: 'the vessel' },
        { name: 'bare' },
      ],
      returns: { type: 'Scalar', doc: 'seconds' },
    });
  });

  test('type expressions in tags', () => {
    const source = '// @param p {List<Part> | Scalar} parts\nfunction f { }';
    expect(parseDocComment(first(source, TokenType.function))?.params).toEqual([
      {
        name: 'p',
        type: 'List<Part> | Scalar',
        typeRange: {
          start: { line: 0, character: 12 },
          end: { line: 0, character: 33 },
        },
        doc: 'parts',
      },
    ]);
  });

  test('a parameter is documented by its statement, else its function', () => {
    const fn = parseDocComment(
      first(
        '// @param a {Scalar} from the function\nfunction f { }',
        TokenType.function,
      ),
    );
    const statement = parseDocComment(
      first('// from the statement\nparameter a.', TokenType.parameter),
    );

    expect(parameterTag(statement, fn, 'A')).toMatchObject({
      doc: 'from the statement',
      type: 'Scalar',
    });
    expect(parameterTag(undefined, fn, 'a')).toMatchObject({
      doc: 'from the function',
      type: 'Scalar',
    });
    expect(parameterTag(undefined, fn, 'b')).toBeUndefined();
  });
});
