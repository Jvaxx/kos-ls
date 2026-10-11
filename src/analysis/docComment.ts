import { Token } from '../models/token';
import type { Scope, Parameter } from '../parser/models/declare';
import type { TypeDocs } from '../typeChecker/types';

/**
 * A tag of a doc comment: `@param name {Type} text` or
 * `@return {Type} text`
 */
export interface DocTag {
  /**
   * The type between braces, as written
   */
  type?: string;

  /**
   * Description in Markdown
   */
  doc?: string;
}

/**
 * A parameter tag
 */
export interface DocParamTag extends DocTag {
  /**
   * Name of the parameter, as written
   */
  name: string;
}

/**
 * The documentation of a declaration: the block of `//` lines directly
 * above it
 */
export interface DocComment {
  /**
   * Description in Markdown, the lines before the first tag
   */
  doc?: string;

  /**
   * The `@param` tags, in order
   */
  params: DocParamTag[];

  /**
   * The `@return` tag
   */
  returns?: DocTag;
}

/**
 * Join lines of Markdown, dropping blank lines at both ends
 * @param lines lines of text
 */
const joinLines = (lines: string[]): Maybe<string> => {
  const text = lines.join('\n').trim();
  return text === '' ? undefined : text;
};

/**
 * Read `{Type}` at the start of a text
 * @param text text after a tag or its name
 */
const readType = (text: string): { type?: string; rest: string } => {
  const match = /^\{([^{}]*)\}\s*/.exec(text);
  if (match === null) {
    return { rest: text };
  }
  const type = match[1].trim();
  return {
    type: type === '' ? undefined : type,
    rest: text.slice(match[0].length),
  };
};

/**
 * Read a `@param` tag: `name {Type} text`, also `{Type} name text`
 * @param text text after `@param`
 */
const readParam = (text: string): Maybe<{ tag: DocParamTag; rest: string }> => {
  let { type, rest } = readType(text);
  const name = /^([\p{L}_][\p{L}\p{N}_]*)\s*/u.exec(rest);
  if (name === null) {
    return undefined;
  }
  rest = rest.slice(name[0].length);
  if (type === undefined) {
    ({ type, rest } = readType(rest));
  }
  return { tag: { name: name[1], type }, rest };
};

/**
 * The text of the doc comment lines above a token: the comments directly
 * above it, each on its own line, with no blank line between
 * @param token first token of the declaration
 */
export const docLines = (token: Token): string[] => {
  const comments = token.leadingComments ?? [];
  const lines: string[] = [];

  let line = token.start.line - 1;
  for (let i = comments.length - 1; i >= 0; i -= 1) {
    const comment = comments[i];
    if (comment.range.start.line !== line || comment.trailing) {
      break;
    }

    // `//` and one space, the rest is Markdown
    lines.unshift(comment.text.replace(/^\/\/ ?/, ''));
    line -= 1;
  }

  // a directive is no documentation
  while (lines.length > 0 && /^\s*#/.test(lines[0])) {
    lines.shift();
  }

  return lines;
};

/**
 * Parse the doc comment above a declaration
 * @param token first token of the declaration
 */
export const parseDocComment = (token: Token): Maybe<DocComment> => {
  const lines = docLines(token);
  if (lines.length === 0) {
    return undefined;
  }

  const description: string[] = [];
  const params: DocParamTag[] = [];
  let returns: Maybe<DocTag>;

  // the lines of the current tag, whose text continues on the lines below
  let current: Maybe<{ tag: DocTag; lines: string[] }>;
  const close = () => {
    if (current !== undefined) {
      current.tag.doc = joinLines(current.lines);
    }
  };

  for (const line of lines) {
    const tag = /^\s*@(\w+)\s*(.*)$/.exec(line);
    if (tag === null) {
      (current?.lines ?? description).push(line);
      continue;
    }

    const [, kind, text] = tag;
    switch (kind.toLowerCase()) {
      case 'param': {
        const param = readParam(text);
        if (param === undefined) {
          (current?.lines ?? description).push(line);
          continue;
        }
        close();
        params.push(param.tag);
        current = { tag: param.tag, lines: [param.rest] };
        break;
      }
      case 'return':
      case 'returns': {
        close();
        const { type, rest } = readType(text);
        returns = { type };
        current = { tag: returns, lines: [rest] };
        break;
      }
      default:
        // an unknown tag is text
        (current?.lines ?? description).push(line);
    }
  }
  close();

  return { doc: joinLines(description), params, returns };
};

/**
 * The tag of a parameter, by name in any case
 * @param comment doc comment of a function
 * @param name name of the parameter
 */
export const paramTag = (
  comment: Maybe<DocComment>,
  name: string,
): Maybe<DocParamTag> => {
  const lookup = name.toLowerCase();
  return comment?.params.find((param) => param.name.toLowerCase() === lookup);
};

/**
 * The first token of a declaration, above which its doc comment is
 * @param scope its scope keywords, if any
 * @param keyword its keyword (`function`, `parameter`)
 */
export const declarationStart = (scope: Maybe<Scope>, keyword: Token): Token => {
  const tokens = [scope?.declare, scope?.scope, keyword].filter(
    (token): token is Token => token !== undefined,
  );
  return tokens.reduce((first, token) =>
    token.start.line < first.start.line ||
    (token.start.line === first.start.line &&
      token.start.character < first.start.character)
      ? token
      : first,
  );
};

/**
 * The documentation of a parameter: the doc comment of its statement
 * (its `@param` tag there, else the description), else the `@param` tag
 * of its function
 * @param statement doc comment of the parameter statement
 * @param fn doc comment of the function
 * @param name name of the parameter
 */
export const parameterTag = (
  statement: Maybe<DocComment>,
  fn: Maybe<DocComment>,
  name: string,
): Maybe<DocTag> => {
  const own = paramTag(statement, name);
  const tag = paramTag(fn, name);
  const doc = own?.doc ?? statement?.doc ?? tag?.doc;
  const type = own?.type ?? tag?.type;
  return doc === undefined && type === undefined ? undefined : { doc, type };
};

/**
 * The documentation of a user function
 * @param comment its doc comment
 * @param parameters its parameters, in order, documented
 */
export const functionDocs = (
  comment: Maybe<DocComment>,
  parameters: Parameter[],
): TypeDocs => {
  const docs: TypeDocs = {};
  if (comment?.doc !== undefined) {
    docs.doc = comment.doc;
  }
  if (comment?.returns?.doc !== undefined) {
    docs.returns = comment.returns.doc;
  }
  if (parameters.length > 0) {
    docs.params = parameters.map((parameter) => ({
      name: parameter.identifier.lexeme,
      doc: parameter.docTag?.doc,
    }));
  }
  return docs;
};
