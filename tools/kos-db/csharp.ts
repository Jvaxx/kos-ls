/**
 * Extraction of the kOS script model from the kOS C# sources: types
 * (classes with a KOSNomenclature attribute), their suffixes (AddSuffix
 * calls), builtin functions (Function attributes), bound variables
 * (AddGetter / AddSetter calls) and addons (kOSAddon attributes).
 *
 * This is a light static analysis, not a compiler: it relies on the
 * regular way kOS registers these, and reports what it cannot read
 * (e.g. suffix names computed at runtime) instead of guessing.
 */

/**
 * A C# class, possibly one part of a partial class
 */
export interface CsClass {
  name: string;
  /** generic parameters, e.g. `['T']` for `ListValue<T>` */
  generics: string[];
  /** base class as written, e.g. `CollectionValue<T, List<T>>` */
  base?: string;
  /** kOS names from KOSNomenclature attributes, in order */
  kosNames: KosName[];
  /** id from a kOSAddon attribute */
  addon?: string;
  /** names from a Function attribute */
  functionNames?: string[];
  /**
   * for a function: the number of arguments it pops, whether the count
   * varies (it calls CountRemainingArgs) and whether it returns a value
   */
  functionShape?: { pops: number; variable: boolean; returns: boolean };
  /** whether the class has a Binding attribute */
  binding: boolean;
  suffixes: CsSuffix[];
  /** names given to AddGetter / AddSetter calls in the class */
  getters: CsBinding[];
  /** enclosing namespace, e.g. `kOS.Suffixed` */
  namespace: string;
  /** namespaces imported by the file's using directives */
  usings: string[];
  file: string;
  line: number;
}

export interface KosName {
  name: string;
  /** false when the name is only an alias for the kOS to C# direction */
  csharpToKos: boolean;
}

/**
 * A suffix registration
 */
export interface CsSuffix {
  /** suffix names, upper case as written; undefined when computed */
  names?: string[];
  /** suffix class, e.g. `OneArgsSuffix` */
  kind: string;
  /** its generic arguments as written, e.g. `['ListValue', 'StringValue']` */
  generics: string[];
  /** the class the suffix is added to, for AddGlobalSuffix<T> */
  owner?: string;
  /** description passed to the suffix constructor, when a literal */
  description?: string;
  file: string;
  line: number;
}

/**
 * A bound variable registration
 */
export interface CsBinding {
  /** names, upper case as written; undefined when computed */
  names?: string[];
  setter: boolean;
  file: string;
  line: number;
}

/**
 * Replace comments with spaces, keeping offsets and line breaks, so that
 * commented code is ignored and positions stay valid
 * @param source C# source
 */
export function stripComments(source: string): string {
  const out = source.split('');
  let i = 0;

  const blank = (from: number, to: number) => {
    for (let j = from; j < to; j++) {
      if (out[j] !== '\n') {
        out[j] = ' ';
      }
    }
  };

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === '/' && next === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'" || (c === '@' && next === '"')) {
      i = skipString(source, i);
    } else {
      i++;
    }
  }

  return out.join('');
}

/**
 * Index after a string or character literal starting at i
 * @param source C# source
 * @param i index of the opening quote (or of `@` for verbatim strings)
 */
function skipString(source: string, i: number): number {
  if (source[i] === '@') {
    // verbatim string: "" is an escaped quote
    i += 2;
    while (i < source.length) {
      if (source[i] === '"') {
        if (source[i + 1] === '"') {
          i += 2;
          continue;
        }
        return i + 1;
      }
      i++;
    }
    return i;
  }

  const quote = source[i];
  i++;
  while (i < source.length && source[i] !== quote && source[i] !== '\n') {
    i += source[i] === '\\' ? 2 : 1;
  }
  return i + 1;
}

/**
 * Index of the bracket closing the one at `open`, skipping strings
 * @param source comment-free source
 * @param open index of an opening bracket: ( [ { or <
 */
export function matchBracket(source: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}', '<': '>' };
  const opener = source[open];
  const closer = pairs[opener];
  let depth = 0;

  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '"' || c === "'" || (c === '@' && source[i + 1] === '"')) {
      i = skipString(source, i) - 1;
    } else if (c === opener) {
      depth++;
    } else if (c === closer) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

/**
 * Split a list at top level commas, outside brackets and strings
 * @param text list text, without its enclosing brackets
 */
export function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  // generic brackets: `<` right after an identifier (`List<T>`), as
  // opposed to comparisons (`a < b`)
  let angles = 0;
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || (c === '@' && text[i + 1] === '"')) {
      i = skipString(text, i) - 1;
    } else if ('([{'.includes(c)) {
      depth++;
    } else if (')]}'.includes(c)) {
      depth--;
    } else if (c === '<' && /\w/.test(text[i - 1] ?? '')) {
      angles++;
    } else if (c === '>' && angles > 0) {
      angles--;
    } else if (c === ',' && depth === 0 && angles === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }

  const last = text.slice(start).trim();
  if (last !== '' || parts.length > 0) {
    parts.push(last);
  }
  return parts;
}

/**
 * The value of a C# string literal, or undefined if not a plain literal
 * @param text expression text
 */
export function stringLiteral(text: string): string | undefined {
  const match = /^"((?:[^"\\]|\\.)*)"$/.exec(text.trim());
  return match === null ? undefined : match[1].replace(/\\(.)/g, '$1');
}

/**
 * Names in a registration's first argument: a string literal or an array
 * of string literals
 * @param text argument text
 */
export function parseNames(text: string): string[] | undefined {
  const single = stringLiteral(text);
  if (single !== undefined) {
    return [single];
  }

  const array = /^new\s*(?:string\s*)?\[\s*\]\s*\{([\s\S]*)\}$/.exec(text.trim());
  if (array === null) {
    return undefined;
  }

  const names = splitTopLevel(array[1]).filter((part) => part !== '');
  const literals = names.map(stringLiteral);
  return literals.every((name): name is string => name !== undefined)
    ? literals
    : undefined;
}

/**
 * Parse `new Name<A, B<C>>(args)` into its class, generic arguments and
 * arguments
 * @param text expression text
 */
export function parseConstruction(
  text: string,
): { kind: string; generics: string[]; args: string[] } | undefined {
  const trimmed = text.trim();
  const head = /^new\s+([\w.]+)\s*/.exec(trimmed);
  if (head === null) {
    return undefined;
  }

  let i = head[0].length;
  let generics: string[] = [];
  if (trimmed[i] === '<') {
    const close = matchBracket(trimmed, i);
    if (close === -1) {
      return undefined;
    }
    generics = splitTopLevel(trimmed.slice(i + 1, close));
    i = close + 1;
    while (/\s/.test(trimmed[i] ?? '')) {
      i++;
    }
  }

  if (trimmed[i] !== '(') {
    return undefined;
  }
  const close = matchBracket(trimmed, i);
  const args = close === -1 ? [] : splitTopLevel(trimmed.slice(i + 1, close));

  const kind = head[1].split('.').pop()!;
  return { kind, generics, args };
}

const lineAt = (source: string, index: number) =>
  source.slice(0, index).split('\n').length;

const classPattern =
  /((?:\[[^\[\]]*(?:\[[^\[\]]*\][^\[\]]*)*\]\s*)*)((?:(?:public|internal|private|protected|abstract|sealed|static|partial|new)\s+)*)class\s+(\w+)\s*(<[^>{]*>)?\s*(?::\s*([^{]+?))?\s*(?:where\s[^{]*)?\{/g;

/**
 * Extract the classes of one C# file
 * @param source C# source
 * @param file file path, for references
 */
export function extractClasses(source: string, file: string): CsClass[] {
  const code = stripComments(source);
  const found: { cls: CsClass; start: number; end: number }[] = [];

  const usings = [...code.matchAll(/^\s*using\s+([\w.]+)\s*;/gm)].map((m) => m[1]);
  const namespaces: { name: string; start: number; end: number }[] = [];
  for (const match of code.matchAll(/\bnamespace\s+([\w.]+)\s*([{;])/g)) {
    const open = match.index! + match[0].length - 1;
    namespaces.push({
      name: match[1],
      start: open,
      end: match[2] === ';' ? code.length : matchBracket(code, open),
    });
  }
  const namespaceAt = (index: number) =>
    namespaces
      .filter((ns) => ns.start < index && index < ns.end)
      .map((ns) => ns.name)
      .join('.');

  for (const match of code.matchAll(classPattern)) {
    const [whole, attributes, , name, generics, base] = match;
    const open = match.index! + whole.length - 1;
    const end = matchBracket(code, open);

    const kosNames: KosName[] = [];
    for (const nomenclature of attributes.matchAll(
      /KOSNomenclature\s*\(\s*"([^"]+)"([^)]*)\)/g,
    )) {
      kosNames.push({
        name: nomenclature[1],
        csharpToKos: !/CSharpToKOS\s*=\s*false/.test(nomenclature[2]),
      });
    }

    const addon = /kOSAddon\s*\(\s*"([^"]+)"\s*\)/.exec(attributes)?.[1];
    const functionAttribute = /\bFunction\s*\(([^)]*)\)/.exec(attributes);
    const functionNames = functionAttribute
      ? splitTopLevel(functionAttribute[1])
          .map(stringLiteral)
          .filter((n): n is string => n !== undefined)
      : undefined;

    const body = code.slice(open, end === -1 ? code.length : end);
    const functionShape = functionAttribute
      ? {
          pops: (body.match(/\bPop(?:Value|Structure)\w*\s*\(/g) ?? []).length,
          variable: /\bCountRemainingArgs\s*\(/.test(body),
          returns: /\bReturnValue\s*=/.test(body),
        }
      : undefined;

    found.push({
      cls: {
        name,
        generics: generics
          ? splitTopLevel(generics.slice(1, -1)).map((g) => g.trim())
          : [],
        base: base?.trim() ? splitTopLevel(base.trim())[0] : undefined,
        kosNames,
        addon,
        functionNames,
        functionShape,
        binding: /\bBinding\s*\(/.test(attributes),
        suffixes: [],
        getters: [],
        namespace: namespaceAt(match.index!),
        usings,
        file,
        line: lineAt(code, match.index! + attributes.length),
      },
      start: open,
      end: end === -1 ? code.length : end,
    });
  }

  // a registration belongs to the innermost class around it
  const owner = (index: number) => {
    let best: (typeof found)[number] | undefined;
    for (const entry of found) {
      if (entry.start < index && index < entry.end) {
        if (best === undefined || entry.start > best.start) {
          best = entry;
        }
      }
    }
    return best?.cls;
  };

  for (const call of code.matchAll(
    /\b(AddSuffix|AddGlobalSuffix\s*<\s*(\w+)\s*>)\s*\(/g,
  )) {
    const open = call.index! + call[0].length - 1;
    const close = matchBracket(code, open);
    const cls = owner(call.index!);
    if (close === -1 || cls === undefined) {
      continue;
    }

    const args = splitTopLevel(code.slice(open + 1, close));
    // the declarations of AddSuffix itself have typed parameters
    if (args.length < 2 || /^(string|IEnumerable)/.test(args[0])) {
      continue;
    }

    const construction = parseConstruction(args[1]);
    if (construction === undefined) {
      continue;
    }

    const description = construction.args
      .map(stringLiteral)
      .filter((d): d is string => d !== undefined)
      .pop();

    cls.suffixes.push({
      names: parseNames(args[0]),
      kind: construction.kind,
      generics: construction.generics,
      owner: call[2],
      description,
      file,
      line: lineAt(code, call.index!),
    });
  }

  // config keys: new ConfigKey(property, NAME, description, default,
  // min, max, typeof(type)) are settable suffixes of the Config
  for (const call of code.matchAll(/\bnew\s+ConfigKey\s*\(/g)) {
    const open = call.index! + call[0].length - 1;
    const close = matchBracket(code, open);
    const cls = owner(call.index!);
    if (close === -1 || cls === undefined) {
      continue;
    }
    const args = splitTopLevel(code.slice(open + 1, close));
    const name = args[1] && stringLiteral(args[1]);
    const type = /^typeof\s*\(\s*([\w.]+)\s*\)$/.exec(args[6] ?? '')?.[1];
    // keys also registered with AddSuffix keep that registration
    const registered = cls.suffixes.some((suffix) =>
      suffix.names?.some((n) => n.toUpperCase() === name?.toUpperCase()),
    );
    if (name === undefined || type === undefined || registered) {
      continue;
    }
    cls.suffixes.push({
      names: [name],
      kind: 'SetSuffix',
      generics: [type],
      description: args[2] && stringLiteral(args[2]),
      file,
      line: lineAt(code, call.index!),
    });
  }

  for (const call of code.matchAll(
    /\b(AddGetter|AddSetter|AddBoundVariable)\s*\(/g,
  )) {
    const open = call.index! + call[0].length - 1;
    const close = matchBracket(code, open);
    const cls = owner(call.index!);
    if (close === -1 || cls === undefined) {
      continue;
    }

    const args = splitTopLevel(code.slice(open + 1, close));
    if (args.length < 2 || /^(string|IEnumerable)/.test(args[0])) {
      continue;
    }

    const names = parseNames(args[0]);
    const line = lineAt(code, call.index!);
    // AddBoundVariable(name, getter, setter) registers both
    const setters =
      call[1] === 'AddBoundVariable'
        ? [
            ...(args[1] !== 'null' ? [false] : []),
            ...(args[2] !== undefined && args[2] !== 'null' ? [true] : []),
          ]
        : [call[1] === 'AddSetter'];
    for (const setter of setters) {
      cls.getters.push({ names, setter, file, line });
    }
  }

  return found.map((entry) => entry.cls);
}
