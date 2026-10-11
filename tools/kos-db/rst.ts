/**
 * Extraction of the kOS documentation (Sphinx sources, with kOS's `ks`
 * domain): structures, their attributes and methods, functions and
 * globals (bound variables), with their documentation in Markdown, type
 * text, access, parameters and anchors.
 *
 * Types are kept as written (e.g. ":struct:`List` of :struct:`Part`");
 * types.ts reads them.
 */
import {
  dedent,
  rstToMarkdown,
  simpleTableBorder,
  simpleTableEnd,
} from './markdown';

export interface RstParameter {
  name: string;
  optional: boolean;
  variadic: boolean;
  /** type text, from `:type name:` or a leading `(type)` */
  type?: string;
  /** description in Markdown */
  doc?: string;
}

export interface RstEntry {
  /** name as written, without structure prefix or parameters */
  name: string;
  /** directive: structure, attribute, method, function, global */
  kind: string;
  /** documentation in Markdown */
  doc: string;
  /** page and anchor, relative to the documentation root */
  url: string;
  /** value type (attributes, globals) or result type text */
  type?: string;
  /** result type text of methods and functions */
  returns?: string;
  /** access text, e.g. `Get/Set` */
  access?: string;
  /** parameters, for methods and functions */
  params?: RstParameter[];
  file: string;
  line: number;
}

export interface RstStructure extends RstEntry {
  /** structure named in "All suffixes of :struct:`X`" */
  inherits?: string;
  /** members by upper case name */
  members: Map<string, RstEntry>;
  /** members described only in the members table, by upper case name */
  tableRows: Map<string, { type?: string; access?: string; doc?: string }>;
}

export interface RstModel {
  /** by upper case name */
  structures: Map<string, RstStructure>;
  /** by upper case name; several entries for overloads */
  functions: Map<string, RstEntry[]>;
  /** by upper case name */
  globals: Map<string, RstEntry>;
}

const indentOf = (line: string) => /^ */.exec(line)![0].length;
const isBlank = (line: string) => line.trim() === '';

/**
 * Parse a directive signature: `[Struct:]NAME[(params)]`, tolerating the
 * irregularities of the documentation (spaces before the parentheses,
 * trailing text, `[, optional]` and `name...` parameters)
 * @param signature directive argument
 */
export function parseSignature(signature: string): {
  prefix?: string;
  name: string;
  params?: RstParameter[];
} {
  const match = /^\s*(?:([\w]+):)?([\w]+)\s*(?:\(([^)]*)\))?/.exec(signature);
  if (match === null) {
    return { name: signature.trim() };
  }

  const [, prefix, name, paramText] = match;
  if (paramText === undefined) {
    return { prefix, name };
  }

  const params: RstParameter[] = [];
  let optional = false;
  for (const part of paramText.split(',')) {
    // `[` before the name makes it optional, after it the next ones
    if (/^\s*\[/.test(part)) {
      optional = true;
    }
    const raw = part.replace(/[\[\]]/g, '').trim();
    const opensNext = /\w[^\w]*\[\s*$/.test(part);
    if (raw === '') {
      optional ||= part.includes('[');
      continue;
    }
    const variadic = raw.endsWith('...');
    const paramName = raw.replace(/\.\.\.$/, '').replace(/=.*$/, '').trim();
    params.push({ name: paramName, optional: optional || /=/.test(raw), variadic });
    optional ||= opensNext;
  }
  return { prefix, name, params };
}

/**
 * The directive blocks of a file, nested ones included, with the
 * structure each member belongs to
 * @param text RST source
 * @param file path relative to the documentation root
 */
export function parseRst(text: string, file: string, model: RstModel): void {
  const lines = text.split('\n');
  const page = file.replace(/\.rst$/, '.html');
  let current: RstStructure | undefined;

  for (let i = 0; i < lines.length; i++) {
    const directive =
      /^(\s*)\.\.\s+(structure|attribute|method|function|global|object)::\s*(.*)$/.exec(
        lines[i],
      );
    if (directive === null) {
      continue;
    }

    const [, indentText, kind, signature] = directive;
    const indent = indentText.length;

    // content: following lines indented more than the directive
    let end = i + 1;
    let last = i + 1;
    while (end < lines.length) {
      if (isBlank(lines[end])) {
        end++;
        continue;
      }
      if (indentOf(lines[end]) <= indent) {
        break;
      }
      end++;
      last = end;
    }
    const content = dedent(lines.slice(i + 1, last));

    // nested member directives are read by this loop on their own
    const own: string[] = [];
    for (let j = 0; j < content.length; j++) {
      if (/^\.\.\s+(attribute|method)::/.test(content[j])) {
        break;
      }
      own.push(content[j]);
    }

    const { fields, body } = splitFields(own);

    // `.. object:: SHIP:CONTROL:YAW`, under a label `.. _SHIP CONTROL YAW:`:
    // a member of the structure at that path, or a global
    if (kind === 'object') {
      // `LOCK THROTTLE TO expression.` documents the bound variable
      const path =
        /^LOCK\s+(\w+)\s+TO\b/i.exec(signature)?.[1] ??
        /^([\w:]+)\s*$/.exec(signature)?.[1];
      if (path === undefined) {
        continue;
      }
      const segments = path.split(':');
      const objectName = segments.pop()!;
      const label = /^\.\.\s+_([^:]+):\s*$/.exec(lines[i - 1] ?? '')?.[1];
      const entry: RstEntry = {
        name: objectName,
        kind: segments.length > 0 ? 'attribute' : 'global',
        doc: rstToMarkdown(body),
        url: `${page}#${sectionId(label ?? path)}`,
        file,
        line: i + 1,
      };
      const objectUpper = objectName.toUpperCase();
      if (segments.length > 0) {
        const owner = structureFor(model, segments.join(':'), page);
        if (!owner.members.has(objectUpper)) {
          owner.members.set(objectUpper, entry);
        }
      } else if (!model.globals.has(objectUpper)) {
        model.globals.set(objectUpper, entry);
      }
      continue;
    }

    const { prefix, name, params } = parseSignature(signature);
    const upper = name.toUpperCase();

    const entry: RstEntry = {
      name,
      kind,
      doc: '',
      url: '',
      file,
      line: i + 1,
    };

    if (kind === 'structure') {
      const structure: RstStructure = {
        ...entry,
        url: `${page}#structure:${upper}`,
        members: new Map(),
        tableRows: new Map(),
      };
      readMembersTable(body, structure);
      // a members table can follow an empty directive (Control)
      if (content.every(isBlank)) {
        const after: string[] = [];
        for (let j = i + 1; j < lines.length; j++) {
          if (/^\.\.\s+(structure|attribute|method|function|global|object)::/.test(lines[j])) {
            break;
          }
          if (j + 1 < lines.length && /^([=\-~^"'`#*+])\1{2,}\s*$/.test(lines[j + 1]) && !isBlank(lines[j])) {
            break;
          }
          after.push(lines[j]);
        }
        readMembersTable(after, structure);
      }
      structure.doc = rstToMarkdown(withoutTables(body));
      if (structure.doc === '') {
        structure.doc = rstToMarkdown(precedingProse(lines, i));
      }
      if (structure.doc === '') {
        structure.doc = rstToMarkdown(pageIntroduction(lines));
      }
      model.structures.set(upper, mergeStructure(model.structures.get(upper), structure));
      current = model.structures.get(upper);
      continue;
    }

    entry.doc = rstToMarkdown(body);
    entry.access = fields.get('access')?.text;
    applyFields(entry, kind, fields, params);

    if (kind === 'global' && prefix !== undefined) {
      // `.. global:: Constant:G` documents a member of a structure
      const owner = structureFor(model, prefix, page);
      entry.kind = 'attribute';
      entry.url = `${page}#global:${prefix.toUpperCase()}:${upper}`;
      if (!owner.members.has(upper)) {
        owner.members.set(upper, entry);
      }
    } else if (kind === 'attribute' || kind === 'method') {
      // a prefix names the structure, else the enclosing structure does
      const owner = prefix !== undefined ? structureFor(model, prefix, page) : current;
      if (owner === undefined) {
        continue;
      }
      entry.url = `${page}#${kind}:${owner.name.toUpperCase()}:${upper}`;
      if (!owner.members.has(upper)) {
        owner.members.set(upper, entry);
      }
    } else if (kind === 'function') {
      entry.url = `${page}#function:${upper}`;
      model.functions.set(upper, [...(model.functions.get(upper) ?? []), entry]);
    } else {
      entry.url = `${page}#global:${upper}`;
      if (!model.globals.has(upper)) {
        model.globals.set(upper, entry);
      }
    }
  }
}

/**
 * Sphinx's id of a section title: lower case, other characters as dashes
 * @param title section title
 */
export function sectionId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Read the functions documented as sections, titled with their
 * signature (`OPEN(PATH)` underlined), which the function directives do
 * not cover. Read after the directives of all files.
 * @param text RST source
 * @param file path relative to the documentation root
 */
export function parseRstSections(
  text: string,
  file: string,
  model: RstModel,
  options: { globals?: boolean } = {},
): void {
  const lines = text.split('\n');
  const page = file.replace(/\.rst$/, '.html');
  const underline = /^([=\-~^"'`#*+])\1{2,}\s*$/;

  if (options.globals) {
    readBindings(lines, page, file, model);
  }

  for (let i = 0; i + 1 < lines.length; i++) {
    const title = /^(\w+)\(([^()]*)\)\s*$/.exec(lines[i]);
    if (title === null || !underline.test(lines[i + 1])) {
      continue;
    }
    const upper = title[1].toUpperCase();
    if (model.functions.has(upper)) {
      continue;
    }

    // the section: up to the next title
    let end = i + 2;
    while (end < lines.length && !(end + 1 < lines.length && underline.test(lines[end + 1]) && lines[end].trim() !== '')) {
      end++;
    }

    const { params } = parseSignature(lines[i]);
    model.functions.set(upper, [
      {
        name: title[1],
        kind: 'function',
        doc: rstToMarkdown(lines.slice(i + 2, end)),
        url: `${page}#${sectionId(lines[i])}`,
        params,
        file,
        line: i + 1,
      },
    ]);
  }
}

/**
 * Create an empty model
 */
export function emptyModel(): RstModel {
  return { structures: new Map(), functions: new Map(), globals: new Map() };
}

interface Field {
  /** argument, e.g. the parameter name of `:parameter name:` */
  argument?: string;
  text: string;
}

/**
 * Split the field list (`:type: ...`, `:parameter x: ...`) from the body
 * of a directive
 * @param content dedented directive content
 */
function splitFields(content: string[]): { fields: FieldMap; body: string[] } {
  const all: [string, Field][] = [];
  const body: string[] = [];

  for (let i = 0; i < content.length; i++) {
    const field = /^:(\w+)(?:\s+([^:]+?))?:\s*(.*)$/.exec(content[i]);
    if (field === null) {
      body.push(content[i]);
      continue;
    }

    const [, name, argument, first] = field;
    const text = [first];
    while (
      i + 1 < content.length &&
      indentOf(content[i + 1]) > 0 &&
      !isBlank(content[i + 1])
    ) {
      text.push(content[++i].trim());
    }

    all.push([
      name.toLowerCase(),
      { argument: argument?.trim(), text: text.join(' ').trim() },
    ]);
  }

  return { fields: new FieldMap(all), body };
}

/**
 * The fields of a directive: by name for the fields without argument,
 * and all of them in order
 */
class FieldMap extends Map<string, Field> {
  constructor(public readonly all: [string, Field][]) {
    super();
    for (const [name, value] of all) {
      if (!this.has(name) && value.argument === undefined) {
        this.set(name, value);
      }
    }
  }
}

/**
 * Read type, result and parameters from the fields of a member or
 * function directive
 */
function applyFields(
  entry: RstEntry,
  kind: string,
  fields: FieldMap,
  signatureParams?: RstParameter[],
): void {
  const { all } = fields;
  const params = (signatureParams ?? []).map((p) => ({ ...p }));
  const param = (name: string) => {
    let found = params.find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (found === undefined) {
      found = { name, optional: false, variadic: false };
      params.push(found);
    }
    return found;
  };

  for (const [name, value] of all) {
    switch (name) {
      case 'parameter':
      case 'param':
      case 'arg':
      case 'argument':
        if (value.argument !== undefined) {
          const target = param(value.argument);
          const typed = /^\(([^)]*)\)\s*([\s\S]*)$/.exec(value.text);
          if (typed !== null) {
            target.type = typed[1];
            target.doc = rstToMarkdown([typed[2]]) || undefined;
          } else {
            target.doc = rstToMarkdown([value.text]) || undefined;
          }
        }
        break;
      case 'type':
      case 'paramtype':
      case 'parametertype':
        if (value.argument !== undefined) {
          param(value.argument).type = value.text;
        } else if (kind === 'method' || kind === 'function') {
          entry.returns ??= value.text;
        } else {
          entry.type = value.text;
        }
        break;
      case 'return':
      case 'returns':
      case 'rtype':
        entry.returns ??= value.text;
        break;
    }
  }

  if (kind === 'method' || kind === 'function') {
    entry.params = params;
  }
}

/**
 * The structure a prefixed member belongs to, created if documented
 * before its structure directive
 */
function structureFor(model: RstModel, name: string, page: string): RstStructure {
  const upper = name.toUpperCase();
  let structure = model.structures.get(upper);
  if (structure === undefined) {
    structure = {
      name,
      kind: 'structure',
      doc: '',
      url: `${page}#structure:${upper}`,
      file: page,
      line: 0,
      members: new Map(),
      tableRows: new Map(),
    };
    model.structures.set(upper, structure);
  }
  return structure;
}

/**
 * Merge a structure documented in several places
 */
function mergeStructure(
  previous: RstStructure | undefined,
  next: RstStructure,
): RstStructure {
  if (previous === undefined) {
    return next;
  }
  for (const [name, member] of next.members) {
    if (!previous.members.has(name)) {
      previous.members.set(name, member);
    }
  }
  for (const [name, row] of next.tableRows) {
    if (!previous.tableRows.has(name)) {
      previous.tableRows.set(name, row);
    }
  }
  if (previous.doc === '') {
    previous.doc = next.doc;
    previous.url = next.url;
    previous.file = next.file;
    previous.line = next.line;
  }
  previous.inherits ??= next.inherits;
  return previous;
}

/**
 * Read the members list-table of a structure: inheritance and rows
 */
function readMembersTable(body: string[], structure: RstStructure): void {
  const text = body.join('\n');

  const inherits = /(?:All|Every)\s+suffix(?:es)?\s+of\s+:struct:`~?([\w]+)`/i.exec(text);
  if (inherits !== null) {
    structure.inherits = inherits[1];
  }

  // rows: `* - :attr:`NAME`` then `- type`, `- access`, `- description`,
  // in the order of the header row when there is one
  const rows = text.split(/\n\s*\* - /).slice(1);
  const split = (row: string) =>
    row.split(/\n\s*- ?/).map((cell) => cell.replace(/\s+/g, ' ').trim());

  let columns = { type: 1, access: -1, doc: 2 };
  const header = rows.length > 0 ? split(rows[0]) : [];
  if (/^suffix|^name|^member/i.test(header[0] ?? '')) {
    const find = (pattern: RegExp) => header.findIndex((cell, i) => i > 0 && pattern.test(cell));
    columns = {
      type: find(/type/i),
      access: find(/get|set|access/i),
      doc: find(/description/i),
    };
  } else if (rows.length > 0 && split(rows[0]).length >= 4) {
    columns = { type: 1, access: 2, doc: 3 };
  }

  for (const row of rows) {
    const cells = split(row);
    const name =
      /:(?:attr|meth|ref):`(?:[\w]+:)?([\w]+)(?:\([^`]*\))?(?:\s+<[^>]*>)?`/.exec(cells[0]) ??
      /^:([A-Za-z]\w*)\b/.exec(cells[0]);
    if (name === null) {
      continue;
    }
    const cell = (index: number) => (index > 0 ? cells[index] || undefined : undefined);
    structure.tableRows.set(name[1].toUpperCase(), {
      type: cell(columns.type),
      access: cell(columns.access),
      doc: cell(columns.doc),
    });
  }
}

/**
 * Lines without list-table directives
 */
function withoutTables(body: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < body.length; i++) {
    if (simpleTableBorder.test(body[i].trim())) {
      i = simpleTableEnd(body.map((l) => l.trim()), i) - 1;
      continue;
    }
    if (/^\s*\.\.\s+(list-table|table)::/.test(body[i])) {
      const indent = indentOf(body[i]);
      i++;
      while (i < body.length && (isBlank(body[i]) || indentOf(body[i]) > indent)) {
        i++;
      }
      i--;
      continue;
    }
    out.push(body[i]);
  }
  return out;
}

/**
 * The prose paragraphs before a directive, back to the section heading
 */
function precedingProse(lines: string[], index: number): string[] {
  const prose: string[] = [];
  for (let i = index - 1; i >= 0; i--) {
    // a heading underline: ===, ---, ~~~ under a title
    if (/^([=\-~^"'`#*+])\1{2,}\s*$/.test(lines[i])) {
      prose.splice(0, 1);
      break;
    }
    if (/^\.\.\s/.test(lines[i]) && indentOf(lines[i]) === 0 && !/^\.\.\s+_/.test(lines[i])) {
      break;
    }
    prose.unshift(lines[i]);
  }
  return prose.filter((line) => !/^\.\.\s+_[\w\s-]+:\s*$/.test(line));
}

/**
 * The introduction of a page: the text between its title and the next
 * heading
 */
function pageIntroduction(lines: string[]): string[] {
  const underline = /^([=\-~^"'`#*+])\1{2,}\s*$/;
  const title = lines.findIndex(
    (line, i) => i > 0 && underline.test(line) && lines[i - 1].trim() !== '',
  );
  if (title === -1) {
    return [];
  }
  const intro: string[] = [];
  for (let i = title + 1; i < lines.length; i++) {
    if (i + 1 < lines.length && underline.test(lines[i + 1]) && lines[i].trim() !== '') {
      break;
    }
    if (/^\.\.\s+(structure|attribute|method|function|global)::/.test(lines[i])) {
      break;
    }
    intro.push(lines[i]);
  }
  return intro;
}

/**
 * Read the bound variables of the bindings page: bullet blocks
 * (`- **Variable name**: SHIP`, `- **Description**: ...`) and sections
 * titled with the variable name (`Core`, `ALT ALIAS`)
 */
function readBindings(lines: string[], page: string, file: string, model: RstModel): void {
  const underline = /^([=\-~^"'`#*+])\1{2,}\s*$/;
  const add = (name: string, entry: Omit<RstEntry, 'name' | 'kind' | 'file'>) => {
    const upper = name.toUpperCase();
    if (!model.globals.has(upper)) {
      model.globals.set(upper, { name, kind: 'global', file, ...entry });
    }
  };

  let label: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const target = /^\.\.\s+_([^:]+):\s*$/.exec(lines[i]);
    if (target !== null) {
      label = target[1];
      continue;
    }

    // bullet blocks
    const variable = /^-\s+\*\*Variable name\*\*:\s*(\w+)/i.exec(lines[i]);
    if (variable !== null) {
      const fields = new Map<string, string>();
      let current: string | undefined;
      let j = i;
      for (; j < lines.length; j++) {
        const field = /^-\s+\*\*([\w ]+)\*\*:\s*(.*)$/.exec(lines[j]);
        if (field !== null) {
          current = field[1].toLowerCase();
          fields.set(current, field[2]);
        } else if (current !== undefined && /^\s+\S/.test(lines[j])) {
          fields.set(current, `${fields.get(current)} ${lines[j].trim()}`);
        } else if (lines[j].trim() !== '') {
          break;
        }
      }
      // the bullet's name can be wrong (HASTARGET says TARGET): the
      // title line before the list wins
      const title = /^(\w+):\s*$/.exec(lines[i - 2] ?? '')?.[1] ?? variable[1];
      add(title, {
        doc: rstToMarkdown([fields.get('description') ?? '']),
        url: `${page}#${sectionId(label ?? title)}`,
        type: fields.get('type')?.replace(/`([^`<]+?)\s*<[^>]*>`__?/g, ':struct:`$1`'),
        line: i + 1,
      });
      i = j - 1;
      continue;
    }

    // sections titled with a name
    const title = /^(\w+)(?:\s+ALIAS)?\s*$/.exec(lines[i]);
    if (title !== null && underline.test(lines[i + 1] ?? '')) {
      let end = i + 2;
      while (end < lines.length && !(underline.test(lines[end + 1] ?? '') && lines[end].trim() !== '')) {
        end++;
      }
      add(title[1], {
        doc: rstToMarkdown(lines.slice(i + 2, end)),
        url: `${page}#${sectionId(lines[i])}`,
        line: i + 1,
      });
    }
    label = undefined;
  }
}
