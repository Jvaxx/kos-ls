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
 * a keyword never changes the meaning
 */
export type KeywordCase = 'Lower' | 'Upper' | 'Preserve';

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
}

/**
 * LLVM style with 4-space indentation
 */
export const defaultFormatOptions: FormatOptions = {
  IndentWidth: 4,
  ContinuationIndentWidth: 4,
  ColumnLimit: 80,
  BreakBeforeBraces: 'Attach',
  KeywordCase: 'Lower',
  MaxEmptyLinesToKeep: 1,
  SpacesBeforeTrailingComments: 1,
  AlignTrailingComments: true,
};

type OptionKind = 'count' | 'boolean' | readonly string[];

const optionKinds: { [K in keyof FormatOptions]: OptionKind } = {
  IndentWidth: 'count',
  ContinuationIndentWidth: 'count',
  ColumnLimit: 'count',
  BreakBeforeBraces: ['Attach', 'Stroustrup', 'Allman'],
  KeywordCase: ['Lower', 'Upper', 'Preserve'],
  MaxEmptyLinesToKeep: 'count',
  SpacesBeforeTrailingComments: 'count',
  AlignTrailingComments: 'boolean',
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
  for (const [rawKey, value] of Object.entries(raw)) {
    const key = keys.find(k => k.toLowerCase() === rawKey.toLowerCase());
    if (key === undefined) {
      errors.push(`Unknown format option ${rawKey}.`);
      continue;
    }

    const kind = optionKinds[key];
    if (kind === 'count') {
      const count = typeof value === 'string' ? Number(value) : value;
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
        errors.push(`${key} must be a whole number, not ${value}.`);
        continue;
      }
      (options as any)[key] = count;
    } else if (kind === 'boolean') {
      const flag =
        typeof value === 'string' ? { true: true, false: false }[
          value.toLowerCase() as 'true' | 'false'
        ] : value;
      if (typeof flag !== 'boolean') {
        errors.push(`${key} must be true or false, not ${value}.`);
        continue;
      }
      (options as any)[key] = flag;
    } else {
      const choice =
        typeof value === 'string'
          ? kind.find(c => c.toLowerCase() === value.toLowerCase())
          : undefined;
      if (choice === undefined) {
        errors.push(`${key} must be one of ${kind.join(', ')}, not ${value}.`);
        continue;
      }
      (options as any)[key] = choice;
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
      return { options: {}, errors: [`Invalid JSON: ${(err as Error).message}`] };
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
  return Object.assign({}, defaultFormatOptions, ...options);
}
