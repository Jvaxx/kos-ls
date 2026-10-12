/**
 * Type texts of the kOS sources to type expressions of the database
 * (see src/typeChecker/database/typeExpression.ts):
 * - C# types: `ListValue<PartValue>` gives `List<Part>`;
 * - documentation types: ":struct:`List` of :struct:`Part` objects"
 *   gives `List<Part>`, ":struct:`Scalar` (m/s)" gives `Scalar` with the
 *   units `m/s`.
 *
 * Names are resolved by a callback, which knows the structures of the
 * database; a name it does not know is reported, not guessed.
 */

/**
 * Resolve a type name to a kOS structure name
 * @param name name as written, without namespace
 * @returns the kOS name, or undefined if unknown
 */
export type NameResolver = (name: string) => string | undefined;

/**
 * C# primitive types and their kOS structure
 */
const csharpPrimitives: Record<string, string> = {
  int: 'Scalar',
  long: 'Scalar',
  short: 'Scalar',
  float: 'Scalar',
  double: 'Scalar',
  bool: 'Boolean',
  string: 'String',
  object: 'Structure',
};

/**
 * Split `Name<A, B>` into its name and generic arguments, at top level
 * @param text type text
 */
export function splitGeneric(text: string): { name: string; args: string[] } {
  const open = text.indexOf('<');
  if (open === -1 || !text.endsWith('>')) {
    return { name: text.trim(), args: [] };
  }

  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open + 1; i < text.length - 1; i++) {
    const c = text[i];
    if (c === '<') {
      depth++;
    } else if (c === '>') {
      depth--;
    } else if (c === ',' && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(text.slice(start, text.length - 1).trim());
  return { name: text.slice(0, open).trim(), args };
}

/**
 * Type expression of a C# type
 * @param text C# type as written, e.g. `ListValue<PartValue>` or
 * `kOS.Suffixed.TimeStamp`
 * @param resolve kOS name of a C# class name, without namespace
 * @param generics generic parameters in scope (`T`), kept as they are
 * @returns the expression, or undefined with the unknown name
 */
export function csharpType(
  text: string,
  resolve: NameResolver,
  generics: string[] = [],
): { type: string } | { unknown: string } {
  const { name: qualified, args } = splitGeneric(text);
  const name = qualified.split('.').pop()!;

  if (generics.includes(name)) {
    return { type: name };
  }
  if (name in csharpPrimitives) {
    return { type: csharpPrimitives[name] };
  }

  const kos = resolve(qualified) ?? resolve(name);
  if (kos === undefined) {
    // an unknown generic parameter of a method, e.g. `TValue`
    if (/^T[A-Z]?\w*$/.test(name) && args.length === 0 && name.length <= 8) {
      return { type: 'Structure' };
    }
    return { unknown: name };
  }

  // C# collection classes have extra generic parameters (the container
  // type of CollectionValue<T, C>); only the element type is kept
  const kosArgs: string[] = [];
  for (const arg of args.slice(0, 1)) {
    const result = csharpType(arg, resolve, generics);
    if ('unknown' in result) {
      return result;
    }
    kosArgs.push(result.type);
  }

  return { type: kosArgs.length > 0 ? `${kos}<${kosArgs.join(', ')}>` : kos };
}

/**
 * Words of documentation type texts that stand for a structure
 */
const documentationWords: Record<string, string | null> = {
  number: 'Scalar',
  integer: 'Scalar',
  int: 'Scalar',
  float: 'Scalar',
  double: 'Scalar',
  bool: 'Boolean',
  // results of nothing
  none: 'None',
  void: 'None',
  nothing: 'None',
  nonexistent: 'None',
  // unknown
  varies: null,
  any: 'Structure',
};

/**
 * Plural or decorated forms used in the documentation: `strings`,
 * `Parts <Part>`
 * @param word word as written
 * @param resolve name resolver
 */
function documentationName(
  word: string,
  resolve: NameResolver,
): string | undefined {
  const lower = word.toLowerCase();
  if (lower in documentationWords) {
    return documentationWords[lower] ?? undefined;
  }
  return (
    resolve(word) ??
    (lower.endsWith('s') ? resolve(word.slice(0, -1)) : undefined) ??
    (lower.endsWith('es') ? resolve(word.slice(0, -2)) : undefined)
  );
}

/**
 * Units of a documentation type text: `(m/s)`, `(deg)`, `in m/s`
 */
const unitPattern =
  /\(\s*([a-zA-Z%][\w/%^*.·-]*)\s*\)|\bin\s+((?:m\/s|seconds|degrees|meters|kPa|atm))\b/;

/**
 * Units written in the documentation
 */
const knownUnits = new Set([
  'm',
  'km',
  'm/s',
  'm/s^2',
  's',
  'deg',
  'degree',
  'degrees',
  'rad',
  'kN',
  'kNm',
  'kPa',
  'atm',
  'Hz',
  '%',
  'Mg',
  'Mg/s',
  't',
  'kg',
  'K',
  'units/s',
  'u',
  'units',
  'seconds',
  'meters',
  'deg/s',
  'rad/s',
  'g',
  'N',
]);

/**
 * Read a documentation type text
 * @param text type text as written in the documentation
 * @param resolve kOS name of a documented structure name
 * @returns the expression and units when it could be read, and the names
 * that could not be resolved
 */
export function documentationType(
  text: string,
  resolve: NameResolver,
): { type?: string; units?: string; unknown: string[] } {
  const unknown: string[] = [];

  // roles: :struct:`List <list>`, :ref:`string <string>`, `VesselTarget`
  // (also the malformed :struct`X`)
  const roleNames: string[] = [];
  let plain = text
    .replace(
      // a target follows a space (`List <list>`); `List<Scalar>` is a type
      /:\w+(?::\w+)*:?`~?([^`]*?)(?:\s+<([^>]+)>)?`/g,
      (_, display: string, target?: string) => {
        // the target names the structure (:struct:`Parts <Part>`), except
        // :ref: labels which are lower case
        const name =
          target !== undefined && /^[A-Z]/.test(target) ? target : display;
        roleNames.push(name.replace(/<.*$/, ''));
        return name;
      },
    )
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*[^*]*\*\*/g, '')
    .trim();

  // prose before the first structure: "A position Vector", "Action
  // Group, Boolean"
  const firstWord = /^(\w+)/.exec(plain)?.[1];
  if (
    roleNames.length > 0 &&
    !plain.startsWith('(') &&
    (firstWord === undefined ||
      documentationName(firstWord, resolve) === undefined)
  ) {
    const first = roleNames
      .map((name) =>
        plain.search(new RegExp(`\\b${name.replace(/\W/g, '')}\\b`)),
      )
      .filter((i) => i >= 0);
    if (first.length > 0) {
      plain = plain.slice(Math.min(...first));
    }
  }

  let units: string | undefined;
  const unit = unitPattern.exec(plain);
  if (unit !== null) {
    const value = unit[1] ?? unit[2];
    if (knownUnits.has(value) || value.includes('/')) {
      units =
        { seconds: 's', degrees: 'deg', degree: 'deg', meters: 'm' }[value] ??
        value;
    }
  }

  // explanations after the type: "Scalar. range = [0,1]", "Style - the
  // copy", "Boolean) true if..."
  plain = plain
    .replace(/^\(([^)]*)\).*$/, '$1')
    .replace(/\s+-\s.*$/, '')
    .replace(/\.\s.*$/, '')
    .replace(/\.$/, '')
    .replace(/\([^)]*\)/g, '')
    .trim();

  const parseOne = (part: string): string | undefined => {
    // `List<Scalar>`, `List(Widget)`
    const generic = /^(\w+)\s*[<(]\s*(?:of\s+)?(\w+)\s*[>)]/.exec(part);
    // `List of Part objects`, `Lexicon of ConsumedResource`
    const of = /^(\w+)\s+(?:of|containing)\s+(?:any\s+)?(\w+)/i.exec(part);
    const words = /^(\w+)/.exec(part);
    if (generic !== null || of !== null) {
      const [, outer, inner] = (generic ?? of)!;
      const container = documentationName(outer, resolve);
      const element = documentationName(inner, resolve);
      if (container === undefined) {
        if (/^[A-Z]/.test(outer)) {
          unknown.push(outer);
        }
        return undefined;
      }
      if (element === undefined) {
        // "TimeSpan of the time": prose, not an element type
        if (/^[A-Z]/.test(inner)) {
          unknown.push(inner);
        }
        return container;
      }
      return `${container}<${element}>`;
    }
    if (words === null) {
      return undefined;
    }
    const name = documentationName(words[1], resolve);
    // lower case words are prose ("cosine of the angle"), not names
    if (
      name === undefined &&
      /^[A-Z]/.test(words[1]) &&
      !(words[1].toLowerCase() in documentationWords)
    ) {
      unknown.push(words[1]);
    }
    return name;
  };

  // `Vessel or Boolean`, `DockingPort, or the String "None" if...`
  const parts = plain
    .split(/\s*,?\s+or\s+(?:the\s+)?|\s*\|\s*/)
    .map((part) => part.trim())
    .filter((part) => part !== '');

  const types: string[] = [];
  for (const part of parts) {
    const type = parseOne(part);
    if (type === undefined) {
      return { units, unknown };
    }
    if (!types.includes(type)) {
      types.push(type);
    }
  }

  return {
    type: types.length > 0 ? types.join(' | ') : undefined,
    units,
    unknown,
  };
}
