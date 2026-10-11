/**
 * Merge of the kOS sources into the kOS database:
 * - the C# model (csharp.ts) gives the structures, their inheritance,
 *   suffixes, access, arity and types, the builtin function names and
 *   the bound variable names. It wins conflicts;
 * - the documentation (rst.ts) gives the text, urls, parameter names,
 *   units, and element types of collections (`List of Part`);
 * - the previous database gives element types, optional parameters,
 *   camel case names and the signatures of functions, which the C# does
 *   not declare, and keeps the corrections of earlier overrides;
 * - data/overrides.json, hand-maintained, is applied last.
 *
 * Everything that could not be read, every conflict and every
 * refinement is recorded in a report.
 */
import {
  FunctionEntry,
  KosDatabase,
  ParameterEntry,
  StructureEntry,
  SuffixEntry,
  VariableEntry,
} from '../../src/typeChecker/database/schema';
import {
  formatType,
  mapNames,
  parseType,
  TypeExpression,
} from '../../src/typeChecker/database/typeExpression';
import { CsClass, CsSuffix } from './csharp';
import { RstEntry, RstModel, RstParameter, RstStructure } from './rst';
import { csharpType, documentationType, NameResolver, splitGeneric } from './types';

export interface PreviousParameter {
  type: string;
  optional?: boolean;
  variadic?: boolean;
}

export interface PreviousSuffix {
  /** name in camel case */
  name: string;
  get: boolean;
  set: boolean;
  params: PreviousParameter[];
  /** value or result type */
  type: string;
}

export interface PreviousType {
  name: string;
  super?: string;
  parameters?: string[];
  suffixes: PreviousSuffix[];
}

export interface PreviousBuiltin {
  /** name in camel case */
  name: string;
  params: PreviousParameter[];
  type: string;
  kind: 'function' | 'variable' | 'lock';
}

export interface MergeInput {
  /** kOS version, e.g. `1.6.0.1` */
  kos: string;
  docsBase: string;
  classes: CsClass[];
  docs: RstModel;
  /**
   * the previous database, in this shape: element types, optional
   * parameters, camel case names and function signatures that the
   * sources do not state, and corrections made by overrides
   */
  previous: { types: PreviousType[]; builtins: PreviousBuiltin[] };
  /** names bound as shortcuts to suffixes of SHIP (`ALTITUDE`) */
  shipShortcuts: string[];
  /** deep-merged last; a null value removes the entry */
  overrides?: unknown;
  /** documentation pages, whose words split upper case names */
  prose?: string[];
}

/**
 * Findings of a merge, by section
 */
export class Report {
  public readonly sections = new Map<string, string[]>();
  public readonly counts = new Map<string, number>();

  add(section: string, message: string): void {
    const messages = this.sections.get(section) ?? [];
    messages.push(message);
    this.sections.set(section, messages);
  }

  count(name: string, value: number): void {
    this.counts.set(name, value);
  }

  /**
   * The report as Markdown
   * @param title title of the report
   */
  toMarkdown(title: string): string {
    const lines = [`# ${title}`, ''];
    lines.push('| | |', '| --- | ---: |');
    for (const [name, value] of this.counts) {
      lines.push(`| ${name} | ${value} |`);
    }
    for (const [section, messages] of this.sections) {
      lines.push('', `## ${section} (${messages.length})`, '');
      for (const message of [...new Set(messages)].sort()) {
        lines.push(`- ${message}`);
      }
    }
    return lines.join('\n') + '\n';
  }
}

/**
 * Collection structures whose element type the C# often leaves out
 */
const collections = new Set(['List', 'UniqueSet', 'Queue', 'Stack', 'Iterator', 'Enumerable', 'Collection']);

/**
 * Names used by the documentation that are not kOS type names
 */
const documentationNames: Record<string, string> = {
  color: 'RGBA',
  colour: 'RGBA',
  rgbacolor: 'RGBA',
  hsvacolor: 'HSVA',
  kosdelegate: 'Delegate',
  vesseltarget: 'Vessel',
  bodytarget: 'Body',
  orbitinfo: 'Orbit',
  bool: 'Boolean',
  number: 'Scalar',
  scalarvalue: 'Scalar',
  stringvalue: 'String',
  listvalue: 'List',
  timewarp: 'TimeWarp',
  vecdraw: 'Vecdraw',
  vectorrenderer: 'Vecdraw',
  versioninfo: 'Version',
  kosprocessor: 'KOSProcessor',
  processor: 'KOSProcessor',
  partmodulefields: 'PartModule',
  enumerator: 'Iterator',
  vesselaltitude: 'VesselAltitude',
  addonlist: 'Addons',
  terminalstruct: 'Terminal',
  highlightstructure: 'HIGHLIGHT',
  // structures documented under another name
  alt: 'VesselAltitude',
  'ship:control': 'Control',
  orbitalvelocity: 'OrbitableVelocity',
  eta: 'OrbitEta',
  maneuvernode: 'Node',
  resourcetransfer: 'Transfer',
  // swapped: LoadDistance in the documentation is LoadDistances in kOS
  loaddistance: 'LoadDistances',
  situationloaddistance: 'LoadDistance',
};

/**
 * C# classes that scripts never see
 */
const hiddenStructures = /ShouldntSee/;

/**
 * Structures whose suffixes can be added at runtime
 */
const dynamicStructures = ['Lexicon'];

const camelWords = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_]+/)
    .filter((w) => w !== '');

/**
 * Camel case spellings: the known ones (previous definitions,
 * documentation), else a split of the upper case name into known words
 */
export class CamelCase {
  /** spellings of the previous definitions that were wrong */
  private readonly known = new Map<string, string>([
    ['partstagged', 'partsTagged'],
    ['partstaggedpattern', 'partsTaggedPattern'],
    ['reboot', 'reboot'],
    ['randomseed', 'randomSeed'],
    ['warpmode', 'warpMode'],
    ['donothing', 'doNothing'],
    ['droppriority', 'dropPriority'],
    ['opcodesleft', 'opcodesLeft'],
    ['wheelsteeringpid', 'wheelSteeringPid'],
    ['neutralizecustomaxes', 'neutralizeCustomAxes'],
    ['haskscconnection', 'hasKscConnection'],
    ['labeltipoverlay', 'labelTipOverlay'],
    ['isvertwotwo', 'isVerTwoTwo'],
    ['isvertwofour', 'isVerTwoFour'],
    ['aquirerange', 'aquireRange'],
    ['aquireforce', 'aquireForce'],
    ['aquiretorque', 'aquireTorque'],
  ]);
  /** words with their number of occurrences */
  private readonly words = new Map<string, number>();
  /** one-letter words seen at the end of a name (`deltaV`) */
  private readonly letters = new Set<string>();

  /**
   * Learn a spelling with its word boundaries, e.g. `stageDeltaV`
   */
  learn(name: string): void {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
      return;
    }
    // all lower or upper case names say nothing of their words
    if (/[a-z]/.test(name) && /[A-Z]/.test(name.slice(1))) {
      const camel = name[0].toLowerCase() + name.slice(1);
      if (!this.known.has(camel.toLowerCase())) {
        this.known.set(camel.toLowerCase(), camel);
      }
      const words = camelWords(name);
      const last = words[words.length - 1];
      if (last.length === 1) {
        this.letters.add(last);
      }
      words.filter((w) => w.length > 1).forEach((w) => this.addWord(w, 5));
    }
  }

  /**
   * Learn the words of a text, e.g. documentation prose
   */
  learnText(text: string): void {
    // identifiers in upper case (`PILOTROLLTRIM`) and code are not words
    const prose = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
    for (const word of prose.match(/\b[A-Z]?[a-z]+\b/g) ?? []) {
      if (word.length > 1) {
        this.addWord(word.toLowerCase(), 1);
      }
    }
  }

  private addWord(word: string, weight: number): void {
    this.words.set(word, (this.words.get(word) ?? 0) + weight);
  }

  /**
   * The camel case spelling of a name
   * @param name name in any case, e.g. `STAGEDELTAV`
   */
  of(name: string): string {
    const lower = name.toLowerCase();
    const known = this.known.get(lower);
    if (known !== undefined) {
      return known;
    }
    if (!/^[a-z0-9]+$/.test(lower)) {
      return lower;
    }

    // fewest known words covering the name, the most frequent words on
    // ties; digits stick to the word before them
    type Split = { words: string[]; score: number };
    const best: (Split | undefined)[] = [{ words: [], score: 0 }];
    for (let end = 1; end <= lower.length; end++) {
      for (let start = 0; start < end; start++) {
        const before = best[start];
        const raw = lower.slice(start, end);
        const word = raw.replace(/[0-9]+$/, '');
        if (before === undefined || word === '') {
          continue;
        }
        const count =
          word.length === 1
            ? end === lower.length && this.letters.has(word)
              ? 1
              : 0
            : this.words.get(word) ?? 0;
        if (count === 0) {
          continue;
        }
        const candidate = {
          words: [...before.words, raw],
          score: before.score + Math.log(count + 1),
        };
        const current = best[end];
        if (
          current === undefined ||
          candidate.words.length < current.words.length ||
          (candidate.words.length === current.words.length &&
            candidate.score > current.score)
        ) {
          best[end] = candidate;
        }
      }
    }

    const split = best[lower.length];
    if (split === undefined || split.words.length === 0) {
      return lower;
    }
    return split.words
      .map((word, i) => (i === 0 ? word : word[0].toUpperCase() + word.slice(1)))
      .join('');
  }
}

/**
 * C# classes indexed by name, resolving names as the C# compiler would
 * for the regular cases: qualified names, the enclosing namespaces, and
 * the namespaces of using directives
 */
class ClassIndex {
  private readonly byName = new Map<string, CsClass[]>();

  constructor(classes: CsClass[], private readonly report: Report) {
    // partial classes: merge their parts
    const unique = new Map<string, CsClass>();
    for (const cls of classes) {
      const key = `${cls.namespace}.${cls.name}\`${cls.generics.length}`;
      const previous = unique.get(key);
      if (previous === undefined) {
        unique.set(key, { ...cls, suffixes: [...cls.suffixes], getters: [...cls.getters] });
        continue;
      }
      previous.kosNames.push(...cls.kosNames);
      previous.suffixes.push(...cls.suffixes);
      previous.getters.push(...cls.getters);
      previous.base ??= cls.base;
      previous.addon ??= cls.addon;
      previous.functionNames ??= cls.functionNames;
    }

    for (const cls of unique.values()) {
      const list = this.byName.get(cls.name) ?? [];
      list.push(cls);
      this.byName.set(cls.name, list);
    }
  }

  get all(): CsClass[] {
    return [...this.byName.values()].flat();
  }

  /**
   * The class a type name refers to
   * @param text type as written, e.g. `Suffixed.Addon` or `ListValue<T>`
   * @param from the class where the name is written
   */
  resolve(text: string, from?: CsClass): CsClass | undefined {
    const { name: qualified, args } = splitGeneric(text);
    const segments = qualified.split('.');
    const name = segments.pop()!;
    let candidates = this.byName.get(name) ?? [];

    const arity = candidates.filter((c) => c.generics.length === args.length);
    if (arity.length > 0) {
      candidates = arity;
    }
    if (segments.length > 0) {
      const suffix = segments.join('.');
      candidates = candidates.filter(
        (c) => c.namespace === suffix || c.namespace.endsWith(`.${suffix}`),
      );
    }
    if (candidates.length <= 1 || from === undefined) {
      return candidates[0];
    }

    // namespaces visible from the class, closest first
    const visible: string[] = [];
    const parts = from.namespace.split('.');
    for (let i = parts.length; i > 0; i--) {
      visible.push(parts.slice(0, i).join('.'));
    }
    visible.push(...from.usings);

    for (const namespace of visible) {
      const prefix = segments.length > 0 ? `${namespace}.${segments.join('.')}` : namespace;
      const found = candidates.filter((c) => c.namespace === prefix);
      if (found.length === 1) {
        return found[0];
      }
    }

    this.report.add(
      'C# names resolved by guess',
      `\`${text}\` in ${from.name} (${from.file}): ${candidates.map((c) => `${c.namespace}.${c.name}`).join(', ')}`,
    );
    return candidates[0];
  }

  /**
   * Base classes of a class, nearest first
   */
  ancestors(cls: CsClass): CsClass[] {
    const chain: CsClass[] = [];
    let current: CsClass | undefined = cls;
    while (current?.base !== undefined) {
      const base = this.resolve(current.base, current);
      if (base === undefined || chain.includes(base) || base === cls) {
        break;
      }
      chain.push(base);
      current = base;
    }
    return chain;
  }
}

/**
 * kOS name of a class, from its first KOSNomenclature attribute that
 * names it
 */
const kosNameOf = (cls: CsClass) =>
  cls.kosNames.find((n) => n.csharpToKos)?.name ?? cls.kosNames[0]?.name;

/**
 * A structure being built: its root class, the classes folded into it
 */
interface Building {
  name: string;
  root: CsClass;
  /** classes whose suffixes it owns, root first */
  classes: CsClass[];
  /** base class of the root, with its generic arguments */
  baseText?: string;
  inherits?: string;
  entry: StructureEntry;
  /** upper case suffix names (aliases included) to their key */
  keys: Map<string, string>;
  /** suffixes registered with computed names */
  computed: SuffixEntry[];
}

/**
 * Merge the sources into a database
 * @param input sources
 */
export function merge(input: MergeInput): { database: KosDatabase; report: Report } {
  const report = new Report();
  const index = new ClassIndex(input.classes, report);
  const camel = new CamelCase();

  for (const type of input.previous.types) {
    type.suffixes.forEach((s) => camel.learn(s.name));
  }
  for (const builtin of input.previous.builtins) {
    camel.learn(builtin.name);
  }
  for (const page of input.prose ?? []) {
    // literal blocks (`::` then indented lines) are code
    camel.learnText(page.replace(/::\s*\n(?:\s*\n|[ \t]+.*\n)*/g, '\n'));
  }
  for (const structure of input.docs.structures.values()) {
    camel.learn(structure.name);
    camel.learnText(structure.doc);
    for (const member of structure.members.values()) {
      camel.learn(member.name);
      camel.learnText(member.doc);
    }
  }

  // -------------------------------------------------------------------
  // structures from the C# classes
  // -------------------------------------------------------------------

  const structures = new Map<string, Building>();
  const classStructure = new Map<CsClass, Building>();
  const aliases = new Map<string, string>();

  // the documentation's spelling of a name, when it differs only in case
  // and is not all upper case: `KUniverse` for `Kuniverse`
  const display = new Map<string, string>();
  for (const structure of input.docs.structures.values()) {
    if (/[a-z]/.test(structure.name)) {
      display.set(structure.name.toLowerCase(), structure.name);
    }
  }
  const nameOf = (cls: CsClass): string | undefined => {
    const name = kosNameOf(cls);
    return name && (display.get(name.toLowerCase()) ?? name);
  };

  const named = index.all.filter((cls) => {
    const name = nameOf(cls);
    return name !== undefined && !hiddenStructures.test(name);
  });

  // the structure a named class belongs to: its own, or its nearest
  // named ancestor's when they share the kOS name
  const owner = (cls: CsClass): { name: string; folded?: CsClass } => {
    const name = nameOf(cls)!;
    const parent = index.ancestors(cls).find((a) => nameOf(a) !== undefined);
    if (parent !== undefined && nameOf(parent) === name) {
      return { name, folded: parent };
    }
    return { name };
  };

  // roots first: classes not folded into an ancestor
  const roots = named.filter((cls) => owner(cls).folded === undefined);
  const folded = named.filter((cls) => owner(cls).folded !== undefined);

  const rootScore = (cls: CsClass, name: string) =>
    cls.name === name ? 0 : cls.name.toLowerCase().startsWith(name.toLowerCase()) ? 1 : 2;

  for (const cls of roots.sort((a, b) => a.file.localeCompare(b.file))) {
    const name = nameOf(cls)!;
    const existing = structures.get(name);
    if (existing !== undefined) {
      const keep = rootScore(existing.root, name) <= rootScore(cls, name) ? existing.root : cls;
      const drop = keep === cls ? existing.root : cls;
      report.add(
        'C# classes sharing a kOS name with an unrelated class (ignored)',
        `${drop.name} (${drop.file}) is named ${name}, like ${keep.name}`,
      );
      if (keep === existing.root) {
        continue;
      }
      structures.delete(name);
    }

    const building: Building = {
      name,
      root: cls,
      classes: [cls],
      baseText: cls.base,
      entry: { suffixes: {} },
      keys: new Map(),
      computed: [],
    };
    if (cls.generics.length > 0) {
      building.entry.parameters = cls.generics.slice(0, 1);
    }
    structures.set(name, building);
  }
  for (const building of structures.values()) {
    classStructure.set(building.root, building);
  }

  // folded classes join their ancestor's structure
  for (const cls of folded) {
    let target: CsClass | undefined = cls;
    while (target !== undefined && owner(target).folded !== undefined) {
      target = owner(target).folded;
    }
    const building = target && classStructure.get(target);
    if (building === undefined) {
      report.add('C# classes without a structure', `${cls.name} (${cls.file})`);
      continue;
    }
    building.classes.push(cls);
    classStructure.set(cls, building);
  }

  // unnamed classes give their suffixes to their named descendants
  const unnamedBases = (cls: CsClass): CsClass[] => {
    const bases: CsClass[] = [];
    for (const ancestor of index.ancestors(cls)) {
      if (nameOf(ancestor) !== undefined) {
        break;
      }
      bases.push(ancestor);
    }
    return bases;
  };
  for (const building of structures.values()) {
    for (const cls of [...building.classes]) {
      for (const base of unnamedBases(cls)) {
        if (!building.classes.includes(base)) {
          building.classes.push(base);
        }
      }
    }
  }

  // names, aliases included, to structure names
  for (const cls of named) {
    const building = classStructure.get(cls);
    if (building === undefined) {
      continue;
    }
    for (const alias of cls.kosNames) {
      aliases.set(alias.name.toLowerCase(), building.name);
    }
  }
  for (const name of structures.keys()) {
    aliases.set(name.toLowerCase(), name);
  }

  // the C# class names of each structure, for C# type texts
  const csharpNames = new Map<string, string>();
  for (const [cls, building] of classStructure) {
    csharpNames.set(cls.name, building.name);
  }

  const resolveCsharp = (from: CsClass): NameResolver => (name) => {
    const cls = index.resolve(name, from);
    if (cls === undefined) {
      return undefined;
    }
    const building = classStructure.get(cls);
    if (building !== undefined) {
      return building.name;
    }
    // an unnamed class: its nearest named ancestor
    for (const ancestor of index.ancestors(cls)) {
      const found = classStructure.get(ancestor);
      if (found !== undefined) {
        return found.name;
      }
    }
    return undefined;
  };

  const kosName: NameResolver = (name) => {
    const lower = name.toLowerCase();
    return aliases.get(lower) ?? (lower === 'none' ? 'None' : undefined);
  };

  // names of the documentation: its own spellings first
  const docName: NameResolver = (name) => {
    const mapped = documentationNames[name.toLowerCase()];
    return mapped !== undefined ? kosName(mapped) : kosName(name);
  };

  // inheritance, with the generic arguments of the base (`Collection<T>`)
  for (const building of structures.values()) {
    const ancestors = index.ancestors(building.root);
    const parent = ancestors.find((a) => classStructure.has(a));
    if (parent === undefined) {
      continue;
    }
    const parentStructure = classStructure.get(parent)!;
    // the base as written by the nearest class of that structure
    const child = [building.root, ...ancestors].find(
      (c) => c.base !== undefined && index.resolve(c.base, c) === parent,
    );
    let inherits = parentStructure.name;
    if (child?.base !== undefined && parentStructure.entry.parameters !== undefined) {
      const result = csharpType(child.base, resolveCsharp(child), child.generics);
      if ('type' in result) {
        inherits = result.type;
      }
    }
    building.inherits = inherits;
    building.entry.inherits = inherits;
  }

  // -------------------------------------------------------------------
  // suffixes from the C# registrations
  // -------------------------------------------------------------------

  const typeOf = (text: string, cls: CsClass, building: Building, where: string) => {
    const result = csharpType(text, resolveCsharp(cls), building.entry.parameters ?? []);
    if ('unknown' in result) {
      report.add('C# types without a kOS structure', `\`${text}\` (${where})`);
      return 'Structure';
    }
    // extra generic parameters of the C# class stand for any structure
    const extra = cls.generics.slice(1);
    return extra.length === 0
      ? result.type
      : formatType(mapNames(parseType(result.type), (n) => (extra.includes(n) ? 'Structure' : n)));
  };

  // OptionalArgsSuffix parameters are filled from the documentation or
  // the previous definitions
  const unknownParameters = new Set<SuffixEntry>();

  const addSuffix = (building: Building, cls: CsClass, suffix: CsSuffix) => {
    const where = `${building.name}:${suffix.names?.[0] ?? '?'}, ${suffix.file}:${suffix.line}`;
    const g = suffix.generics.map((text) => typeOf(text, cls, building, where));
    let entry: SuffixEntry | undefined;
    const call = (returns: string | undefined, params: string[]): SuffixEntry => ({
      access: 'call',
      type: returns ?? 'None',
      ...(params.length > 0 ? { params: params.map((type) => ({ type })) } : {}),
    });

    switch (suffix.kind) {
      case 'Suffix':
      case 'StaticSuffix':
        entry = { access: 'get', type: g[0] };
        break;
      case 'SetSuffix':
      case 'ClampSetSuffix':
        entry = { access: 'getset', type: g[0] };
        break;
      case 'NoArgsSuffix':
        entry = call(g[0], []);
        break;
      case 'NoArgsVoidSuffix':
        entry = call(undefined, []);
        break;
      case 'OneArgsSuffix':
        entry = g.length === 1 ? call(undefined, g) : call(g[0], g.slice(1));
        break;
      case 'TwoArgsSuffix':
        entry = g.length === 2 ? call(undefined, g) : call(g[0], g.slice(1));
        break;
      case 'ThreeArgsSuffix':
        entry = g.length === 3 ? call(undefined, g) : call(g[0], g.slice(1));
        break;
      case 'VarArgsSuffix':
        entry = {
          access: 'call',
          type: g[0],
          params: [{ type: g[1] ?? 'Structure', optional: true, variadic: true }],
        };
        break;
      case 'OptionalArgsSuffix':
        entry = { access: 'call', type: g[0] };
        unknownParameters.add(entry);
        break;
      default:
        report.add('Unknown suffix classes', `${suffix.kind} (${where})`);
        return;
    }

    if (suffix.description !== undefined && suffix.description.trim() !== '') {
      entry.doc = suffix.description.trim();
    }

    // names computed at runtime: the documented ones are added later
    if (suffix.names === undefined || suffix.names.length === 0) {
      building.entry.dynamic = true;
      building.computed.push(entry);
      report.add('Suffixes with computed names (structure marked dynamic)', where);
      return;
    }

    const [name, ...others] = suffix.names;
    const key = camel.of(name);
    const existing = building.keys.get(name.toUpperCase());
    if (existing !== undefined) {
      report.add('Suffixes registered twice (last kept)', where);
      delete building.entry.suffixes[existing];
    }
    if (others.length > 0) {
      entry.aliases = others.map((alias) => camel.of(alias));
    }
    building.entry.suffixes[key] = entry;
    for (const upper of suffix.names) {
      building.keys.set(upper.toUpperCase(), key);
    }
  };

  for (const building of structures.values()) {
    for (const cls of building.classes) {
      for (const suffix of cls.suffixes) {
        if (suffix.owner !== undefined) {
          continue;
        }
        addSuffix(building, cls, suffix);
      }
    }
  }

  // AddGlobalSuffix<T>: suffixes of another structure
  for (const cls of index.all) {
    for (const suffix of cls.suffixes) {
      if (suffix.owner === undefined) {
        continue;
      }
      const target = index.resolve(suffix.owner, cls);
      const building = target && classStructure.get(target);
      if (building === undefined) {
        report.add('Global suffixes of unknown classes', `${suffix.owner} (${suffix.file}:${suffix.line})`);
        continue;
      }
      addSuffix(building, cls, suffix);
    }
  }

  // addons: a suffix of the addon list for each kOSAddon class
  const addonList = [...structures.values()].find((b) => b.root.name === 'AddonList');
  for (const cls of index.all.filter((c) => c.addon !== undefined)) {
    const building = classStructure.get(cls);
    if (addonList === undefined || building === undefined) {
      report.add('Addons without a structure', `${cls.addon} (${cls.file})`);
      continue;
    }
    const key = cls.addon!.toLowerCase();
    addonList.entry.suffixes[key] = { access: 'get', type: building.name };
    addonList.keys.set(cls.addon!.toUpperCase(), key);
  }

  for (const name of dynamicStructures) {
    const building = structures.get(name);
    if (building !== undefined) {
      building.entry.dynamic = true;
    }
  }

  // -------------------------------------------------------------------
  // previous definitions
  // -------------------------------------------------------------------


  const previousType = (
    text: string,
    where: string,
    parameters: string[] = [],
  ): string | undefined => {
    try {
      let unknown: string | undefined;
      const type = mapNames(parseType(text), (name) => {
        if (name === 'T') {
          return parameters.includes(name) ? name : 'Structure';
        }
        const found = kosName(name);
        if (found === undefined) {
          unknown ??= name;
          return name;
        }
        return found;
      });
      if (unknown !== undefined) {
        report.add('Previous definitions: unknown type names', `\`${unknown}\` (${where})`);
        return undefined;
      }
      return formatType(normalizeUnion(type));
    } catch {
      report.add('Previous definitions: unreadable types', `\`${text}\` (${where})`);
      return undefined;
    }
  };

  const previousParams = (params: PreviousParameter[], where: string): ParameterEntry[] | undefined => {
    const result: ParameterEntry[] = [];
    for (const param of params) {
      const type = previousType(param.type, where);
      if (type === undefined) {
        return undefined;
      }
      result.push({
        type,
        ...(param.optional || param.variadic ? { optional: true } : {}),
        ...(param.variadic ? { variadic: true } : {}),
      });
    }
    return result;
  };

  const previousStructures = new Map<string, PreviousType[]>();
  for (const type of input.previous.types) {
    const name = kosName(type.name);
    if (name === undefined || !structures.has(name)) {
      if (name !== 'Structure') {
        report.add('Previous definitions: structures not in kOS', `${type.name}${name ? ` (${name})` : ''}`);
      }
      continue;
    }
    previousStructures.set(name, [...(previousStructures.get(name) ?? []), type]);
  }

  // -------------------------------------------------------------------
  // documentation
  // -------------------------------------------------------------------

  const docStructures = new Map<string, RstStructure[]>();
  for (const structure of input.docs.structures.values()) {
    const name = docName(structure.name);
    if (name === undefined || !structures.has(name)) {
      report.add(
        'Documented structures not in kOS',
        `${structure.name} (${structure.file})${name ? ` as ${name}` : ''}`,
      );
      continue;
    }
    docStructures.set(name, [...(docStructures.get(name) ?? []), structure]);
  }

  // children of each structure, to find suffixes documented on a child
  const children = new Map<string, string[]>();
  for (const building of structures.values()) {
    if (building.inherits !== undefined) {
      const parent = building.inherits.replace(/<.*$/, '');
      children.set(parent, [...(children.get(parent) ?? []), building.name]);
    }
  }
  const descendants = (name: string): string[] =>
    (children.get(name) ?? []).flatMap((child) => [child, ...descendants(child)]);

  const ancestors = (name: string): string[] => {
    const parent = structures.get(name)?.inherits?.replace(/<.*$/, '');
    return parent === undefined ? [] : [parent, ...ancestors(parent)];
  };

  // documented on the structure, else on a child (shared suffixes
  // documented per child), else on an ancestor (overridden suffixes)
  const documentedMember = (structure: string, names: string[]) => {
    for (const where of [structure, ...descendants(structure), ...ancestors(structure)]) {
      for (const doc of docStructures.get(where) ?? []) {
        for (const name of names) {
          const member = doc.members.get(name);
          const row = doc.tableRows.get(name);
          if (member !== undefined || row !== undefined) {
            return { member, row, doc };
          }
        }
      }
    }
    return undefined;
  };

  const docType = (
    text: string | undefined,
    where: string,
  ): { type?: string; units?: string } => {
    if (text === undefined || text.trim() === '') {
      return {};
    }
    const result = documentationType(text, docName);
    for (const name of result.unknown) {
      report.add('Documentation: unknown type names', `\`${name}\` in "${text}" (${where})`);
    }
    return result;
  };

  // -------------------------------------------------------------------
  // structures: refine with the previous definitions and documentation
  // -------------------------------------------------------------------

  // structures with computed suffix names: their documented suffixes,
  // shaped like the computed registrations when they all agree
  for (const building of structures.values()) {
    if (building.computed.length === 0) {
      continue;
    }
    const [first] = building.computed;
    const same = building.computed.every(
      (c) => c.access === first.access && c.type === first.type,
    );
    for (const doc of docStructures.get(building.name) ?? []) {
      for (const upper of new Set([...doc.members.keys(), ...doc.tableRows.keys()])) {
        if (building.keys.has(upper) || inherited(building, upper, structures)) {
          continue;
        }
        const member = doc.members.get(upper);
        const key = camel.of(member?.name ?? upper);
        const typed = docType(member?.type ?? doc.tableRows.get(upper)?.type, `${building.name}:${key}`);
        building.entry.suffixes[key] = same
          ? { ...first }
          : {
              access: member?.kind === 'method' ? 'call' : 'get',
              type: typed.type ?? 'Structure',
            };
        building.keys.set(upper, key);
        report.add('Suffixes with computed names, added from the documentation', `${building.name}:${key}`);
      }
    }
  }

  let undocumented = 0;
  let suffixCount = 0;
  for (const building of structures.values()) {
    const { entry, name } = building;
    const docs = docStructures.get(name) ?? [];
    const mainDoc = docs.find((d) => d.doc !== '') ?? docs[0];
    if (mainDoc !== undefined) {
      if (mainDoc.doc !== '') {
        entry.doc = mainDoc.doc;
      }
      entry.url = mainDoc.url;
    }

    const previousSuffixes = new Map<string, { suffix: PreviousType['suffixes'][number]; type: PreviousType }>();
    for (const type of previousStructures.get(name) ?? []) {
      for (const suffix of type.suffixes) {
        previousSuffixes.set(suffix.name.toUpperCase(), { suffix, type });
      }
    }

    for (const [key, suffix] of Object.entries(entry.suffixes)) {
      suffixCount++;
      const upperNames = [key, ...(suffix.aliases ?? [])].map((n) => n.toUpperCase());
      const where = `${name}:${key}`;
      const found = documentedMember(name, upperNames);
      const old = upperNames.map((n) => previousSuffixes.get(n)).find((l) => l !== undefined);

      // documentation text and url
      if (found !== undefined) {
        const text = found.member?.doc || found.row?.doc;
        if (text) {
          suffix.doc = text;
        }
        suffix.url =
          found.member?.url ??
          `${found.doc.url.replace(/#.*$/, '')}#${found.member ? found.member.kind : 'attribute'}:${found.doc.name.toUpperCase()}:${upperNames[0]}`;
        // only the members documented with their own directive have an
        // anchor
        if (found.member === undefined) {
          suffix.url = found.doc.url;
        }
        if (found.member !== undefined) {
          checkAccess(suffix, found.member, where, report);
        }
      } else {
        undocumented++;
        report.add('Suffixes without documentation', where);
      }

      // value type: the C# leaves out element types and uses Structure
      // where it cannot be precise
      const documented = docType(
        found?.member?.type ?? found?.member?.returns ?? found?.row?.type,
        where,
      );
      if (documented.units !== undefined) {
        suffix.units = documented.units;
      }
      const previous =
        old && previousType(old.suffix.type, where, entry.parameters);
      suffix.type = refine(suffix.type, documented.type, previous, where, report);

      // parameters
      const docParams = found?.member?.params;
      if (unknownParameters.has(suffix)) {
        const params =
          (old && previousParams(old.suffix.params, where)) ??
          docParams?.map((p) => ({
            type: docType(p.type, where).type ?? 'Structure',
            ...(p.optional ? { optional: true } : {}),
            ...(p.variadic ? { variadic: true } : {}),
          }));
        if (params === undefined) {
          report.add('Optional-argument suffixes without parameters (any accepted)', where);
          suffix.params = [{ type: 'Structure', optional: true, variadic: true }];
        } else if (params.length > 0) {
          // OptionalArgsSuffix: arguments from the end can be left out
          suffix.params = params.map((p) => ({ ...p, optional: true }));
          const required = (old?.suffix.params ?? []).filter((p) => !p.optional && !p.variadic).length;
          suffix.params.forEach((p, i) => {
            if (i < required) {
              delete p.optional;
            }
          });
        }
      }
      if (suffix.params !== undefined && docParams !== undefined) {
        nameParameters(suffix.params, docParams, where, report);
      }
      if (
        old !== undefined &&
        suffix.access === 'call' &&
        !unknownParameters.has(suffix) &&
        old.suffix.params.length !== (suffix.params?.length ?? 0)
      ) {
        report.add(
          'Previous definitions: parameter counts that differ from C# (C# kept)',
          `${where}: ${old.suffix.params.length} before, ${suffix.params?.length ?? 0} now`,
        );
      }
    }

    // documented or previously defined suffixes the C# does not have
    for (const doc of docs) {
      for (const upper of new Set([...doc.members.keys(), ...doc.tableRows.keys()])) {
        if (!building.keys.has(upper) && !inherited(building, upper, structures)) {
          report.add('Documented suffixes not in the C#', `${name}:${upper} (${doc.file})`);
        }
      }
    }
    for (const [upper, { type }] of previousSuffixes) {
      if (!building.keys.has(upper) && !inherited(building, upper, structures)) {
        report.add('Previous definitions: suffixes not in the C#', `${name}:${upper} (was ${type.name})`);
      }
    }
  }

  // -------------------------------------------------------------------
  // functions
  // -------------------------------------------------------------------

  const previousFunctions = new Map<string, PreviousBuiltin>();
  const previousVariables = new Map<string, PreviousBuiltin>();
  for (const builtin of input.previous.builtins) {
    (builtin.kind === 'function' ? previousFunctions : previousVariables).set(
      builtin.name.toLowerCase(),
      builtin,
    );
  }

  const functions: Record<string, FunctionEntry> = {};
  const functionClasses = index.all.filter((c) => c.functionNames !== undefined);
  for (const cls of functionClasses.sort((a, b) => a.functionNames![0].localeCompare(b.functionNames![0]))) {
    const names = cls.functionNames!.filter((n) => !/_deprecated$/i.test(n));
    if (names.length === 0) {
      continue;
    }

    const where = `${names[0]}() (${cls.file})`;
    const key = camel.of(names[0]);
    const old = names.map((n) => previousFunctions.get(n.toLowerCase())).find((l) => l !== undefined);
    // functions documented as globals (`.. global:: HUDTEXT`) as a last
    // resort
    let overloads = names.flatMap((n) => input.docs.functions.get(n.toUpperCase()) ?? []);
    if (overloads.length === 0) {
      overloads = names
        .map((n) => input.docs.globals.get(n.toUpperCase()))
        .filter((g): g is RstEntry => g !== undefined && g.doc !== '')
        .map((g) => ({ ...g, params: [] }));
    }

    const entry: FunctionEntry = { returns: 'Structure', params: [] };
    const known = old && previousParams(old.params, where);
    const returns = old && previousType(old.type, where);
    const longest = overloads.reduce<RstEntry | undefined>(
      (a, b) => ((b.params?.length ?? 0) > (a?.params?.length ?? -1) ? b : a),
      undefined,
    );

    if (known !== undefined) {
      entry.params = known;
    } else if (longest !== undefined) {
      const fewest = Math.min(...overloads.map((o) => (o.params ?? []).filter((p) => !p.optional).length));
      entry.params = (longest.params ?? []).map((p, i) => ({
        type: docType(p.type, where).type ?? 'Structure',
        ...(p.optional || i >= fewest ? { optional: true } : {}),
        ...(p.variadic ? { variadic: true, optional: true } : {}),
      }));
      report.add('Functions typed from the documentation only', where);
    } else {
      entry.params = [{ type: 'Structure', optional: true, variadic: true }];
      report.add('Functions without a signature (any arguments accepted)', where);
    }

    // the documented result, else the previous one
    let documentedReturns = docType(longest?.returns, where).type;
    if (documentedReturns === 'Structure') {
      documentedReturns = undefined;
    }
    if (returns !== undefined && documentedReturns !== undefined && returns !== documentedReturns) {
      report.add(
        'Function results: documentation and previous definitions differ (documentation kept)',
        `${where}: ${documentedReturns}, was ${returns}`,
      );
    }
    entry.returns =
      documentedReturns ??
      returns ??
      (cls.functionShape?.returns === false ? 'None' : 'Structure');
    if (returns === undefined && documentedReturns === undefined && cls.functionShape?.returns !== false) {
      report.add('Functions without a result type (Structure)', where);
    }

    // the C# pops a fixed number of arguments unless it counts them
    const shape = cls.functionShape;
    if (shape !== undefined && !shape.variable && !entry.params.some((p) => p.variadic)) {
      if (shape.pops !== entry.params.length) {
        report.add(
          'Functions whose parameter count differs from the C# pops (check)',
          `${where}: ${entry.params.length} parameters, ${shape.pops} pops`,
        );
      }
    }
    if (shape !== undefined && shape.returns && entry.returns === 'None') {
      report.add('Functions returning a value in C# but None here (check)', where);
    }

    if (longest !== undefined) {
      // the overload with as many parameters, else the longest
      const matching =
        overloads.find((o) => (o.params?.length ?? 0) === entry.params.length) ?? longest;
      nameParameters(entry.params, matching.params ?? [], where, report);
      const docs = overloads.map((o) => o.doc).filter((d) => d !== '');
      if (docs.length > 0) {
        entry.doc = [...new Set(docs)].join('\n\n---\n\n');
      }
      entry.url = longest.url;
    } else {
      // constructors are documented with their structure: list(), lex()
      const created = structures.get(entry.returns.replace(/<.*$/, ''));
      const isConstructor =
        created !== undefined &&
        names.some((n) => kosName(n) === created.name);
      if (isConstructor && created.entry.doc !== undefined) {
        entry.doc = created.entry.doc;
        entry.url = created.entry.url;
      } else {
        report.add('Functions without documentation', where);
      }
    }

    if (names.length > 1) {
      entry.aliases = names.slice(1).map((n) => camel.of(n));
    }
    functions[key] = entry;
  }

  for (const [name, builtin] of previousFunctions) {
    const found = Object.entries(functions).some(
      ([key, f]) => key.toLowerCase() === name || f.aliases?.some((a) => a.toLowerCase() === name),
    );
    if (!found) {
      report.add('Previous definitions: functions not in the C#', builtin.name);
    }
  }

  // -------------------------------------------------------------------
  // variables
  // -------------------------------------------------------------------

  const vessel = structures.get('Vessel');
  const variables: Record<string, VariableEntry> = {};
  const bindings = new Map<string, { setter: boolean; getter: boolean; where: string }>();
  for (const cls of index.all) {
    for (const getter of cls.getters) {
      for (const name of getter.names ?? []) {
        if (name.includes(':')) {
          report.add('Bound variables with invalid names (ignored)', `${name} (${getter.file})`);
          continue;
        }
        const upper = name.toUpperCase();
        const binding = bindings.get(upper) ?? { setter: false, getter: false, where: `${getter.file}:${getter.line}` };
        if (getter.setter) {
          binding.setter = true;
        } else {
          binding.getter = true;
        }
        bindings.set(upper, binding);
      }
    }
  }
  for (const name of input.shipShortcuts) {
    const binding = bindings.get(name) ?? { setter: false, getter: true, where: 'VesselTarget.ShortCuttableShipSuffixes' };
    binding.getter = true;
    bindings.set(name, binding);
  }

  for (const [upper, binding] of [...bindings].sort(([a], [b]) => a.localeCompare(b))) {
    const old = previousVariables.get(upper.toLowerCase());
    const key = camel.of(old?.name ?? upper);
    const where = `${upper} (${binding.where})`;
    const documented = input.docs.globals.get(upper);

    const entry: VariableEntry = {
      type: 'Structure',
      access: binding.setter && binding.getter ? 'getset' : 'get',
    };
    if (binding.setter && !binding.getter) {
      report.add('Bound variables that can only be set (typed get/set)', where);
      entry.access = 'getset';
    }

    const shortcut = input.shipShortcuts.includes(upper) && vessel !== undefined
      ? vessel.entry.suffixes[vessel.keys.get(upper) ?? ''] ??
        inheritedSuffix(vessel, upper, structures)
      : undefined;

    const previous = old && previousType(old.type, where);
    const docTyped = docType(documented?.type, where);
    entry.type = previous ?? shortcut?.type ?? docTyped.type ?? 'Structure';
    if (previous !== undefined && shortcut !== undefined && previous !== shortcut.type) {
      report.add(
        'Bound variables whose previous type differs from the SHIP suffix (previous kept)',
        `${where}: ${previous} before, ${shortcut.type} as suffix`,
      );
    }
    if (entry.type === 'Structure' && previous === undefined) {
      report.add('Bound variables without a type (Structure)', where);
    }
    if (docTyped.units ?? shortcut?.units) {
      entry.units = docTyped.units ?? shortcut?.units;
    }

    if (documented !== undefined && documented.doc !== '') {
      entry.doc = documented.doc;
      entry.url = documented.url;
    } else if (shortcut !== undefined) {
      entry.doc = `Shortcut for \`SHIP:${upper}\`.` + (shortcut.doc ? `\n\n${shortcut.doc}` : '');
      entry.url = shortcut.url;
    } else {
      report.add('Bound variables without documentation', where);
    }
    if (old?.kind === 'lock') {
      entry.lock = true;
    }
    variables[key] = entry;
  }

  for (const [name, builtin] of previousVariables) {
    if (!bindings.has(name.toUpperCase())) {
      report.add('Previous definitions: variables not bound in the C#', builtin.name);
    }
  }

  // -------------------------------------------------------------------
  // result
  // -------------------------------------------------------------------

  let database: KosDatabase = {
    kos: input.kos,
    docsBase: input.docsBase,
    structures: Object.fromEntries(
      [...structures.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((b) => [b.name, b.entry]),
    ),
    functions,
    variables,
  };

  if (input.overrides !== undefined) {
    const before = database;
    database = deepMerge(database, input.overrides) as KosDatabase;
    const added = (kind: string, old: object, now: object) => {
      const keys = new Set(Object.keys(old));
      for (const key of Object.keys(now)) {
        if (!keys.has(key)) {
          report.add('Entries added by the overrides (check the names)', `${kind} ${key}`);
        }
      }
    };
    added('function', before.functions, database.functions);
    added('variable', before.variables, database.variables);
    added('structure', before.structures, database.structures);
    for (const [name, structure] of Object.entries(database.structures)) {
      const old = before.structures[name];
      if (old !== undefined) {
        added(`suffix of ${name}:`, old.suffixes, structure.suffixes);
      }
    }
  }

  validate(database, report);

  report.count('Structures', Object.keys(database.structures).length);
  report.count('Suffixes', suffixCount);
  report.count('Suffixes without documentation', undocumented);
  report.count('Functions', Object.keys(database.functions).length);
  report.count('Variables', Object.keys(database.variables).length);
  report.count('Documented structures', docStructures.size);

  return { database, report };
}

/**
 * Whether an upper case suffix name is inherited from an ancestor
 */
function inherited(building: Building, upper: string, structures: Map<string, Building>): boolean {
  return inheritedSuffix(building, upper, structures) !== undefined;
}

/**
 * A suffix of an ancestor of a structure
 */
function inheritedSuffix(
  building: Building,
  upper: string,
  structures: Map<string, Building>,
): SuffixEntry | undefined {
  let current = building.inherits && structures.get(building.inherits.replace(/<.*$/, ''));
  const seen = new Set<Building>();
  while (current && !seen.has(current)) {
    seen.add(current);
    const key = current.keys.get(upper);
    if (key !== undefined) {
      return current.entry.suffixes[key];
    }
    current = current.inherits && structures.get(current.inherits.replace(/<.*$/, ''));
  }
  return undefined;
}

/**
 * Sort and deduplicate the members of unions, so that equal types are
 * written the same way
 */
function normalizeUnion(type: TypeExpression): TypeExpression {
  if (type.kind === 'name') {
    return { ...type, args: type.args.map(normalizeUnion) };
  }
  const members = [...new Map(type.types.map((t) => [formatType(normalizeUnion(t)), normalizeUnion(t)])).entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, t]) => t);
  return members.length === 1 ? members[0] : { kind: 'union', types: members };
}

/**
 * The type of a value from its sources: the C# type, made precise by the
 * documentation, then by the previous definitions
 * @param csharp type from the C#
 * @param documented type read from the documentation
 * @param previous type from the previous definitions
 */
function refine(
  csharp: string,
  documented: string | undefined,
  previous: string | undefined,
  where: string,
  report: Report,
): string {
  const candidates = [documented, previous].filter((t): t is string => t !== undefined && t !== 'Structure');
  const bare = parseType(csharp);

  for (const candidate of candidates) {
    if (candidate === csharp) {
      continue;
    }
    const parsed = parseType(candidate);

    // `List` from the C#, `List<Part>` from the other source
    if (
      bare.kind === 'name' &&
      bare.args.length === 0 &&
      collections.has(bare.name) &&
      parsed.kind === 'name' &&
      parsed.name === bare.name &&
      parsed.args.length > 0
    ) {
      report.add('Element types added', `${where}: ${candidate}`);
      return candidate;
    }

    // `Structure` from the C#: any value, the other source says which
    if (csharp === 'Structure') {
      report.add('Types made precise (C# says Structure)', `${where}: ${candidate}`);
      return candidate;
    }
  }

  const differing = candidates.filter(
    (c) => c !== csharp && !(bare.kind === 'name' && c.startsWith(`${bare.name}<`)),
  );
  if (differing.length > 0 && csharp !== 'None') {
    report.add('Types that differ from the C# (C# kept)', `${where}: ${csharp}, also ${differing.join(', ')}`);
  }
  return csharp;
}

/**
 * Give parameters the names and descriptions of the documentation
 * @param params parameters to name
 * @param documented documented parameters, in order
 */
function nameParameters(
  params: ParameterEntry[],
  documented: RstParameter[],
  where: string,
  report: Report,
): void {
  // names of another signature would mislead
  if (documented.length > params.length && !params.some((p) => p.variadic)) {
    report.add(
      'Documented parameter counts that differ (names not applied)',
      `${where}: ${params.length} parameters, ${documented.length} documented`,
    );
    return;
  }
  if (documented.length > 0 && documented.length < params.length) {
    report.add(
      'Documented parameter counts that differ (names applied in order)',
      `${where}: ${params.length} parameters, ${documented.length} documented`,
    );
  }
  params.forEach((param, i) => {
    const doc = documented[i];
    if (doc === undefined) {
      return;
    }
    param.name = doc.name;
    if (doc.doc !== undefined) {
      param.doc = doc.doc;
    }
  });
}

/**
 * Compare the documented access of a suffix with the C# one
 */
function checkAccess(suffix: SuffixEntry, member: RstEntry, where: string, report: Report): void {
  const text = member.access?.toLowerCase();
  if (text === undefined || suffix.access === 'call') {
    return;
  }
  const settable = /set/.test(text) && !/only\s*get|get\s*only/.test(text);
  if (settable !== (suffix.access === 'getset')) {
    report.add(
      'Documented access that differs from the C# (C# kept)',
      `${where}: ${suffix.access}, documented "${member.access}"`,
    );
  }
}

/**
 * Deep merge of overrides: objects are merged, other values replace, and
 * null removes
 */
export function deepMerge(base: unknown, override: unknown): unknown {
  if (
    typeof base !== 'object' ||
    base === null ||
    Array.isArray(base) ||
    typeof override !== 'object' ||
    override === null ||
    Array.isArray(override)
  ) {
    return override;
  }
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [written, value] of Object.entries(override as Record<string, unknown>)) {
    if (written.startsWith('$')) {
      continue;
    }
    // names are case-insensitive in kOS: `reboot` overrides `reBoot`
    const key =
      written in result
        ? written
        : (Object.keys(result).find((k) => k.toLowerCase() === written.toLowerCase()) ?? written);
    if (value === null) {
      delete result[key];
    } else {
      result[key] = key in result ? deepMerge(result[key], value) : value;
    }
  }
  return result;
}

/**
 * Check that every type expression parses and names a structure
 */
function validate(database: KosDatabase, report: Report): void {
  const known = new Set(Object.keys(database.structures));
  known.add('None');

  const check = (text: string, where: string, parameters: string[] = []) => {
    try {
      mapNames(parseType(text), (name) => {
        if (!known.has(name) && !parameters.includes(name)) {
          report.add('Invalid types in the database', `\`${text}\` (${where}): unknown \`${name}\``);
        }
        return name;
      });
    } catch {
      report.add('Invalid types in the database', `\`${text}\` (${where}): malformed`);
    }
  };

  for (const [name, structure] of Object.entries(database.structures)) {
    const parameters = structure.parameters ?? [];
    if (structure.inherits !== undefined) {
      check(structure.inherits, name, parameters);
    }
    for (const [key, suffix] of Object.entries(structure.suffixes)) {
      check(suffix.type, `${name}:${key}`, parameters);
      for (const param of suffix.params ?? []) {
        check(param.type, `${name}:${key}`, parameters);
      }
    }
  }
  for (const [name, fn] of Object.entries(database.functions)) {
    check(fn.returns, `${name}()`);
    fn.params.forEach((p) => check(p.type, `${name}()`));
  }
  for (const [name, variable] of Object.entries(database.variables)) {
    check(variable.type, name);
  }
}
