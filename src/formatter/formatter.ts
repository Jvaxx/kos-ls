import { Position, Range, TextEdit } from 'vscode-languageserver';
import { Scanner } from '../scanner/scanner';
import { Parser } from '../parser/parser';
import { Token, Comment } from '../models/token';
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
 * call, the kind of a block). Statements are cut into logical lines, and a
 * logical line too long for the column limit is broken at the place with the
 * lowest cost (commas, then operators, then keywords, then after a bracket;
 * outer brackets before inner ones).
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
  return format(source, resolveOptions(options));
}

/**
 * Edits formatting the lines of a range: the source is formatted as a whole
 * and only the edits touching the range are kept
 * @param source the source
 * @param range range to format
 * @param options formatter options, defaults for those not given
 */
export function formatRange(
  source: string,
  range: Range,
  options?: Partial<FormatOptions>,
): FormatResult {
  const result = formatText(source, options);
  if ('error' in result) {
    return result;
  }

  const before = (a: Position, b: Position) =>
    a.line < b.line || (a.line === b.line && a.character <= b.character);
  const edits = result.edits.filter(
    edit => before(edit.range.start, range.end) && before(range.start, edit.range.end),
  );
  return { text: result.text, edits };
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
const costBracket = 5;
const costDepth = 10;

/**
 * Format a source with complete options
 * @param source the source
 * @param options formatter options
 */
function format(source: string, options: FormatOptions): FormatResult {
  const scanned = new Scanner(source).scanTokens();
  if (scanned.diagnostics.length > 0) {
    return { error: 'The file has syntax errors.' };
  }

  const { tokens, trailingComments } = scanned;
  const ast = new Parser('', tokens).parse();
  if (ast.diagnostics.length > 0) {
    return { error: 'The file has syntax errors.' };
  }

  const roles = annotate(ast.script, tokens);
  const texts = tokens.map(token =>
    roles.names.has(token) ? token.lexeme : tokenText(token, options),
  );
  const lines = buildLines(tokens, texts, trailingComments, roles, options);

  const physical: PhysicalLine[] = [];
  for (const line of lines) {
    physical.push(...layout(line, 0, options));
  }
  if (options.AlignTrailingComments) {
    alignTrailingComments(physical, options.SpacesBeforeTrailingComments);
  }

  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const starts: number[] = [];
  const ends: number[] = [];
  let text = '';
  for (const line of physical) {
    text += eol.repeat(line.blank) + ' '.repeat(line.indent);
    for (const piece of line.pieces) {
      text += ' '.repeat(piece.sep);
      if (piece.token !== undefined) {
        starts[piece.token] = text.length;
        ends[piece.token] = text.length + piece.text.length;
      }
      text += piece.text;
    }
    text += eol;
  }

  const check = sameContent(tokens, texts, trailingComments, text);
  if (check !== undefined) {
    return { error: `Formatting would change the file (${check}).` };
  }

  return { text, edits: edits(source, tokens, texts, text, starts, ends) };
}

/**
 * Properties of statements holding a name
 */
const nameProperties = ['identifier', 'element', 'collection', 'target'];

/**
 * Find what the AST knows about the tokens
 * @param script the parsed script
 * @param tokens the tokens of the script
 */
function annotate(script: NodeBase, tokens: Token[]): Roles {
  const roles: Roles = {
    names: new Set(),
    unary: new Set(),
    callOpen: new Set(),
    blocks: new Map(),
  };
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
      const value = (node as any)[key];
      if (value instanceof Token) {
        roles.names.add(value);
      }
    }

    if (node instanceof SuffixTerm.Identifier) {
      roles.names.add(node.token);
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

  for (const block of blocks) {
    const open = index.get(block.open);
    const close = index.get(block.close);
    let comments = false;
    if (open !== undefined && close !== undefined) {
      for (let i = open + 1; i <= close; i += 1) {
        if ((tokens[i].leadingComments?.length ?? 0) > 0) {
          comments = true;
          break;
        }
      }
    }

    const header = headers.has(block);
    const lambda = lambdas.has(block);
    const info: BlockInfo = {
      open: block.open,
      close: block.close,
      layout:
        block.stmts.length === 0 && !comments
          ? 'empty'
          : header && !comments
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
      return token.lexeme.toLowerCase();
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
      const { current } = ctx;
      const last: Maybe<LogicalLine> =
        current !== undefined && current.items.length > 0
          ? current
          : ctx.lines[ctx.lines.length - 1];

      if (comment.trailing && last !== undefined) {
        push(last, { text, trailing: true, space: true, mustBreak: false });
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
          previous === undefined ? undefined : breakCost(previous, token, roles),
        open:
          token.type === TokenType.bracketOpen ||
          token.type === TokenType.squareOpen,
        close:
          token.type === TokenType.bracketClose ||
          token.type === TokenType.squareClose,
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
  const operator = binaryOperators.get(previous.type);
  if (operator !== undefined && !roles.unary.has(previous)) {
    return operator;
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

interface Bracket {
  /**
   * Column of what follows the bracket
   */
  align: number;

  /**
   * Indentation of the line holding the bracket
   */
  indent: number;
}

/**
 * Place a logical line on physical lines, breaking it where it goes past the
 * column limit
 * @param line the logical line
 * @param base indentation of block level 0
 * @param options formatter options
 */
function layout(
  line: LogicalLine,
  base: number,
  options: FormatOptions,
): PhysicalLine[] {
  const lineIndent = base + line.level * options.IndentWidth;
  const limit = options.ColumnLimit > 0 ? options.ColumnLimit : Infinity;
  const { items } = line;
  const out: PhysicalLine[] = [];
  splitGroups(items);

  let start = 0;
  let indent = lineIndent;
  let stack: Bracket[] = [];

  while (start < items.length) {
    const brackets = stack.map(bracket => ({ ...bracket }));
    const snapshots: Bracket[][] = [];
    const pieces: Piece[] = [];
    let column = indent;
    let breakAt = items.length;

    for (let k = start; k < items.length; k += 1) {
      const item = items[k];
      snapshots[k] = brackets.map(bracket => ({ ...bracket }));
      if ((k > start && item.mustBreak) || item.block !== undefined) {
        breakAt = k;
        break;
      }

      const sep =
        k === start
          ? 0
          : item.trailing
          ? options.SpacesBeforeTrailingComments
          : item.space
          ? 1
          : 0;
      const firstLine = item.text.split('\n')[0];
      if (
        !item.trailing &&
        k > start &&
        column + sep + firstLine.length > limit
      ) {
        let best = -1;
        let bestCost = Infinity;
        for (let j = start + 1; j <= k; j += 1) {
          const cost = items[j].cost;
          if (cost === undefined) {
            continue;
          }
          const total = cost + costDepth * snapshots[j].length;
          if (total <= bestCost) {
            best = j;
            bestCost = total;
          }
        }
        if (best !== -1) {
          breakAt = best;
          break;
        }
      }

      pieces.push({
        text: item.text,
        sep,
        token: item.token,
        trailing: item.trailing,
      });
      const newline = item.text.lastIndexOf('\n');
      column =
        newline === -1
          ? column + sep + item.text.length
          : item.text.length - newline - 1;

      if (item.open) {
        brackets.push({ align: column + (item.text === '{' ? 1 : 0), indent });
      }
      if (item.close) {
        brackets.pop();
      }
    }

    const physical: PhysicalLine = {
      blank: start === 0 ? line.blank : 0,
      indent,
      pieces: pieces.slice(0, breakAt - start),
    };
    out.push(physical);
    if (breakAt >= items.length) {
      break;
    }

    stack = snapshots[breakAt];
    const body = items[breakAt].block;
    if (body !== undefined) {
      // the body of an anonymous function, then its `}` where the line began
      if (body.comment !== undefined) {
        physical.pieces.push({
          text: body.comment,
          sep: options.SpacesBeforeTrailingComments,
          trailing: true,
        });
      }
      for (const child of body.lines) {
        out.push(...layout(child, indent + options.IndentWidth, options));
      }
      start = breakAt + 1;
      continue;
    }

    // the next line: aligned after the innermost open bracket, or indented
    const top = stack[stack.length - 1];
    if (top === undefined) {
      indent = lineIndent + options.ContinuationIndentWidth;
    } else if (items[breakAt].ownLine) {
      indent = top.indent;
    } else if (items[breakAt - 1].open) {
      indent = top.indent + options.ContinuationIndentWidth;
      top.align = indent;
    } else {
      indent = top.align;
    }
    start = breakAt;
  }

  return out;
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
): Maybe<string> {
  const scanned = new Scanner(text).scanTokens();
  if (scanned.diagnostics.length > 0) {
    return 'scan errors';
  }
  if (scanned.tokens.length !== tokens.length) {
    return 'token count';
  }

  const commentsOf = (list: Token[], trailing: Comment[]) =>
    list
      .flatMap(token => token.leadingComments ?? [])
      .concat(trailing)
      .map(comment => comment.text.trimEnd());

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
