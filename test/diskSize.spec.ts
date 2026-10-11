import {
  byteSize,
  DiskUsage,
  strippedText,
  totalStripped,
  usageDetails,
  usageSummary,
} from '../src/analysis/diskSize';

describe('stripped text', () => {
  test('comments and the whitespace around lines are removed', () => {
    expect(
      strippedText('// header\nfunction f {\n    print 1. // one\n  }  \n'),
    ).toBe('\nfunction f {\nprint 1.\n}\n');
  });

  test('lines are kept, blank lines at the end dropped', () => {
    expect(strippedText('print 1.\n\n// note\nprint 2.\n\n\n  \n')).toBe(
      'print 1.\n\n\nprint 2.\n',
    );
  });

  test('a file without a final line break gets one', () => {
    expect(strippedText('print 1.')).toBe('print 1.\n');
  });

  test('an empty file is a line break', () => {
    expect(strippedText('')).toBe('\n');
    expect(strippedText('// only a comment\n')).toBe('\n');
  });

  test('// inside a string is not a comment', () => {
    expect(strippedText('print "0://a". // b\n')).toBe('print "0://a".\n');
    expect(strippedText('print "a" + "//" + 1. // c\n')).toBe(
      'print "a" + "//" + 1.\n',
    );
  });

  test('the whitespace inside a string over lines is kept', () => {
    expect(strippedText('  print "a  \n    b". // c\n')).toBe(
      'print "a  \n    b".\n',
    );
  });

  test('a comment after a string over lines is removed', () => {
    expect(strippedText('print "a\nb" // c\n.\n')).toBe('print "a\nb"\n.\n');
  });

  test('CRLF line breaks become LF', () => {
    expect(strippedText('print 1. // a\r\n\tprint 2.\r\n')).toBe(
      'print 1.\nprint 2.\n',
    );
  });
});

describe('byte size', () => {
  test('counts UTF-8 bytes, as kOS does', () => {
    expect(byteSize('abc\n')).toBe(4);
    expect(byteSize('é')).toBe(2);
    expect(byteSize('Δv →')).toBe(7);
  });
});

describe('disk usage text', () => {
  const usage: DiskUsage = {
    files: [
      { uri: 'file:///w/main.ks', source: 300, stripped: 120 },
      { uri: 'file:///w/lib.ks', source: 200, stripped: 80 },
    ],
    unresolved: 1,
  };
  const name = (uri: string) => uri.replace('file:///w/', '');

  test('total', () => {
    expect(totalStripped(usage)).toBe(200);
  });

  test('summary', () => {
    expect(usageSummary(usage)).toBe(
      '120 B on disk (300 B source) · 200 B with the 1 file it runs · 1 run not followed',
    );
    expect(usageSummary({ files: usage.files.slice(0, 1), unresolved: 0 })).toBe(
      '120 B on disk (300 B source)',
    );
  });

  test('details', () => {
    expect(usageDetails(usage, name)).toBe(
      '200 B stripped in 2 files:\n' +
        '  main.ks: 120 B (300 B source)\n' +
        '  lib.ks: 80 B (200 B source)\n' +
        '1 run not followed (a path built at runtime, or a file not found): not counted',
    );
  });
});
