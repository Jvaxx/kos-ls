import {
  parseFormatFile,
  validateOptions,
  resolveOptions,
  defaultFormatOptions,
} from '../../src/formatter/options';

describe('Formatter options', () => {
  test('defaults are LLVM with 4-space indentation', () => {
    expect(resolveOptions()).toEqual(defaultFormatOptions);
    expect(defaultFormatOptions.IndentWidth).toBe(4);
    expect(defaultFormatOptions.ColumnLimit).toBe(80);
    expect(defaultFormatOptions.BreakBeforeBraces).toBe('Attach');
    expect(resolveOptions({ IndentWidth: 2 }, undefined).IndentWidth).toBe(2);
  });

  test('flat YAML', () => {
    const { options, errors } = parseFormatFile(
      [
        '# kOS style',
        '---',
        'IndentWidth: 2',
        'ColumnLimit: 100   # wide',
        'BreakBeforeBraces: allman',
        "KeywordCase: 'Upper'",
        'AlignTrailingComments: false',
      ].join('\n'),
    );
    expect(errors).toEqual([]);
    expect(options).toEqual({
      IndentWidth: 2,
      ColumnLimit: 100,
      BreakBeforeBraces: 'Allman',
      KeywordCase: 'Upper',
      AlignTrailingComments: false,
    });
  });

  test('JSON', () => {
    const { options, errors } = parseFormatFile('{ "indentWidth": 3 }');
    expect(errors).toEqual([]);
    expect(options).toEqual({ IndentWidth: 3 });
    expect(parseFormatFile('{ "IndentWidth": ').errors.length).toBe(1);
  });

  test('bad entries are reported and skipped', () => {
    const { options, errors } = validateOptions({
      IndentWidth: -1,
      ColumnLimit: 1.5,
      BreakBeforeBraces: 'GNU',
      AlignTrailingComments: 'yes',
      Unknown: 1,
      MaxEmptyLinesToKeep: 2,
    });
    expect(options).toEqual({ MaxEmptyLinesToKeep: 2 });
    expect(errors.length).toBe(5);
    expect(validateOptions([]).errors.length).toBe(1);
    expect(parseFormatFile('IndentWidth 2').errors.length).toBe(1);
  });
});
