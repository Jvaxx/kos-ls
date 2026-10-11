import { Diagnostic, Position, Range, TextEdit } from 'vscode-languageserver';
import { Scanner } from '../scanner/scanner';
import { Parser } from '../parser/parser';
import { Token, Comment, isToken } from '../models/token';
import { TokenType } from '../models/tokentypes';
import { NodeBase } from '../parser/models/base';
import * as Expr from '../parser/models/expr';
import * as Stmt from '../parser/models/stmt';
import * as SuffixTerm from '../parser/models/suffixTerm';
import { FormatOptions, resolveOptions } from './options';

/**
 * The formatter works from the token stream: every token and every comment
 * of the source is written once, in order, so nothing can be lost. The AST
 * only tells what some tokens are (a unary minus, the parenthesis of a
 * call, the kind of a block, the operand groups of expressions).
 * Statements are cut into logical lines, and a logical line too long for
 * the column limit is broken where the whole layout costs least: at the
 * outermost level, at operators of low priority, keeping groups whole; a
 * broken line continues aligned with its operand group or bracket.
 */

/**
 * Result of formatting: the formatted text and the edits turning the source
 * into it, or why the source cannot be formatted
 */
export type FormatResult =
  | { text: string; edits: TextEdit[] }
  | { error: string };

/**
 * Format a whole Kerboscript source
 * @param source the source
 * @param options formatter options, defaults for those not given
 */
export function formatText(
  source: string,
  options?: Partial<FormatOptions>,
): FormatResult {
  const result = format(source, resolveOptions(options));
  return 'error' in result
    ? result
    : { text: result.text, edits: merge(result.edits) };
}

/**
 * Edits formatting the lines of a range: the source is formatted as a whole
 * and only the edits touching the lines of the range are kept
 * @param source the source
 * @param range range to format
 * @param options formatter options, defaults for those not given
 */
export function formatRange(
  source: string,
  range: Range,
  options?: Partial<FormatOptions>,
): FormatResult {
  const result = format(source, resolveOptions(options));
  if ('error' in result) {
    return result;
  }

  // whole lines; a range ending at the start of a line stops before it
  const start: Position = { line: range.start.line, character: 0 };
  const endLine =
    range.end.character === 0 && range.end.line > range.start.line
      ? range.end.line - 1
      : range.end.line;
  const end: Position = { line: endLine, character: Number.MAX_SAFE_INTEGER };

  const edits = result.edits.filter(
    edit => before(edit.range.start, end) && before(start, edit.range.end),
  );
  return { text: result.text, edits: merge(edits) };
}

const before = (a: Position, b: Position): boolean =>
  a.line < b.line || (a.line === b.line && a.character <= b.character);

/**
 * Merge edits that touch, so that no two edits start at the same place
 * @param edits edits in source order, not overlapping
 */
function merge(edits: TextEdit[]): TextEdit[] {
  const merged: TextEdit[] = [];
  for (const edit of edits) {
    const last = merged[merged.length - 1];
    if (last !== undefined && before(edit.range.start, last.range.end)) {
      merged[merged.length - 1] = TextEdit.replace(
        { start: last.range.start, end: edit.range.end },
        last.newText + edit.newText,
      );
    } else {
      merged.push(edit);
    }
  }
  return merged;
}

interface BlockInfo {
  open: Token;
  close: Token;

  /**
   * - `expanded`: one statement per line, indented
   * - `inline`: on one line, `{ a. b. }` (the blocks of a `from` header)
   * - `empty`: `{}`
   */
  layout: 'expanded' | 'inline' | 'empty';

  /**
   * Whether the `}` is followed by more of the same line (an anonymous
   * function, the blocks of a `from` header)
   */
  continues: boolean;

  /**
   * Whether the brace style applies (not an anonymous function, not a
   * `from` header)
   */
  statement: boolean;
}

interface Roles {
  /**
   * Tokens used as names: a keyword used as a name keeps its case
   */
  names: Set<Token>;
  unary: Set<Token>;
  callOpen: Set<Token>;
  blocks: Map<Token, BlockInfo>;

  /**
   * Operand groups, as indexes of their first and last tokens: every
   * binary or ternary expression, except the left operand of an operator
   * of the same precedence (`a + b + c` is one group). A line broken
   * inside a group continues aligned with its start.
   */
  groups: [number, number][];

  /**
   * Anonymous functions laid out on one line, as indexes of their braces
   */
  shortLambdas: [number, number][];
}

/**
 * One element of a logical line: a token or a comment
 */
interface Item {
  text: string;

  /**
   * Index of the token, undefined for a comment
   */
  token?: number;

  /**
   * A comment ending the line it is on
   */
  trailing?: boolean;

  /**
   * The lines continuing a trailing comment, aligned under it
   */
  continuation?: string[];

  /**
   * Space before the item when it follows another one on its line
   */
  space: boolean;

  /**
   * The item starts a new line
   */
  mustBreak: boolean;

  /**
   * Cost of a line break before the item, undefined where none is allowed
   */
  cost?: number;

  /**
   * The item opens or closes a bracket, for the alignment of broken lines
   */
  open?: boolean;
  close?: boolean;

  /**
   * The item opens the arguments of a call
   */
  call?: boolean;

  /**
   * The body of an expanded anonymous function: its lines go between the
   * line ending with its `{` and the line starting with its `}`
   */
  block?: BlockBody;

  /**
   * A closing bracket on its own line, at the indentation of the opening one
   */
  ownLine?: boolean;
}

interface BlockBody {
  lines: LogicalLine[];

  /**
   * A comment following the `{` on its line
   */
  comment?: string;
}

interface LogicalLine {
  /**
   * Block level, counted from the enclosing anonymous function if any
   */
  level: number;
  blank: number;
  items: Item[];
  opensBlock: boolean;
}

interface Piece {
  text: string;
  sep: number;
  token?: number;
  trailing?: boolean;
  continuation?: string[];
}

interface PhysicalLine {
  blank: number;
  indent: number;
  pieces: Piece[];
}

/**
 * Binary operators, with the cost of a break after them: lower precedence,
 * lower cost, so `a * b + c` breaks after the `+`
 */
const binaryOperators = new Map([
  [TokenType.or, 1],
  [TokenType.and, 1.1],
  [TokenType.equal, 1.2],
  [TokenType.notEqual, 1.2],
  [TokenType.greaterEqual, 1.3],
  [TokenType.greater, 1.3],
  [TokenType.lessEqual, 1.3],
  [TokenType.less, 1.3],
  [TokenType.plus, 1.4],
  [TokenType.minus, 1.4],
  [TokenType.multi, 1.5],
  [TokenType.div, 1.5],
  [TokenType.power, 1.6],
]);

/**
 * Keywords after which a line may break, before what they introduce
 */
const separatorKeywords = new Set([
  TokenType.to,
  TokenType.is,
  TokenType.then,
  TokenType.do,
  TokenType.step,
  TokenType.until,
  TokenType.in,
  TokenType.at,
  TokenType.if,
  TokenType.else,
  TokenType.from,
]);

/**
 * Keywords the kOS documentation writes in camel case, used for the lower
 * case
 */
const camelKeywords = new Map([
  [TokenType.runPath, 'runPath'],
  [TokenType.runOncePath, 'runOncePath'],
]);

/**
 * Tokens never preceded by a space
 */
const noSpaceBefore = new Set([
  TokenType.period,
  TokenType.comma,
  TokenType.bracketClose,
  TokenType.squareOpen,
  TokenType.squareClose,
  TokenType.colon,
  TokenType.arrayIndex,
]);

/**
 * Tokens never followed by a space
 */
const noSpaceAfter = new Set([
  TokenType.bracketOpen,
  TokenType.squareOpen,
  TokenType.colon,
  TokenType.arrayIndex,
  TokenType.atSign,
]);

const costComma = 0;
const costKeyword = 2;
const costBracket = 25;

/**
 * Format a source with complete options
 * @param source the source
 * @param options formatter options
 */
function format(source: string, options: FormatOptions): FormatResult {
  const first = render(source, options);
  if ('error' in first) {
    return first;
  }

  // reflowed comment lines can change the layout around them: formatted
  // again, they fit and stay
  let final = first;
  for (let pass = 0; final.reflowed && pass < 2; pass += 1) {
    const next = render(final.text, options);
    if ('error' in next) {
      return next;
    }
    final = next;
  }

  const { tokens, texts, trailingComments } = first;
  const check = sameContent(
    tokens,
    texts,
    trailingComments,
    final.text,
    options.ReflowComments,
  );
  if (check !== undefined) {
    return { error: `Formatting would change the file (${check}).` };
  }

  return {
    text: final.text,
    edits: edits(source, tokens, texts, final.text, final.starts, final.ends),
  };
}

/**
 * A source laid out once
 */
interface Rendered {
  tokens: Token[];
  texts: string[];
  trailingComments: Comment[];
  text: string;

  /**
   * Offsets of each token in the text
   */
  starts: number[];
  ends: number[];

  /**
   * Whether a comment was reflowed
   */
  reflowed: boolean;
}

/**
 * Lay out a source once
 * @param source the source
 * @param options formatter options
 */
function render(
  source: string,
  options: FormatOptions,
): Rendered | { error: string } {
  const scanned = new Scanner(source).scanTokens();
  if (scanned.diagnostics.length > 0) {
    return syntaxError(scanned.diagnostics);
  }

  const { tokens, trailingComments } = scanned;
  const ast = new Parser('', tokens).parse();
  if (ast.diagnostics.length > 0) {
    return syntaxError(ast.diagnostics);
  }

  // a short anonymous function on one line that does not fit is expanded,
  // and the ones holding it
  const expanded = new Set<number>();
  let roles: Roles;
  let texts: string[];
  let physical: PhysicalLine[];
  for (;;) {
    roles = annotate(ast.script, tokens, expanded, options);
    const current = roles;
    texts = tokens.map(token =>
      current.names.has(token) ? token.lexeme : tokenText(token, options),
    );
    const lines = buildLines(tokens, texts, trailingComments, roles, options);

    physical = [];
    const groups = new Map<number, number[]>();
    for (const [first, last] of roles.groups) {
      groups.set(first, [...(groups.get(first) ?? []), last]);
    }
    for (const line of lines) {
      physical.push(...layout(line, 0, groups, options));
    }

    const misfits = misfitLambdas(physical, roles.shortLambdas, options);
    if (misfits.length === 0) {
      break;
    }
    for (const [open, close] of roles.shortLambdas) {
      if (misfits.some(([o, c]) => open <= o && c <= close)) {
        expanded.add(open);
      }
    }
  }
  if (options.AlignTrailingComments) {
    alignTrailingComments(physical, options.SpacesBeforeTrailingComments);
  }
  let reflowed = false;
  if (options.ReflowComments && options.ColumnLimit > 0) {
    ({ lines: physical, reflowed } = reflowComments(
      physical,
      options.ColumnLimit,
    ));
  }

  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const starts: number[] = [];
  const ends: number[] = [];
  let text = '';
  for (const line of physical) {
    text += eol.repeat(line.blank);
    const lineStart = text.length;
    text += ' '.repeat(line.indent);
    for (const piece of line.pieces) {
      text += ' '.repeat(piece.sep);
      if (piece.token !== undefined) {
        starts[piece.token] = text.length;
        ends[piece.token] = text.length + piece.text.length;
      }
      const column = text.length - lineStart;
      text += piece.text;
      for (const continuation of piece.continuation ?? []) {
        text += eol + ' '.repeat(column) + continuation;
      }
    }
    text += eol;
  }

  return { tokens, texts, trailingComments, text, starts, ends, reflowed };
}

/**
 * Properties of statements holding a name
 */
const nameProperties = ['identifier', 'element', 'collection', 'target'];

/**
 * The refusal to format a file with syntax errors, naming the first one
 */
function syntaxError(diagnostics: Diagnostic[]): { error: string } {
  const first = diagnostics.reduce((a, b) =>
    before(b.range.start, a.range.start) ? b : a,
  );
  const { line, character } = first.range.start;
  return {
    error: `Syntax error at ${line + 1}:${character + 1}: ${first.message}`,
  };
}

/**
 * Find what the AST knows about the tokens
 * @param script the parsed script
 * @param tokens the tokens of the script
 * @param expanded the open braces of anonymous functions too long for one
 * line
 * @param options formatter options
 */
function annotate(
  script: NodeBase,
  tokens: Token[],
  expanded: Set<number>,
  options: FormatOptions,
): Roles {
  const roles: Roles = {
    names: new Set(),
    unary: new Set(),
    callOpen: new Set(),
    blocks: new Map(),
    groups: [],
    shortLambdas: [],
  };
  const groups: NodeBase[] = [];
  const chained = new Set<unknown>();
  const headers = new Set<Stmt.Block>();
  const lambdas = new Set<Stmt.Block>();
  const blocks: Stmt.Block[] = [];
  const seen = new Set<object>();

  const visit = (node: unknown): void => {
    if (typeof node !== 'object' || node === null || seen.has(node)) {
      return;
    }
    if (node instanceof Token) {
      return;
    }
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!(node instanceof NodeBase)) {
      return;
    }

    for (const key of nameProperties) {
      const value: unknown = Reflect.get(node, key);
      if (isToken(value)) {
        roles.names.add(value);
      }
    }

    if (node instanceof SuffixTerm.Identifier) {
      roles.names.add(node.token);
    } else if (node instanceof Expr.Binary) {
      const left = node.left;
      if (
        left instanceof Expr.Binary &&
        binaryOperators.get(left.operator.type) ===
          binaryOperators.get(node.operator.type)
      ) {
        chained.add(left);
      }
      if (!chained.has(node)) {
        groups.push(node);
      }
    } else if (node instanceof Expr.Ternary) {
      groups.push(node);
    } else if (node instanceof Expr.Unary) {
      roles.unary.add(node.operator);
    } else if (node instanceof SuffixTerm.Call) {
      roles.callOpen.add(node.open);
    } else if (
      node instanceof Stmt.RunPath ||
      node instanceof Stmt.RunOncePath ||
      node instanceof Stmt.Run
    ) {
      if (node.open !== undefined) {
        roles.callOpen.add(node.open);
      }
    } else if (node instanceof Stmt.From) {
      headers.add(node.initializer);
      headers.add(node.increment);
    } else if (node instanceof Expr.Lambda) {
      lambdas.add(node.block);
    } else if (node instanceof Stmt.Block) {
      blocks.push(node);
    }

    Object.values(node).forEach(visit);
  };
  visit(script);

  const index = new Map<Token, number>();
  tokens.forEach((token, i) => index.set(token, i));

  const key = (position: Position) => `${position.line}:${position.character}`;
  const starts = new Map<string, number>();
  const ends = new Map<string, number>();
  tokens.forEach((token, i) => {
    starts.set(key(token.start), i);
    ends.set(key(token.end), i);
  });
  for (const group of groups) {
    const first = starts.get(key(group.start));
    const last = ends.get(key(group.end));
    if (first !== undefined && last !== undefined && first < last) {
      roles.groups.push([first, last]);
    }
  }

  // statement blocks, which are always expanded
  const statementOpens = blocks
    .filter(block => !headers.has(block) && !lambdas.has(block))
    .map(block => index.get(block.open) ?? -1);

  for (const block of blocks) {
    const open = index.get(block.open) ?? -1;
    const close = index.get(block.close) ?? -1;
    let comments = false;
    for (let i = open + 1; i <= close; i += 1) {
      if ((tokens[i].leadingComments?.length ?? 0) > 0) {
        comments = true;
        break;
      }
    }

    const header = headers.has(block);
    const lambda = lambdas.has(block);
    const short =
      lambda &&
      options.AllowShortLambdasOnASingleLine === 'All' &&
      !expanded.has(open) &&
      !statementOpens.some(i => open < i && i < close);
    if (short && !comments && block.stmts.length > 0) {
      roles.shortLambdas.push([open, close]);
    }
    const info: BlockInfo = {
      open: block.open,
      close: block.close,
      layout:
        block.stmts.length === 0 && !comments
          ? 'empty'
          : (header || short) && !comments
          ? 'inline'
          : 'expanded',
      continues: header || lambda,
      statement: !header && !lambda,
    };
    roles.blocks.set(block.open, info);
    roles.blocks.set(block.close, info);
  }

  return roles;
}

/**
 * Text of a token in the output: keywords in the chosen case, numbers
 * without the spaces the scanner allows around an exponent
 * @param token the token
 * @param options formatter options
 */
function tokenText(token: Token, options: FormatOptions): string {
  switch (token.type) {
    case TokenType.integer:
    case TokenType.double:
      return token.lexeme.replace(/\s+/g, '');
    case TokenType.identifier:
    case TokenType.fileIdentifier:
    case TokenType.string:
      return token.lexeme;
  }

  if (!/^[a-z]+$/i.test(token.lexeme)) {
    return token.lexeme;
  }
  switch (options.KeywordCase) {
    case 'Lower':
      return camelKeywords.get(token.type) ?? token.lexeme.toLowerCase();
    case 'Upper':
      return token.lexeme.toUpperCase();
    case 'Preserve':
      return token.lexeme;
  }
}

/**
 * Lines being built for the script or for the body of an anonymous function
 */
interface Context {
  lines: LogicalLine[];
  level: number;
  current: Maybe<LogicalLine>;

  /**
   * The body item of the anonymous function, and the line holding it
   */
  body?: BlockBody;
  outer?: Context;
}

/**
 * Cut the token stream into logical lines: a statement, a block brace, a
 * comment on its own line. The body of an anonymous function is an item of
 * the line holding it.
 */
function buildLines(
  tokens: Token[],
  texts: string[],
  trailingComments: Comment[],
  roles: Roles,
  options: FormatOptions,
): LogicalLine[] {
  const root: Context = { lines: [], level: 0, current: undefined };
  const stack: BlockInfo[] = [];
  let ctx = root;
  let lastEndLine = -1;
  let breakNext = false;

  // the trailing comment the next comment line may continue, aligned under
  // it
  let continued: Maybe<{ item: Item; line: number; character: number }>;

  // blank lines kept before a line starting on a source line
  const blankBefore = (line: number): number => {
    const last = ctx.lines[ctx.lines.length - 1];
    if (last === undefined || last.opensBlock) {
      return 0;
    }
    return Math.max(
      0,
      Math.min(options.MaxEmptyLinesToKeep, line - lastEndLine - 1),
    );
  };

  const startLine = (blank: number): LogicalLine => {
    const line: LogicalLine = {
      level: ctx.level,
      blank,
      items: [],
      opensBlock: false,
    };
    ctx.lines.push(line);
    ctx.current = line;
    breakNext = false;
    return line;
  };

  const endLine = (opensBlock = false): void => {
    if (ctx.current !== undefined) {
      ctx.current.opensBlock = opensBlock;
    }
    ctx.current = undefined;
  };

  const push = (line: LogicalLine, item: Item): void => {
    if (line === ctx.current && breakNext) {
      item.mustBreak = true;
      breakNext = false;
    }
    line.items.push(item);
  };

  const comments = (list: Maybe<Comment[]>): void => {
    for (const comment of list ?? []) {
      const text = comment.text.trimEnd();
      const { start } = comment.range;
      if (
        continued !== undefined &&
        !comment.trailing &&
        start.line === continued.line + 1 &&
        start.character === continued.character
      ) {
        continued.item.continuation = [
          ...(continued.item.continuation ?? []),
          text,
        ];
        continued.line = start.line;
        lastEndLine = comment.range.end.line;
        continue;
      }
      continued = undefined;

      const { current } = ctx;
      const last: Maybe<LogicalLine> =
        current !== undefined && current.items.length > 0
          ? current
          : ctx.lines[ctx.lines.length - 1];

      if (comment.trailing && last !== undefined) {
        const item: Item = {
          text,
          trailing: true,
          space: true,
          mustBreak: false,
        };
        push(last, item);
        continued = { item, line: start.line, character: start.character };
        if (last === current) {
          breakNext = true;
        }
      } else if (comment.trailing && ctx.body !== undefined) {
        // right after the `{` of an anonymous function
        ctx.body.comment = text;
      } else if (current !== undefined && current.items.length > 0) {
        push(current, { text, space: true, mustBreak: true });
        breakNext = true;
      } else {
        const line = startLine(blankBefore(comment.range.start.line));
        push(line, { text, space: false, mustBreak: false });
        endLine();
      }
      lastEndLine = comment.range.end.line;
    }
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    const next: Maybe<Token> = tokens[i + 1];
    const block = roles.blocks.get(token);

    comments(token.leadingComments);
    continued = undefined;

    const line = (blank: number): LogicalLine =>
      ctx.current ?? startLine(blank);
    const blank =
      token.type === TokenType.else ? 0 : blankBefore(token.start.line);
    const item = (): Item => {
      const previous = ctx.current?.items.length ? tokens[i - 1] : undefined;
      return {
        text: texts[i],
        token: i,
        space: previous === undefined || spaceBetween(previous, token, roles),
        mustBreak: false,
        cost:
          previous === undefined
            ? undefined
            : breakCost(previous, token, roles, options),
        open:
          token.type === TokenType.bracketOpen ||
          token.type === TokenType.squareOpen,
        close:
          token.type === TokenType.bracketClose ||
          token.type === TokenType.squareClose,
        call: roles.callOpen.has(token),
      };
    };

    if (block !== undefined && block.open === token) {
      if (block.layout === 'expanded' && block.statement) {
        const ownLine =
          options.BreakBeforeBraces === 'Allman' ||
          (token.leadingComments?.length ?? 0) > 0;
        if (ownLine) {
          endLine();
        }
        const target = line(ownLine && ctx.lines.length > 0 ? 0 : blank);
        push(target, { ...item(), space: true });
        endLine(true);
        ctx.level += 1;
      } else if (block.layout === 'expanded') {
        const holder = line(blank);
        push(holder, item());
        const body: BlockBody = { lines: [] };
        push(holder, { text: '', space: false, mustBreak: false, block: body });
        ctx = { lines: body.lines, level: 0, current: undefined, body, outer: ctx };
      } else {
        push(line(blank), { ...item(), open: block.layout === 'inline' });
      }
      stack.push(block);
    } else if (block !== undefined && block.close === token) {
      stack.pop();
      if (block.layout === 'expanded' && block.statement) {
        endLine();
        ctx.level -= 1;
        push(startLine(0), item());
      } else if (block.layout === 'expanded') {
        endLine();
        ctx = ctx.outer as Context;
        push(line(0), { ...item(), space: false });
      } else {
        push(line(blank), {
          ...item(),
          space: block.layout === 'inline',
          close: block.layout === 'inline',
        });
      }

      if (!block.continues) {
        const joins =
          next !== undefined &&
          (next.type === TokenType.period ||
            (next.type === TokenType.else &&
              options.BreakBeforeBraces === 'Attach' &&
              (next.leadingComments?.length ?? 0) === 0));
        if (!joins) {
          endLine();
        }
      }
    } else {
      push(line(blank), item());
      const inner = stack[stack.length - 1];
      if (
        token.type === TokenType.period &&
        (inner === undefined || inner.layout === 'expanded')
      ) {
        endLine();
      }
    }

    lastEndLine = token.end.line;
  }

  comments(trailingComments);
  return root.lines;
}

/**
 * Whether a space separates two tokens on the same line
 */
function spaceBetween(previous: Token, token: Token, roles: Roles): boolean {
  if (noSpaceAfter.has(previous.type)) {
    return false;
  }
  if (
    roles.unary.has(previous) &&
    (previous.type === TokenType.minus || previous.type === TokenType.plus)
  ) {
    return false;
  }
  if (noSpaceBefore.has(token.type)) {
    return false;
  }

  switch (token.type) {
    case TokenType.bracketOpen:
      return !roles.callOpen.has(token);
    case TokenType.atSign:
      // a delegate, `foo@`
      return false;
    case TokenType.curlyClose:
      return roles.blocks.get(token)?.layout !== 'empty';
  }

  return true;
}

/**
 * Cost of a line break between two tokens, undefined where none is allowed
 */
function breakCost(
  previous: Token,
  token: Token,
  roles: Roles,
  options: FormatOptions,
): Maybe<number> {
  if (noSpaceBefore.has(token.type) || token.type === TokenType.atSign) {
    return undefined;
  }
  if (token.type === TokenType.curlyClose) {
    return undefined;
  }

  if (previous.type === TokenType.comma) {
    return costComma;
  }
  const before = options.BreakBeforeBinaryOperators === 'All';
  const operator = before ? token : previous;
  const cost = binaryOperators.get(operator.type);
  if (cost !== undefined && !roles.unary.has(operator)) {
    return cost;
  }
  if (separatorKeywords.has(previous.type)) {
    return costKeyword;
  }
  if (
    previous.type === TokenType.bracketOpen ||
    previous.type === TokenType.squareOpen ||
    (previous.type === TokenType.curlyOpen &&
      roles.blocks.get(previous)?.layout === 'inline')
  ) {
    return costBracket;
  }
  return undefined;
}

/**
 * An open bracket or operand group while a line is laid out
 */
interface Frame {
  /**
   * Column a broken line continues at inside it
   */
  align: number;

  /**
   * Indentation of the line holding its start
   */
  indent: number;

  /**
   * An operand group rather than a bracket
   */
  group: boolean;

  /**
   * The arguments of a call not bin-packed: whether the line broke at its
   * commas, which it then does at all of them, or at none
   */
  commas?: 'unknown' | 'broken' | 'joined';
}

/**
 * A partial layout of a logical line: the items before `next` are placed
 */
interface State {
  next: number;
  column: number;
  indent: number;
  frames: Frame[];
  penalty: number;

  /**
   * Indexes of the items a line break precedes, by choice, latest first
   */
  breaks: Maybe<BreakList>;
}

interface BreakList {
  item: number;
  rest: Maybe<BreakList>;
}

/**
 * Receives the layout chosen, line by line
 */
interface Sink {
  line(indent: number): void;
  piece(piece: Piece): void;
  body(body: BlockBody, indent: number): void;
}

const penaltyExcess = 1000;
const penaltyBreak = 20;
const penaltyKind = 4;
const penaltyBracket = 30;
const penaltyGroup = 15;
const penaltyShortLine = 4;
const penaltyRefused = 1e7;

/**
 * Fewest columns a trailing comment is reflowed to: one starting further
 * right is left long rather than cut into a column of words
 */
const minTrailingWidth = 20;
const searchLimit = 5000;

/**
 * Place a logical line on physical lines. Each item that allows a line
 * break before it is a choice; the layout chosen is the one with the
 * lowest penalty: every column past the limit costs much, every line
 * break a little more for each bracket and operand group it is inside, so
 * breaks go to the outermost level and a group that fits on the next line
 * is kept whole. A broken line continues aligned with the start of the
 * innermost operand group, or after the innermost open bracket.
 * @param line the logical line
 * @param base indentation of block level 0
 * @param groups operand groups by first token: their last tokens
 * @param options formatter options
 */
function layout(
  line: LogicalLine,
  base: number,
  groups: Map<number, number[]>,
  options: FormatOptions,
): PhysicalLine[] {
  const lineIndent = base + line.level * options.IndentWidth;
  const limit = options.ColumnLimit > 0 ? options.ColumnLimit : Infinity;
  const { items } = line;
  splitGroups(items);

  // operand groups opening and closing at each item
  const itemOf = new Map<number, number>();
  items.forEach((item, k) => {
    if (item.token !== undefined) {
      itemOf.set(item.token, k);
    }
  });
  const opens: number[] = items.map(() => 0);
  const closes: number[] = items.map(() => 0);
  items.forEach((item, k) => {
    for (const last of groups.get(item.token ?? -1) ?? []) {
      const end = itemOf.get(last);
      if (end !== undefined) {
        opens[k] += 1;
        closes[end] += 1;
      }
    }
  });

  const choice = (k: number) =>
    k > 0 &&
    items[k].cost !== undefined &&
    !items[k].mustBreak &&
    items[k].block === undefined;

  // place items from state.next, breaking before the first if asked, up
  // to the next choice
  const step = (state: State, breakFirst: boolean, sink?: Sink): State => {
    let { next: k, column, indent, penalty } = state;
    const frames = state.frames.slice();
    let atStart = k === 0;

    // arguments not bin-packed break at all their commas or none, and at
    // all of them when one breaks inside (not right after its bracket)
    const previous = items[k - 1];
    if (previous !== undefined && (choice(k) || items[k].mustBreak)) {
      const broken = breakFirst || items[k].mustBreak;
      const comma = previous.token !== undefined && previous.text === ',';
      const top = frames.map(frame => !frame.group).lastIndexOf(true);
      frames.forEach((frame, j) => {
        if (frame.commas === undefined || (j === top && previous.open)) {
          return;
        }
        const commas = broken ? 'broken' : 'joined';
        if (j !== top || !comma) {
          if (!broken) {
            return;
          }
        }
        if (frame.commas === 'unknown') {
          frames[j] = { ...frame, commas };
        } else if (frame.commas !== commas && choice(k)) {
          penalty += penaltyRefused;
        }
      });
    }

    for (let first = true; k < items.length; first = false, k += 1) {
      const item = items[k];
      if (!first && choice(k)) {
        break;
      }

      if (item.block !== undefined) {
        // the body of an anonymous function, then its `}` where the line began
        sink?.body(item.block, indent);
        sink?.line(indent);
        column = indent;
        atStart = true;
        continue;
      }

      if (k > 0 && !atStart && (item.mustBreak || (first && breakFirst))) {
        if (first && breakFirst) {
          penalty += breakPenalty(k, column, frames);
        }
        indent = breakIndent(k, frames);
        column = indent;
        atStart = true;
        sink?.line(indent);
      }

      const sep = atStart
        ? 0
        : item.trailing
        ? options.SpacesBeforeTrailingComments
        : item.space
        ? 1
        : 0;
      const start = column + sep;
      for (let g = 0; g < opens[k]; g += 1) {
        frames.push({ align: start, indent, group: true });
      }

      sink?.piece({
        text: item.text,
        sep,
        token: item.token,
        trailing: item.trailing,
        continuation: item.continuation,
      });
      const newline = item.text.indexOf('\n');
      const end =
        newline === -1 ? start + item.text.length : start + newline;
      if (!item.trailing) {
        penalty +=
          penaltyExcess *
          (Math.max(0, end - limit) - Math.max(0, column - limit));
      }
      column =
        newline === -1
          ? end
          : item.text.length - item.text.lastIndexOf('\n') - 1;
      atStart = false;

      if (item.open) {
        frames.push({
          align: column + (item.text === '{' ? 1 : 0),
          indent,
          group: false,
          commas: item.call && !options.BinPackArguments ? 'unknown' : undefined,
        });
      }
      if (item.close) {
        while (frames.length > 0 && frames[frames.length - 1].group) {
          frames.pop();
        }
        frames.pop();
      }
      for (let g = 0; g < closes[k]; g += 1) {
        if (frames.length > 0 && frames[frames.length - 1].group) {
          frames.pop();
        }
      }
    }

    return {
      next: k,
      column,
      indent,
      frames,
      penalty,
      breaks: breakFirst ? { item: state.next, rest: state.breaks } : state.breaks,
    };
  };

  const breakPenalty = (k: number, column: number, frames: Frame[]) => {
    const brackets = frames.filter(frame => !frame.group).length;
    const operandGroups = frames.length - brackets;
    const short = limit === Infinity ? 0 : (limit - column) / limit;
    return (
      penaltyBreak +
      penaltyKind * (items[k].cost ?? 0) +
      penaltyBracket * brackets +
      penaltyGroup * Math.max(0, operandGroups - 1) +
      penaltyShortLine * Math.max(0, short)
    );
  };

  // where a line broken before item k continues; may move the alignment
  // of the innermost bracket
  const breakIndent = (k: number, frames: Frame[]): number => {
    const top = frames[frames.length - 1];
    if (top === undefined) {
      return lineIndent + options.ContinuationIndentWidth;
    }
    if (items[k].ownLine) {
      const bracket = [...frames].reverse().find(frame => !frame.group);
      return bracket?.indent ?? lineIndent;
    }
    if (!top.group && items[k - 1].open) {
      const indent = top.indent + options.ContinuationIndentWidth;
      frames[frames.length - 1] = { ...top, align: indent };
      return indent;
    }
    return top.align;
  };

  const initial: State = {
    next: 0,
    column: lineIndent,
    indent: lineIndent,
    frames: [],
    penalty: 0,
    breaks: undefined,
  };
  const chosen = search(initial, items.length, step, choice) ?? firstFit(
    initial,
    items.length,
    step,
  );

  // replay the chosen breaks
  const breaks = new Set<number>();
  for (let list = chosen.breaks; list !== undefined; list = list.rest) {
    breaks.add(list.item);
  }
  const out: PhysicalLine[] = [];
  let current: PhysicalLine = { blank: line.blank, indent: lineIndent, pieces: [] };
  out.push(current);
  const sink: Sink = {
    line: indent => {
      current = { blank: 0, indent, pieces: [] };
      out.push(current);
    },
    piece: piece => current.pieces.push(piece),
    body: (body, indent) => {
      if (body.comment !== undefined) {
        current.pieces.push({
          text: body.comment,
          sep: options.SpacesBeforeTrailingComments,
          trailing: true,
        });
      }
      for (const child of body.lines) {
        out.push(
          ...layout(child, indent + options.IndentWidth, groups, options),
        );
      }
    },
  };

  let state = initial;
  while (state.next < items.length) {
    state = step(state, breaks.has(state.next), sink);
  }
  return out;
}

/**
 * Best-first search of the layout with the lowest penalty, undefined if it
 * takes too long
 */
function search(
  initial: State,
  count: number,
  step: (state: State, breakFirst: boolean) => State,
  choice: (k: number) => boolean,
): Maybe<State> {
  const queue = new Heap<State>(
    (a, b) => a.penalty - b.penalty || b.next - a.next,
  );
  const seen = new Map<string, number>();
  queue.push(step(initial, false));

  for (let popped = 0; popped < searchLimit; popped += 1) {
    const state = queue.pop();
    if (state === undefined) {
      return undefined;
    }
    if (state.next >= count) {
      return state;
    }

    const key = `${state.next} ${state.column} ${state.indent} ${state.frames
      .map(
        frame =>
          `${frame.align},${frame.indent},${frame.group},${frame.commas ?? ''}`,
      )
      .join(' ')}`;
    const best = seen.get(key);
    if (best !== undefined && best <= state.penalty) {
      continue;
    }
    seen.set(key, state.penalty);

    queue.push(step(state, false));
    if (choice(state.next)) {
      queue.push(step(state, true));
    }
  }
  return undefined;
}

/**
 * Layout breaking only where the next item would go past the limit, for
 * lines too costly to search
 */
function firstFit(
  initial: State,
  count: number,
  step: (state: State, breakFirst: boolean) => State,
): State {
  let state = step(initial, false);
  while (state.next < count) {
    const stay = step(state, false);
    const broken = step(state, true);
    state =
      stay.penalty - state.penalty > broken.penalty - state.penalty
        ? broken
        : stay;
  }
  return state;
}

/**
 * A binary heap, smallest first
 */
class Heap<T> {
  private readonly items: T[] = [];

  constructor(private readonly compare: (a: T, b: T) => number) {}

  public push(item: T): void {
    const { items } = this;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.compare(items[i], items[parent]) >= 0) {
        break;
      }
      [items[i], items[parent]] = [items[parent], items[i]];
      i = parent;
    }
  }

  public pop(): Maybe<T> {
    const { items } = this;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0 && last !== undefined) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && this.compare(items[left], items[smallest]) < 0) {
          smallest = left;
        }
        if (right < items.length && this.compare(items[right], items[smallest]) < 0) {
          smallest = right;
        }
        if (smallest === i) {
          break;
        }
        [items[i], items[smallest]] = [items[smallest], items[i]];
        i = smallest;
      }
    }
    return top;
  }
}

/**
 * Put each element of a bracket on its own line, and the closing bracket
 * too, when two or more of its elements hold the body of an anonymous
 * function
 */
function splitGroups(items: Item[]): void {
  interface Group {
    multiline: number;
    current: boolean;
    starts: number[];
  }

  const groups: Group[] = [];
  const finish = (group: Group) => {
    if (group.current) {
      group.multiline += 1;
    }
    group.current = false;
  };

  for (let k = 0; k < items.length; k += 1) {
    const item = items[k];
    const group: Maybe<Group> = groups[groups.length - 1];

    if (item.block !== undefined) {
      if (group !== undefined) {
        group.current = true;
      }
    } else if (item.open) {
      groups.push({ multiline: 0, current: false, starts: [k + 1] });
    } else if (item.close && group !== undefined) {
      groups.pop();
      finish(group);
      if (group.multiline >= 2) {
        for (let start of group.starts) {
          while (start < k && items[start].trailing) {
            start += 1;
          }
          if (start < k) {
            items[start].mustBreak = true;
          }
        }
        item.mustBreak = true;
        item.ownLine = true;
      }

      const parent = groups[groups.length - 1];
      if (parent !== undefined && group.multiline > 0) {
        parent.current = true;
      }
    } else if (group !== undefined && item.token !== undefined && item.text === ',') {
      finish(group);
      group.starts.push(k + 1);
    }
  }
}

/**
 * Break the comments that go past the column limit: comments on their own
 * lines, as blocks of consecutive lines at the same indentation, and
 * trailing comments with the lines continuing them (when enough columns are
 * left for them)
 * @param lines the laid out lines
 * @param limit the column limit
 */
function reflowComments(
  lines: PhysicalLine[],
  limit: number,
): { lines: PhysicalLine[]; reflowed: boolean } {
  let reflowed = false;
  const reflow = (texts: string[], width: number): string[] => {
    const result = reflowLines(texts, width);
    reflowed ||=
      result.length !== texts.length || result.some((t, n) => t !== texts[n]);
    return result;
  };

  const own = (line: PhysicalLine) =>
    line.pieces.length === 1 &&
    line.pieces[0].token === undefined &&
    !line.pieces[0].trailing;

  const out: PhysicalLine[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (own(line)) {
      let end = i + 1;
      while (
        end < lines.length &&
        own(lines[end]) &&
        lines[end].blank === 0 &&
        lines[end].indent === line.indent
      ) {
        end += 1;
      }
      const texts = lines.slice(i, end).map(block => block.pieces[0].text);
      reflow(texts, limit - line.indent).forEach((text, n) =>
        out.push({
          blank: n === 0 ? line.blank : 0,
          indent: line.indent,
          pieces: [{ text, sep: 0 }],
        }),
      );
      i = end - 1;
      continue;
    }

    let column = line.indent;
    for (const piece of line.pieces) {
      column += piece.sep;
      if (piece.trailing && limit - column >= minTrailingWidth) {
        const [first, ...rest] = reflow(
          [piece.text, ...(piece.continuation ?? [])],
          limit - column,
        );
        piece.text = first;
        piece.continuation = rest.length > 0 ? rest : undefined;
      }
      column += piece.text.length;
    }
    out.push(line);
  }
  return { lines: out, reflowed };
}

/**
 * Reflow the lines of a comment to a width. A line too long breaks at the
 * last space that fits; the rest joins the next line when it is plain text
 * and does not end a sentence, else gets lines of its own. Left as they
 * are: blank comment lines, directives, fenced code, indented text, and
 * words longer than the width.
 * List items and tags (`- `, `1. `, `@param`) start a line of their own.
 * @param texts the comment lines, `//` included
 * @param width columns available, `//` included
 */
function reflowLines(texts: string[], width: number): string[] {
  const out: string[] = [];
  let carry: Maybe<{ marker: string; content: string }>;

  // a content broken to the width: the line that fits, and the rest
  const split = (marker: string, content: string): [string, Maybe<string>] => {
    if (marker.length + content.length <= width) {
      return [content, undefined];
    }
    // no break before a `//` inside the comment: its line would start `////`
    const breaks = (at: number) =>
      at > 0 && !content.startsWith('//', at + 1);
    let at = content.lastIndexOf(' ', width - marker.length);
    while (at > 0 && !breaks(at)) {
      at = content.lastIndexOf(' ', at - 1);
    }
    if (at <= 0) {
      at = content.indexOf(' ', 1);
      while (at > 0 && !breaks(at)) {
        at = content.indexOf(' ', at + 1);
      }
    }
    if (at <= 0) {
      return [content, undefined];
    }
    const rest = content.slice(at + 1).trimStart();
    return [content.slice(0, at).trimEnd(), rest === '' ? undefined : rest];
  };

  const flush = () => {
    while (carry !== undefined) {
      const [fits, rest] = split(carry.marker, carry.content);
      out.push(carry.marker + fits);
      carry = rest === undefined ? undefined : { ...carry, content: rest };
    }
  };

  let fence = false;
  for (const text of texts) {
    const [, slashes, space, rest] = /^(\/\/)(\s*)(.*)$/.exec(text) ?? [
      '',
      '',
      '',
      text,
    ];
    let content = rest;
    const marker = slashes + space;
    const fenceLine = content.startsWith('```');
    const verbatim =
      fence ||
      fenceLine ||
      slashes === '' ||
      content === '' ||
      content.startsWith('#') ||
      space.length > 1;
    if (fenceLine) {
      fence = !fence;
    }

    // as clang-format, a line starting with a tag, a list marker or two
    // punctuation characters takes no text from the line above; nor does
    // any line after a sentence or a statement (commented out code)
    const joins =
      !verbatim &&
      !/^(@|\\|TODO|FIXME|XXX|[-*+]\s|\d+[.)]\s|>|\|)/.test(content) &&
      !/^[\p{P}\p{S}]{2}/u.test(content) &&
      carry !== undefined &&
      !carry.content.endsWith('.');
    if (carry !== undefined && joins) {
      content = `${carry.content} ${content}`;
      carry = undefined;
    } else {
      flush();
    }

    if (verbatim) {
      out.push(text);
      continue;
    }

    const [fits, overflow] = split(marker, content);
    out.push(marker + fits);
    carry = overflow === undefined ? undefined : { marker, content: overflow };
  }
  flush();
  return out;
}

/**
 * The anonymous functions on one line that do not fit: broken across
 * lines, or on a line past the column limit
 * @param lines the laid out lines
 * @param lambdas indexes of the braces of the short anonymous functions
 * @param options formatter options
 */
function misfitLambdas(
  lines: PhysicalLine[],
  lambdas: [number, number][],
  options: FormatOptions,
): [number, number][] {
  const limit = options.ColumnLimit > 0 ? options.ColumnLimit : Infinity;
  const lineOf = new Map<number, number>();
  const tooLong = lines.map((line, n) => {
    let column = line.indent;
    for (const piece of line.pieces) {
      if (piece.token !== undefined) {
        lineOf.set(piece.token, n);
      }
      if (!piece.trailing) {
        column += piece.sep + piece.text.length;
      }
    }
    return column > limit;
  });

  return lambdas.filter(([open, close]) => {
    const line = lineOf.get(open);
    return line === undefined || line !== lineOf.get(close) || tooLong[line];
  });
}

/**
 * Align the comments ending consecutive lines of code
 */
function alignTrailingComments(lines: PhysicalLine[], spaces: number): void {
  const width = (line: PhysicalLine): Maybe<number> => {
    const last = line.pieces[line.pieces.length - 1];
    if (last === undefined || !last.trailing || line.pieces.length < 2) {
      return undefined;
    }
    let column = line.indent;
    for (const piece of line.pieces.slice(0, -1)) {
      if (piece.text.includes('\n')) {
        return undefined;
      }
      column += piece.sep + piece.text.length;
    }
    return column;
  };

  let i = 0;
  while (i < lines.length) {
    if (width(lines[i]) === undefined) {
      i += 1;
      continue;
    }

    let end = i + 1;
    while (
      end < lines.length &&
      lines[end].blank === 0 &&
      width(lines[end]) !== undefined
    ) {
      end += 1;
    }

    const group = lines.slice(i, end);
    const column = Math.max(...group.map(line => width(line) as number));
    for (const line of group) {
      line.pieces[line.pieces.length - 1].sep =
        column + spaces - (width(line) as number);
    }
    i = end;
  }
}

/**
 * Check that the formatted text has the tokens and comments of the source,
 * returning what differs
 */
function sameContent(
  tokens: Token[],
  texts: string[],
  trailingComments: Comment[],
  text: string,
  reflowed: boolean,
): Maybe<string> {
  const scanned = new Scanner(text).scanTokens();
  if (scanned.diagnostics.length > 0) {
    return 'scan errors';
  }
  if (scanned.tokens.length !== tokens.length) {
    return 'token count';
  }

  // reflowed comments keep their words, not their lines
  const commentsOf = (list: Token[], trailing: Comment[]) => {
    const comments = list
      .flatMap(token => token.leadingComments ?? [])
      .concat(trailing)
      .map(comment => comment.text.trimEnd());
    return reflowed
      ? comments.flatMap(comment =>
          comment.replace(/^\/\//, '').split(/\s+/).filter(word => word !== ''),
        )
      : comments;
  };

  for (let i = 0; i < tokens.length; i += 1) {
    const before = tokens[i];
    const after = scanned.tokens[i];
    if (
      before.type !== after.type ||
      texts[i] !== after.lexeme
    ) {
      return `token ${before.lexeme} at ${before.start.line + 1}:${
        before.start.character + 1
      }`;
    }
  }

  const before = commentsOf(tokens, trailingComments);
  const after = commentsOf(scanned.tokens, scanned.trailingComments);
  if (before.length !== after.length || before.some((c, i) => c !== after[i])) {
    return 'comments';
  }
  return undefined;
}

/**
 * Edits turning the source into the formatted text: one per changed gap
 * between tokens, one per token written differently
 */
function edits(
  source: string,
  tokens: Token[],
  texts: string[],
  text: string,
  starts: number[],
  ends: number[],
): TextEdit[] {
  const lineStarts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') {
      lineStarts.push(i + 1);
    }
  }
  const offset = (position: Position) =>
    lineStarts[position.line] + position.character;
  const position = (at: number): Position => {
    let line = lineStarts.length - 1;
    while (lineStarts[line] > at) {
      line -= 1;
    }
    return { line, character: at - lineStarts[line] };
  };

  const result: TextEdit[] = [];
  for (let i = 0; i <= tokens.length; i += 1) {
    const sourceStart = i === 0 ? position(0) : tokens[i - 1].end;
    const sourceEnd =
      i === tokens.length ? position(source.length) : tokens[i].start;
    const outStart = i === 0 ? 0 : ends[i - 1];
    const outEnd = i === tokens.length ? text.length : starts[i];

    const newText = text.slice(outStart, outEnd);
    if (source.slice(offset(sourceStart), offset(sourceEnd)) !== newText) {
      result.push(TextEdit.replace({ start: sourceStart, end: sourceEnd }, newText));
    }

    if (i < tokens.length && texts[i] !== tokens[i].lexeme) {
      result.push(TextEdit.replace(tokens[i].range, texts[i]));
    }
  }

  return result;
}
