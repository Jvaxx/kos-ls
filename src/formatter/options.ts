/**
 * Where an expanded block puts its braces
 *
 * - `Attach`: `if x {` and `} else {`
 * - `Stroustrup`: attached, but `else` starts its own line
 * - `Allman`: the `{` of a statement block on its own line
 */
export type BraceStyle = 'Attach' | 'Stroustrup' | 'Allman';

/**
 * How keywords are written: kOS is case-insensitive, so changing the case of
 * a keyword never changes the meaning. `Lower` writes `runPath` and
 * `runOncePath` as the kOS documentation does.
 */
export type KeywordCase = 'Lower' | 'Upper' | 'Preserve';

/**
 * Where a long expression breaks around a binary operator: `None` after it
 * (`a +` / `b`), `All` before it (`a` / `+ b`)
 */
export type BinaryOperatorBreak = 'None' | 'All';

/**
 * Which anonymous functions may stay on one line when they fit: `None`
 * expands every one with statements, `Empty` keeps only `{}` (always one
 * line), `All` any short one, `{ return 1. }`
 */
export type ShortLambdaStyle = 'None' | 'Empty' | 'All';

/**
 * Formatter options, named like their clang-format counterparts
 */
export interface FormatOptions {
  /**
   * Columns per block level
   */
  IndentWidth: number;

  /**
   * Columns added to a broken line that is not aligned to a bracket
   */
  ContinuationIndentWidth: number;

  /**
   * Line length the formatter tries to keep under, 0 for no limit
   */
  ColumnLimit: number;

  /**
   * Brace placement of statement blocks
   */
  BreakBeforeBraces: BraceStyle;

  /**
   * Line breaks before or after binary operators
   */
  BreakBeforeBinaryOperators: BinaryOperatorBreak;

  /**
   * Case of keywords
   */
  KeywordCase: KeywordCase;

  /**
   * Most consecutive blank lines kept from the source
   */
  MaxEmptyLinesToKeep: number;

  /**
   * Spaces between code and a comment that follows it on its line
   */
  SpacesBeforeTrailingComments: number;

  /**
   * Align the comments that follow code on consecutive lines
   */
  AlignTrailingComments: boolean;

  /**
   * Pack the arguments of a call that does not fit on one line several to
   * a line; otherwise they are all on one line or one per line
   */
  BinPackArguments: boolean;

  /**
   * Anonymous functions kept on one line when they fit
   */
  AllowShortLambdasOnASingleLine: ShortLambdaStyle;

  /**
   * Break comments longer than the column limit at spaces, the rest joining
   * the next line of the comment when it is plain text
   */
  ReflowComments: boolean;
}

/**
 * LLVM style with 4-space indentation
 */
export const defaultFormatOptions: FormatOptions = {
  IndentWidth: 4,
  ContinuationIndentWidth: 4,
  ColumnLimit: 80,
  BreakBeforeBraces: 'Attach',
  BreakBeforeBinaryOperators: 'None',
  KeywordCase: 'Lower',
  MaxEmptyLinesToKeep: 1,
  SpacesBeforeTrailingComments: 1,
  AlignTrailingComments: true,
  BinPackArguments: true,
  AllowShortLambdasOnASingleLine: 'All',
  ReflowComments: true,
};

type OptionKind = 'count' | 'boolean' | readonly string[];

const optionKinds: { [K in keyof FormatOptions]: OptionKind } = {
  IndentWidth: 'count',
  ContinuationIndentWidth: 'count',
  ColumnLimit: 'count',
  BreakBeforeBraces: ['Attach', 'Stroustrup', 'Allman'],
  BreakBeforeBinaryOperators: ['None', 'All'],
  KeywordCase: ['Lower', 'Upper', 'Preserve'],
  MaxEmptyLinesToKeep: 'count',
  SpacesBeforeTrailingComments: 'count',
  AlignTrailingComments: 'boolean',
  BinPackArguments: 'boolean',
  AllowShortLambdasOnASingleLine: ['None', 'Empty', 'All'],
  ReflowComments: 'boolean',
};

/**
 * Result of reading options: the options given, and a message per bad entry
 */
export interface OptionsResult {
  options: Partial<FormatOptions>;
  errors: string[];
}

/**
 * Check options read from JSON or a `.kos-format` file. Keys and enumerated
 * values are case-insensitive; unknown keys and bad values are reported and
 * skipped.
 * @param raw parsed key-value pairs
 */
export function validateOptions(raw: unknown): OptionsResult {
  const options: Partial<FormatOptions> = {};
  const errors: string[] = [];

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { options, errors: ['Format options must be an object.'] };
  }

  const keys = Object.keys(optionKinds) as (keyof FormatOptions)[];
  for (const [rawKey, value] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    const key = keys.find((k) => k.toLowerCase() === rawKey.toLowerCase());
    if (key === undefined) {
      errors.push(`Unknown format option ${rawKey}.`);
      continue;
    }

    const kind = optionKinds[key];
    if (kind === 'count') {
      const count = typeof value === 'string' ? Number(value) : value;
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
        errors.push(`${key} must be a whole number, not ${String(value)}.`);
        continue;
      }
      Object.assign(options, { [key]: count });
    } else if (kind === 'boolean') {
      const flag =
        typeof value === 'string'
          ? { true: true, false: false }[
              value.toLowerCase() as 'true' | 'false'
            ]
          : value;
      if (typeof flag !== 'boolean') {
        errors.push(`${key} must be true or false, not ${String(value)}.`);
        continue;
      }
      Object.assign(options, { [key]: flag });
    } else {
      const choice =
        typeof value === 'string'
          ? kind.find((c) => c.toLowerCase() === value.toLowerCase())
          : undefined;
      if (choice === undefined) {
        errors.push(
          `${key} must be one of ${kind.join(', ')}, not ${String(value)}.`,
        );
        continue;
      }
      Object.assign(options, { [key]: choice });
    }
  }

  return { options, errors };
}

/**
 * Read a `.kos-format` file: either JSON, or clang-format's flat YAML
 * (`Key: Value` lines, `#` comments)
 * @param text content of the file
 */
export function parseFormatFile(text: string): OptionsResult {
  if (text.trimStart().startsWith('{')) {
    try {
      return validateOptions(JSON.parse(text));
    } catch (err) {
      return {
        options: {},
        errors: [`Invalid JSON: ${(err as Error).message}`],
      };
    }
  }

  const raw: { [key: string]: string } = {};
  const errors: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].replace(/(^|\s)#.*$/, '').trim();
    if (line === '' || line === '---' || line === '...') {
      continue;
    }

    const match = /^([A-Za-z]+)\s*:\s*(.*)$/.exec(line);
    if (match === null) {
      errors.push(`Line ${i + 1}: expected Key: Value.`);
      continue;
    }

    raw[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
  }

  const result = validateOptions(raw);
  return { options: result.options, errors: errors.concat(result.errors) };
}

/**
 * Complete partial options with the defaults
 * @param options options given
 */
export function resolveOptions(
  ...options: (Partial<FormatOptions> | undefined)[]
): FormatOptions {
  return options.reduce<FormatOptions>(
    (resolved, partial) => ({ ...resolved, ...partial }),
    { ...defaultFormatOptions },
  );
}
