/**
 * Type expressions of the kOS database: `Scalar`, `List<Part>`,
 * `Lexicon<String, Structure>`, `String | Path`.
 */
export type TypeExpression =
  | { kind: 'name'; name: string; args: TypeExpression[] }
  | { kind: 'union'; types: TypeExpression[] };

/**
 * Parse a type expression
 * @param text expression text
 * @throws on malformed expressions
 */
export function parseType(text: string): TypeExpression {
  const tokens = text.match(/[A-Za-z_][\w]*|[<>,|]/g) ?? [];
  let i = 0;

  const union = (): TypeExpression => {
    const types = [term()];
    while (tokens[i] === '|') {
      i++;
      types.push(term());
    }
    return types.length === 1 ? types[0] : { kind: 'union', types };
  };

  const term = (): TypeExpression => {
    const name = tokens[i++];
    if (name === undefined || !/^[A-Za-z_]/.test(name)) {
      throw new Error(`Malformed type expression: ${text}`);
    }
    const args: TypeExpression[] = [];
    if (tokens[i] === '<') {
      i++;
      args.push(union());
      while (tokens[i] === ',') {
        i++;
        args.push(union());
      }
      if (tokens[i++] !== '>') {
        throw new Error(`Malformed type expression: ${text}`);
      }
    }
    return { kind: 'name', name, args };
  };

  const result = union();
  if (i !== tokens.length) {
    throw new Error(`Malformed type expression: ${text}`);
  }
  return result;
}

/**
 * Write a type expression
 * @param type parsed expression
 */
export function formatType(type: TypeExpression): string {
  if (type.kind === 'union') {
    return type.types.map(formatType).join(' | ');
  }
  return type.args.length === 0
    ? type.name
    : `${type.name}<${type.args.map(formatType).join(', ')}>`;
}

/**
 * Rename the type names of an expression
 * @param type parsed expression
 * @param rename new name of a name
 */
export function mapNames(
  type: TypeExpression,
  rename: (name: string) => string,
): TypeExpression {
  if (type.kind === 'union') {
    return { kind: 'union', types: type.types.map((t) => mapNames(t, rename)) };
  }
  return {
    kind: 'name',
    name: rename(type.name),
    args: type.args.map((t) => mapNames(t, rename)),
  };
}
