import { readFileSync } from 'fs';
import { join } from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { walkDir } from '../../src/utilities/fsUtils';
import { Scanner } from '../../src/scanner/scanner';
import { Parser } from '../../src/parser/parser';
import { TokenType } from '../../src/models/tokentypes';
import { formatText, formatRange } from '../../src/formatter/formatter';
import { FormatOptions } from '../../src/formatter/options';

const fixtures = join(__dirname, '../fixtures/parser_valid/');

const format = (source: string, options?: Partial<FormatOptions>): string => {
  const result = formatText(source, options);
  if ('error' in result) {
    throw new Error(result.error);
  }
  return result.text;
};

// tokens as the parser sees them: kOS is case-insensitive
const tokensOf = (source: string): string[] =>
  new Scanner(source).scanTokens().tokens.map(token => {
    const lexeme =
      token.type === TokenType.string ? token.lexeme : token.lookup;
    return `${TokenType[token.type]} ${lexeme.replace(/\s+/g, '')}`;
  });

const commentsOf = (source: string): string[] => {
  const { tokens, trailingComments } = new Scanner(source).scanTokens();
  return tokens
    .flatMap(token => token.leadingComments ?? [])
    .concat(trailingComments)
    .map(comment => comment.text.trimEnd());
};

// the tree printed back, in lowercase as keyword case may change, and
// numbers without the spaces allowed around their exponent
const astOf = (source: string): string => {
  const { tokens } = new Scanner(source).scanTokens();
  return new Parser('', tokens)
    .parse()
    .script.toString()
    .toLowerCase()
    .replace(/(\d)\s*e\s*([+-]?)\s*(\d)/g, '$1e$2$3');
};

describe('Formatter on every fixture', () => {
  const files: string[] = [];
  walkDir(fixtures, file => {
    if (file.endsWith('.ks')) {
      files.push(file);
    }
  });

  test('fixtures found', () => {
    expect(files.length).toBeGreaterThan(200);
  });

  // the defaults, and every other choice
  const styles: [string, Partial<FormatOptions>][] = [
    ['default', {}],
    [
      'other',
      {
        IndentWidth: 2,
        ContinuationIndentWidth: 8,
        ColumnLimit: 40,
        BreakBeforeBraces: 'Allman',
        BreakBeforeBinaryOperators: 'All',
        KeywordCase: 'Upper',
        MaxEmptyLinesToKeep: 2,
        SpacesBeforeTrailingComments: 2,
        AlignTrailingComments: false,
        BinPackArguments: false,
        AllowShortLambdasOnASingleLine: 'None',
        ReflowComments: false,
      },
    ],
  ];
  const cases = files.flatMap(file =>
    styles.map(([name, options]) => [
      `${file.slice(fixtures.length)} (${name})`,
      file,
      options,
    ]),
  ) as [string, string, Partial<FormatOptions>][];

  test.each(cases)(
    '%s',
    (_, file, options) => {
      const source = readFileSync(file, 'utf8');
      const once = format(source, options);

      // idempotence
      expect(format(once, options)).toBe(once);

      // same meaning: same tokens, same tree
      expect(tokensOf(once)).toEqual(tokensOf(source));
      expect(astOf(once)).toBe(astOf(source));

      // every comment kept, in order; reflowed, its words
      const words = (comments: string[]) =>
        comments.flatMap(comment =>
          comment.replace(/^\/\//, '').split(/\s+/).filter(word => word),
        );
      if (options.ReflowComments === false) {
        expect(commentsOf(once)).toEqual(commentsOf(source));
      } else {
        expect(words(commentsOf(once))).toEqual(words(commentsOf(source)));
      }

      // the edits give the same text
      const result = formatText(source, options);
      if ('error' in result) {
        throw new Error(result.error);
      }
      const document = TextDocument.create('file:///a.ks', 'kos', 1, source);
      expect(TextDocument.applyEdits(document, result.edits)).toBe(once);

      // edits neither overlap nor touch
      for (let i = 1; i < result.edits.length; i += 1) {
        const end = document.offsetAt(result.edits[i - 1].range.end);
        expect(document.offsetAt(result.edits[i].range.start)).toBeGreaterThan(end);
      }
    },
  );
});

describe('Formatter rules', () => {
  test('spacing', () => {
    expect(format('set x to a+b*-c^2.')).toBe('set x to a + b * -c ^ 2.\n');
    expect(format('print foo( 1,2 ) [ 0 ]:bar#1.')).toBe(
      'print foo(1, 2)[0]:bar#1.\n',
    );
    expect(format('set f to foo@.')).toBe('set f to foo@.\n');
    expect(format('@LAZYGLOBAL   OFF.')).toBe('@lazyglobal off.\n');
    expect(format('@ClobberBuiltins on.')).toBe('@clobberbuiltins on.\n');
    expect(format('print(1).')).toBe('print (1).\n');
    expect(format('print "a" at(1,2).')).toBe('print "a" at (1, 2).\n');
    expect(format('RUNPATH ( "a", 1 ).')).toBe('runPath("a", 1).\n');
    expect(format('runoncepath("a").')).toBe('runOncePath("a").\n');
    expect(format('run once lib(1).')).toBe('run once lib(1).\n');
    expect(format('set x to not a and defined b.')).toBe(
      'set x to not a and defined b.\n',
    );
    expect(format('set x to 1 e 5.')).toBe('set x to 1e5.\n');
    expect(format('LOCAL a TO 5,b IS a+1.')).toBe('local a to 5, b is a + 1.\n');
    expect(format('set a to 1 , b to 2.')).toBe('set a to 1, b to 2.\n');
  });

  test('one statement per line', () => {
    expect(format('print 1. print 2.')).toBe('print 1.\nprint 2.\n');
    expect(format('if a print 1. else print 2.')).toBe(
      'if a print 1.\nelse print 2.\n',
    );
  });

  test('blocks', () => {
    expect(format('if a { print 1. } else if b { print 2. } else { print 3. }')).toBe(
      [
        'if a {',
        '    print 1.',
        '} else if b {',
        '    print 2.',
        '} else {',
        '    print 3.',
        '}',
        '',
      ].join('\n'),
    );
    expect(format('function f {}\nlocal g is {}.')).toBe(
      'function f {}\nlocal g is {}.\n',
    );
    expect(format('when a then { print 1. }.')).toBe(
      'when a then {\n    print 1.\n}.\n',
    );
  });

  test('from loops keep their header on one line', () => {
    expect(
      format('from {local i is 0.} until i>3 step {set i to i+1.} do {print i.}'),
    ).toBe(
      'from { local i is 0. } until i > 3 step { set i to i + 1. } do {\n' +
        '    print i.\n' +
        '}\n',
    );
  });

  test('short anonymous functions stay on one line', () => {
    expect(format('local f is {parameter x. return x.}.')).toBe(
      'local f is { parameter x. return x. }.\n',
    );
    expect(format('foo(1, {\nreturn 1.\n}, 2).')).toBe(
      'foo(1, { return 1. }, 2).\n',
    );
    expect(format('local n is { return { return 1. }. }.')).toBe(
      'local n is { return { return 1. }. }.\n',
    );
    expect(format('local e is {}.')).toBe('local e is {}.\n');

    // too long, or holding a statement block or a comment: expanded, with
    // the ones holding it
    expect(
      format(
        'local h is { parameter aLongParameterName. return aLongParameterName * aLongParameterName. }.',
      ),
    ).toBe(
      [
        'local h is {',
        '    parameter aLongParameterName.',
        '    return aLongParameterName * aLongParameterName.',
        '}.',
        '',
      ].join('\n'),
    );
    expect(format('local g is { return { if a { return 1. } return 2. }. }.')).toBe(
      [
        'local g is {',
        '    return {',
        '        if a {',
        '            return 1.',
        '        }',
        '        return 2.',
        '    }.',
        '}.',
        '',
      ].join('\n'),
    );
    expect(format('local c is { return 1. // one\n}.')).toBe(
      'local c is {\n    return 1. // one\n}.\n',
    );
  });

  test('anonymous functions', () => {
    const expand = (source: string) =>
      format(source, { AllowShortLambdasOnASingleLine: 'None' });
    expect(expand('local f is { parameter x. return x. }.')).toBe(
      'local f is {\n    parameter x.\n    return x.\n}.\n',
    );
    expect(expand('foo(1, { return 1. }, 2).')).toBe(
      'foo(1, {\n    return 1.\n}, 2).\n',
    );
    expect(format('local e is {}.', { AllowShortLambdasOnASingleLine: 'Empty' })).toBe(
      'local e is {}.\n',
    );
    expect(expand('set l to list(list("a", { return 1. }), list("b", { return 2. })).')).toBe(
      [
        'set l to list(',
        '    list("a", {',
        '        return 1.',
        '    }),',
        '    list("b", {',
        '        return 2.',
        '    })',
        ').',
        '',
      ].join('\n'),
    );
  });

  test('comments', () => {
    expect(format('print 1. // one\nprint 22. // two\n')).toBe(
      'print 1.  // one\nprint 22. // two\n',
    );
    expect(format('if a { // why\nprint 1.\n// end\n}')).toBe(
      'if a { // why\n    print 1.\n    // end\n}\n',
    );
    expect(format('set x to 1 + // one\n2.')).toBe(
      'set x to 1 + // one\n         2.\n',
    );
    expect(format('if a { print 1. } // done\nelse { print 2. }')).toBe(
      'if a {\n    print 1.\n} // done\nelse {\n    print 2.\n}\n',
    );
    expect(format('foo({ // c\nreturn 1. }).')).toBe(
      'foo({ // c\n    return 1.\n}).\n',
    );
    expect(format('print 1.\n// last   ')).toBe('print 1.\n// last\n');
    expect(format('// only')).toBe('// only\n');
  });

  test('arguments not bin-packed: all on one line or one per line', () => {
    const source =
      'set x to outerFunction(innerCall(alpha, beta, gamma), anotherArgument, finalArgumentHere).';
    expect(format(source)).toBe(
      [
        'set x to outerFunction(innerCall(alpha, beta, gamma), anotherArgument,',
        '                       finalArgumentHere).',
        '',
      ].join('\n'),
    );
    expect(format(source, { BinPackArguments: false })).toBe(
      [
        'set x to outerFunction(innerCall(alpha, beta, gamma),',
        '                       anotherArgument,',
        '                       finalArgumentHere).',
        '',
      ].join('\n'),
    );

    // a break inside an argument breaks the arguments around it, or puts
    // them all on the next line
    expect(
      format(
        'set x to outerFunction(innerCall(alpha, beta), anotherArgument, finalArgumentHere, last).',
        { BinPackArguments: false },
      ),
    ).toBe(
      [
        'set x to outerFunction(',
        '    innerCall(alpha, beta), anotherArgument, finalArgumentHere, last).',
        '',
      ].join('\n'),
    );
    expect(format('print f(1, 2).', { BinPackArguments: false })).toBe(
      'print f(1, 2).\n',
    );
  });

  test('comments reflowed to the column limit', () => {
    const long =
      '// This comment is long enough to go past the eighty column limit of the formatter';
    expect(format(`${long}\n// and it goes on.\nprint 1.`)).toBe(
      [
        '// This comment is long enough to go past the eighty column limit of the',
        '// formatter and it goes on.',
        'print 1.',
        '',
      ].join('\n'),
    );

    // a sentence or a statement ends: what follows is not joined
    expect(
      format(
        '//set a to list(firstArgument, secondArgument, thirdArgument, fourthArgument, fifth).\n//set b to 2.',
      ),
    ).toBe(
      [
        '//set a to list(firstArgument, secondArgument, thirdArgument, fourthArgument,',
        '//fifth).',
        '//set b to 2.',
        '',
      ].join('\n'),
    );
    // no line starts with the `//` of a comment inside the comment
    expect(
      format(
        '//(3.0, 0.2, 3.0, -10, 30, 3.0, 0.2, 3.0, -10, 30, 3.0, 0.2, 3.0, 0.2). //outputs',
      ),
    ).toBe(
      [
        '//(3.0, 0.2, 3.0, -10, 30, 3.0, 0.2, 3.0, -10, 30, 3.0, 0.2, 3.0,',
        '//0.2). //outputs',
        '',
      ].join('\n'),
    );
    expect(format(`${long}\n// <- arrow\nprint 1.`)).toBe(
      [
        '// This comment is long enough to go past the eighty column limit of the',
        '// formatter',
        '// <- arrow',
        'print 1.',
        '',
      ].join('\n'),
    );

    // blank comment lines, list items, tags, directives, indented text and
    // fenced code are kept apart
    const kept = [
      '// - a list item that is long enough to go past the eighty column limit of the formatter',
      '// @param x the parameter, with a description long enough to be broken by the formatter',
      '// #region a directive that is long enough to go past the column limit, kept',
      '//     indented text that is long enough to go past the column limit, kept',
      '// ```',
      '// print "fenced code that is long enough to go past the column limit, kept".',
      '// ```',
      '//',
      '// end',
      'print 1.',
    ].join('\n');
    expect(format(kept)).toBe(
      [
        '// - a list item that is long enough to go past the eighty column limit of the',
        '// formatter',
        '// @param x the parameter, with a description long enough to be broken by the',
        '// formatter',
        '// #region a directive that is long enough to go past the column limit, kept',
        '//     indented text that is long enough to go past the column limit, kept',
        '// ```',
        '// print "fenced code that is long enough to go past the column limit, kept".',
        '// ```',
        '//',
        '// end',
        'print 1.',
        '',
      ].join('\n'),
    );

    // a trailing comment continues aligned under itself, read back as such
    const trailing =
      'local y is x * 2. // a trailing comment long enough to go past the column limit here';
    const once = format(trailing);
    expect(once).toBe(
      [
        'local y is x * 2. // a trailing comment long enough to go past the column limit',
        '                  // here',
        '',
      ].join('\n'),
    );
    expect(format(once)).toBe(once);
    expect(format('print 1. // a\n         // b\nprint 22.')).toBe(
      'print 1. // a\n         // b\nprint 22.\n',
    );

    // a word longer than the line stays whole; off, nothing changes
    const word = `// ${'x'.repeat(90)}`;
    expect(format(word)).toBe(`${word}\n`);
    expect(format(`${long}\nprint 1.`, { ReflowComments: false })).toBe(
      `${long}\nprint 1.\n`,
    );
  });

  test('blank lines', () => {
    expect(format('\n\nprint 1.\n\n\n\nprint 2.\n\n')).toBe(
      'print 1.\n\nprint 2.\n',
    );
    expect(format('if a {\n\nprint 1.\n\n}')).toBe('if a {\n    print 1.\n}\n');
    expect(format('print 1.\n\n\nprint 2.', { MaxEmptyLinesToKeep: 2 })).toBe(
      'print 1.\n\n\nprint 2.\n',
    );
    expect(format('print 1.\n\nprint 2.', { MaxEmptyLinesToKeep: 0 })).toBe(
      'print 1.\nprint 2.\n',
    );
  });

  test('long lines', () => {
    expect(
      format(
        'set result to firstFunction(argumentOne, argumentTwo) + secondFunction(argumentThree).',
      ),
    ).toBe(
      'set result to firstFunction(argumentOne, argumentTwo) +\n' +
        '              secondFunction(argumentThree).\n',
    );
    expect(
      format('print foo(argumentOne, argumentTwo, argumentThree).', {
        ColumnLimit: 30,
      }),
    ).toBe(
      'print foo(argumentOne,\n' +
        '          argumentTwo,\n' +
        '          argumentThree).\n',
    );
    expect(format('set x to a * b + c * d.', { ColumnLimit: 18 })).toBe(
      'set x to a * b +\n         c * d.\n',
    );
    expect(
      format('set x to a * b + c * d.', {
        ColumnLimit: 18,
        BreakBeforeBinaryOperators: 'All',
      }),
    ).toBe('set x to a * b\n         + c * d.\n');
    // breaks at the operator of lowest priority, groups kept whole
    expect(
      format(
        'set total to (alpha + beta) * gamma + delta * (epsilon - zeta) + eta.',
        { ColumnLimit: 40 },
      ),
    ).toBe(
      'set total to (alpha + beta) * gamma +\n' +
        '             delta * (epsilon - zeta) +\n' +
        '             eta.\n',
    );
    expect(
      format(
        'if altitude > 1000 and verticalspeed < 0 or ship:status = "FLYING" and not done { print 1. }',
        { ColumnLimit: 50 },
      ),
    ).toBe(
      'if altitude > 1000 and verticalspeed < 0 or\n' +
        '   ship:status = "FLYING" and not done {\n' +
        '    print 1.\n' +
        '}\n',
    );
    // a whole call moves to the next line rather than being split
    expect(
      format(
        'set vd_relative_v to vecdraw(v(0, 0, 0), v(0, 0, 0), blue, "relative v", 1, true, 0.2).',
      ),
    ).toBe(
      'set vd_relative_v to\n' +
        '    vecdraw(v(0, 0, 0), v(0, 0, 0), blue, "relative v", 1, true, 0.2).\n',
    );
    const long = `print ${'a + '.repeat(40)}b.`;
    expect(format(long, { ColumnLimit: 0 })).toBe(`${long}\n`);
  });

  test('options', () => {
    const source = 'IF a { PRINT 1. } ELSE { PRINT 2. }';
    expect(format(source, { BreakBeforeBraces: 'Allman' })).toBe(
      'if a\n{\n    print 1.\n}\nelse\n{\n    print 2.\n}\n',
    );
    expect(format(source, { BreakBeforeBraces: 'Stroustrup' })).toBe(
      'if a {\n    print 1.\n}\nelse {\n    print 2.\n}\n',
    );
    expect(format(source, { KeywordCase: 'Preserve', IndentWidth: 2 })).toBe(
      'IF a {\n  PRINT 1.\n} ELSE {\n  PRINT 2.\n}\n',
    );
    expect(format('set list to list(). list x in y.', { KeywordCase: 'Upper' })).toBe(
      'SET list TO list().\nLIST x IN y.\n',
    );
    expect(
      format('print 1. // a\nprint 22. // b', {
        AlignTrailingComments: false,
        SpacesBeforeTrailingComments: 2,
      }),
    ).toBe('print 1.  // a\nprint 22.  // b\n');
  });

  test('line endings', () => {
    expect(format('print 1.\r\nif a {\r\nprint 2.\r\n}\r\n')).toBe(
      'print 1.\r\nif a {\r\n    print 2.\r\n}\r\n',
    );
  });

  test('syntax errors are not formatted', () => {
    expect('error' in formatText('print 1')).toBe(true);
    expect('error' in formatText('print "a.')).toBe(true);
    expect('error' in formatText('set x to $.')).toBe(true);
  });

  test('range formatting', () => {
    const source = 'print  1.\nprint  2.\nprint  3.\n';
    const result = formatRange(source, {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 9 },
    });
    if ('error' in result) {
      throw new Error(result.error);
    }
    const document = TextDocument.create('file:///a.ks', 'kos', 1, source);
    expect(TextDocument.applyEdits(document, result.edits)).toBe(
      'print  1.\nprint 2.\nprint  3.\n',
    );

    // whole lines, up to a line start excluded
    const lines = formatRange(source, {
      start: { line: 0, character: 4 },
      end: { line: 2, character: 0 },
    });
    if ('error' in lines) {
      throw new Error(lines.error);
    }
    expect(TextDocument.applyEdits(document, lines.edits)).toBe(
      'print 1.\nprint 2.\nprint  3.\n',
    );
  });
});
