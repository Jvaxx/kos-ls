import {
  Range,
  SemanticTokens,
  SemanticTokensBuilder,
  SemanticTokensLegend,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Comment, Token } from '../models/token';
import { TokenType } from '../models/tokentypes';
import { KsSymbolKind, TrackerKind } from '../analysis/types';
import { LexicalInfo } from '../types';
import { builtIn } from '../utilities/constants';
import { symbolDocs } from '../utilities/documentation';
import { structureType } from '../typeChecker/ksTypes/primitives/structure';

/**
 * The semantic token types, LSP's standard ones
 */
const tokenTypes = [
  'keyword',
  'variable',
  'parameter',
  'function',
  'property',
  'method',
  'number',
  'string',
  'comment',
  'operator',
  'type',
  'macro',
] as const;

/**
 * The semantic token modifiers, LSP's standard ones
 */
const tokenModifiers = [
  'declaration',
  'readonly',
  'defaultLibrary',
  'documentation',
] as const;

type SemanticType = (typeof tokenTypes)[number];
type SemanticModifier = (typeof tokenModifiers)[number];

export const semanticTokensLegend: SemanticTokensLegend = {
  tokenTypes: [...tokenTypes],
  tokenModifiers: [...tokenModifiers],
};

/**
 * A classified piece of the document, on one line
 */
interface SemanticToken {
  line: number;
  character: number;
  length: number;
  type: SemanticType;
  modifiers: SemanticModifier[];
}

const operators = new Set([
  TokenType.plus,
  TokenType.minus,
  TokenType.multi,
  TokenType.div,
  TokenType.power,
  TokenType.equal,
  TokenType.notEqual,
  TokenType.greaterEqual,
  TokenType.greater,
  TokenType.lessEqual,
  TokenType.less,
  TokenType.arrayIndex,
]);

/**
 * Punctuation, left to the client
 */
const punctuation = new Set([
  TokenType.bracketOpen,
  TokenType.bracketClose,
  TokenType.curlyOpen,
  TokenType.curlyClose,
  TokenType.squareOpen,
  TokenType.squareClose,
  TokenType.comma,
  TokenType.colon,
  TokenType.period,
  TokenType.eof,
  TokenType.whiteSpace,
  TokenType.unknown,
]);

/**
 * The semantic tokens of a document: keywords, literals, comments and
 * operators from the scanner, names from the analysis (the kind of the
 * symbol they resolve to, whether it is a builtin, read-only, or this is
 * its declaration). Doc comment tags are split: `@param` a keyword, the
 * name a parameter, `{Type}` a type.
 * @param info lexical information of the analysed document
 * @param document the document, of the same text
 * @param range only the tokens intersecting this range
 */
export function semanticTokens(
  info: LexicalInfo,
  document: TextDocument,
  range?: Range,
): SemanticTokens {
  const found: SemanticToken[] = [];
  const add = (
    start: { line: number; character: number },
    end: { line: number; character: number },
    type: SemanticType,
    modifiers: SemanticModifier[] = [],
  ) => {
    // one token per line: clients need not support multiline tokens
    for (let line = start.line; line <= end.line; line++) {
      const from = line === start.line ? start.character : 0;
      const to =
        line === end.line
          ? end.character
          : document
              .getText({
                start: { line, character: 0 },
                end: { line: line + 1, character: 0 },
              })
              .replace(/\r?\n$/, '').length;
      if (to > from) {
        found.push({
          line,
          character: from,
          length: to - from,
          type,
          modifiers,
        });
      }
    }
  };

  for (const token of info.tokens) {
    for (const comment of token.leadingComments ?? []) {
      addComment(comment, add);
    }
    addToken(token, add);
  }
  for (const comment of info.trailingComments) {
    addComment(comment, add);
  }

  const builder = new SemanticTokensBuilder();
  found
    .filter(
      (token) =>
        range === undefined ||
        (token.line >= range.start.line && token.line <= range.end.line),
    )
    .sort((a, b) => a.line - b.line || a.character - b.character)
    .forEach(({ line, character, length, type, modifiers }) =>
      builder.push(
        line,
        character,
        length,
        tokenTypes.indexOf(type),
        modifiers.reduce(
          (bits, modifier) => bits | (1 << tokenModifiers.indexOf(modifier)),
          0,
        ),
      ),
    );

  return builder.build();
}

type Add = (
  start: { line: number; character: number },
  end: { line: number; character: number },
  type: SemanticType,
  modifiers?: SemanticModifier[],
) => void;

/**
 * Classify a token of the script
 */
function addToken(token: Token, add: Add): void {
  if (punctuation.has(token.type)) {
    return;
  }

  // a name, keywords used as names included: what the analysis found.
  // The print statement is tracked as the builtin print function
  const { tracker } = token;
  if (tracker !== undefined && token.type !== TokenType.print) {
    const name = nameToken(token);
    if (name !== undefined) {
      add(token.start, token.end, name.type, name.modifiers);
      return;
    }
  }

  switch (token.type) {
    case TokenType.integer:
    case TokenType.double:
      add(token.start, token.end, 'number');
      return;
    case TokenType.string:
    case TokenType.fileIdentifier:
      add(token.start, token.end, 'string');
      return;
    case TokenType.identifier:
      add(token.start, token.end, 'variable');
      return;
    case TokenType.atSign:
    case TokenType.lazyGlobal:
    case TokenType.clobberBuiltins:
      add(token.start, token.end, 'macro');
      return;
  }

  add(
    token.start,
    token.end,
    operators.has(token.type) ? 'operator' : 'keyword',
  );
}

/**
 * The type and modifiers of a name the analysis resolved
 */
function nameToken(
  token: Token,
): Maybe<{ type: SemanticType; modifiers: SemanticModifier[] }> {
  const tracker = token.tracker!;
  const { symbol, uri } = tracker.declared;
  const modifiers: SemanticModifier[] = [];

  if (tracker.kind === TrackerKind.type) {
    // a suffix; an unknown one of a Structure is shown as a property
    const type = tracker.declared.type;
    if (type === structureType) {
      return { type: 'property', modifiers };
    }
    const method =
      type.callSignature() !== undefined &&
      !type.access.get &&
      !type.access.set;
    modifiers.push('defaultLibrary');
    if (!method && !type.access.set) {
      modifiers.push('readonly');
    }
    return { type: method ? 'method' : 'property', modifiers };
  }

  if (symbol.name === token) {
    modifiers.push('declaration');
  }
  const builtin = uri === builtIn;
  if (builtin) {
    modifiers.push('defaultLibrary');
  }

  switch (symbol.tag) {
    case KsSymbolKind.function:
      return { type: 'function', modifiers };
    case KsSymbolKind.parameter:
      return { type: 'parameter', modifiers };
    case KsSymbolKind.variable:
    case KsSymbolKind.lock: {
      // builtin variables are read-only unless the database says
      // otherwise; the bodies are not in it
      if (builtin) {
        const { access } = symbolDocs(symbol, uri, tracker.declared.type);
        if (
          access === undefined
            ? symbol.tag === KsSymbolKind.variable
            : !access.set
        ) {
          modifiers.push('readonly');
        }
      }
      return { type: 'variable', modifiers };
    }
    default:
      return undefined;
  }
}

/**
 * Classify a comment: a directive (`// #include`), a doc comment tag line
 * split into its parts, or a comment
 */
function addComment(comment: Comment, add: Add): void {
  const { text, range } = comment;
  const { line, character } = range.start;
  const at = (offset: number) => ({ line, character: character + offset });

  if (/^\/\/\s*#/.test(text)) {
    add(range.start, range.end, 'macro');
    return;
  }

  // `@param name {Type}`, `@param {Type} name`, `@return {Type}`
  const tag = /^(\/\/\s*)(@(?:param|returns?)\b)(\s*)/i.exec(text);
  if (tag === null) {
    add(range.start, range.end, 'comment');
    return;
  }

  const doc: SemanticModifier[] = ['documentation'];
  let offset = tag[1].length;
  add(range.start, at(offset), 'comment', doc);
  add(at(offset), at(offset + tag[2].length), 'keyword', doc);
  offset += tag[2].length + tag[3].length;

  const param = tag[2].toLowerCase() === '@param';
  let named = !param;
  while (offset < text.length) {
    const rest = text.slice(offset);
    const type = /^\{[^{}]*\}/.exec(rest);
    const name = named ? null : /^[\p{L}_][\p{L}\p{N}_]*/u.exec(rest);
    const space = /^\s+/.exec(rest);
    if (type !== null) {
      add(at(offset), at(offset + type[0].length), 'type', doc);
      offset += type[0].length;
    } else if (name !== null) {
      add(at(offset), at(offset + name[0].length), 'parameter', doc);
      offset += name[0].length;
      named = true;
    } else if (space !== null) {
      offset += space[0].length;
    } else {
      break;
    }
  }
  add(at(offset), range.end, 'comment', doc);
}
