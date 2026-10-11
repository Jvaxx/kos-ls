/**
 * Build the type checker's types from the kOS database: every structure,
 * suffix, builtin function and bound variable, with its documentation.
 *
 * The primitives and the collections stay hand-written in ksTypes (they
 * have operators, indexers, coercions and type parameters, which the
 * database does not describe); the database documents them and adds the
 * suffixes they lack.
 */
import databaseJson from '../../../data/kos-1.6.0.1.json';
import { KosDatabase, ParameterEntry, SuffixEntry, Documented } from './schema';
import { mapNames, parseType, TypeExpression } from './typeExpression';
import { Access, IParametricType, IType, OperatorKind, TypeDocs, TypeKind } from '../types';
import { Type } from '../models/types/type';
import { ParametricType } from '../models/parametricTypes/parametricType';
import { Operator } from '../models/types/operator';
import {
  createArgSuffixType,
  createFunctionType,
  createSetOnlySuffixType,
  createSetSuffixType,
  createSuffixType,
  createType,
  createUnion,
  createVarFunctionType,
  createVarSuffixType,
  createVarType,
  noMap,
} from '../utilities/typeCreators';
import { structureType } from '../ksTypes/primitives/structure';
import { booleanType } from '../ksTypes/primitives/boolean';
import { scalarType } from '../ksTypes/primitives/scalar';
import { stringType } from '../ksTypes/primitives/string';
import { noneType } from '../ksTypes/primitives/none';
import { delegateType } from '../ksTypes/primitives/delegate';
import { builtInDelegateType } from '../ksTypes/primitives/builtInDelegate';
import { lexiconType } from '../ksTypes/collections/lexicon';
import { listType } from '../ksTypes/collections/list';
import { queueType } from '../ksTypes/collections/queue';
import { stackType } from '../ksTypes/collections/stack';
import { uniqueSetType } from '../ksTypes/collections/uniqueset';
import { rangeType } from '../ksTypes/collections/range';
import { enumeratorType } from '../ksTypes/collections/enumerator';
import { collectionType, enumerableType } from '../ksTypes/collections/enumerable';
import { vectorType } from '../ksTypes/collections/vector';
import { directionType } from '../ksTypes/collections/direction';
import { timeSpanType } from '../ksTypes/time/timespan';
import { timeStampType } from '../ksTypes/time/timestamp';
import { timeBaseType } from '../ksTypes/time/timebase.ts';

/**
 * The kOS database the server runs with
 */
export const kosDatabase = databaseJson as unknown as KosDatabase;

/**
 * A builtin function or bound variable
 */
export interface BuiltinSymbol {
  /** name in camel case, e.g. `missionTime` */
  name: string;

  /** words of the name, e.g. `['mission', 'time']` */
  segments: string[];

  type: IType;

  /** whether it is a lock (`throttle`), for variables */
  lock: boolean;

  /** whether it can be read and set, for variables */
  access?: Access;

  docs: TypeDocs;
}

/**
 * The types and builtins of the kOS database
 */
export interface KosTypes {
  /**
   * A structure by kOS name, in any case: `vessel`, `List`. Collections
   * get Structure elements.
   */
  structure(name: string): Maybe<IType>;

  /** builtin functions, aliases included */
  readonly functions: BuiltinSymbol[];

  /** bound variables and locks */
  readonly variables: BuiltinSymbol[];

  /** the names of the structures, as kOS writes them */
  readonly structureNames: string[];

  /**
   * The type of a type expression with kOS names in any case:
   * `vessel`, `List<Part>`, `Scalar | Vector`. Unknown names are
   * Structure, and returned.
   * @throws on malformed expressions
   */
  parse(text: string): { type: IType; unknown: string[] };
}

/**
 * Hand-written structures, by kOS name
 */
const coreTypes = new Map<string, IType | IParametricType>([
  ['Structure', structureType],
  ['Boolean', booleanType],
  ['Scalar', scalarType],
  ['String', stringType],
  ['None', noneType],
  ['Delegate', delegateType],
  // anonymous functions are typed Delegate, and are user delegates
  ['UserDelegate', delegateType],
  ['BuiltinDelegate', builtInDelegateType],
  ['Lexicon', lexiconType],
  ['List', listType],
  ['Queue', queueType],
  ['Stack', stackType],
  ['UniqueSet', uniqueSetType],
  ['Range', rangeType],
  ['Iterator', enumeratorType],
  ['Enumerable', enumerableType],
  ['Collection', collectionType],
  ['Vector', vectorType],
  ['Direction', directionType],
  ['TimeSpan', timeSpanType],
  ['TimeStamp', timeStampType],
  ['TimeBase', timeBaseType],
]);

/**
 * Database names that stand for another structure's hand-written type,
 * whose documentation is not theirs
 */
const coreAliases = new Set(['UserDelegate']);

/**
 * Words of a camel case name: `missionTime` gives `['mission', 'time']`
 * @param name camel case name
 */
export const nameSegments = (name: string): string[] =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_]+/)
    .filter((segment) => segment !== '')
    .map((segment) => segment.toLowerCase());

/**
 * Whether a type is a hand-written parametric type (`List<T>`)
 */
const isParametric = (type: IType | IParametricType): type is IParametricType =>
  type.getTypeParameters().length > 0 && type.kind !== TypeKind.typeSlot;

/**
 * Whether a type expression uses a type parameter
 */
const usesParameter = (expression: TypeExpression, parameters: string[]): boolean =>
  expression.kind === 'union'
    ? expression.types.some((t) => usesParameter(t, parameters))
    : parameters.includes(expression.name) ||
      expression.args.some((t) => usesParameter(t, parameters));

/**
 * Build the types of a database
 * @param database kOS database
 */
export function loadDatabase(database: KosDatabase): KosTypes {
  const generated = new Map<string, Type>();
  const byLowerName = new Map<string, string>();
  for (const name of Object.keys(database.structures)) {
    byLowerName.set(name.toLowerCase(), name);
  }

  const docs = (entry: Documented & { units?: string }, params?: ParameterEntry[]): TypeDocs => {
    const result: TypeDocs = {};
    if (entry.doc !== undefined) {
      result.doc = entry.doc;
    }
    if (entry.url !== undefined) {
      result.url = database.docsBase + entry.url;
    }
    if (entry.units !== undefined) {
      result.units = entry.units;
    }
    if (params !== undefined && params.some((p) => p.name || p.doc)) {
      result.params = params.map((p) => ({ name: p.name, doc: p.doc }));
    }
    return result;
  };

  // -------------------------------------------------------------------
  // types of expressions
  // -------------------------------------------------------------------

  const named = (name: string): Maybe<IType | IParametricType> =>
    coreTypes.get(name) ?? generated.get(name);

  const resolve = (expression: TypeExpression): IType => {
    if (expression.kind === 'union') {
      return createUnion(false, ...expression.types.map(resolve));
    }

    const type = named(expression.name);
    if (type === undefined) {
      return structureType;
    }
    if (isParametric(type)) {
      const [element] = expression.args;
      return type.apply(element === undefined ? structureType : resolve(element));
    }
    return type as IType;
  };

  const resolveText = (text: string): IType => resolve(parseType(text));

  const parameterType = (param: ParameterEntry): IType => {
    const type = resolveText(param.type);
    return param.optional ? createUnion(true, type, noneType) : type;
  };

  const variadicOf = (text: string): IType => {
    const type = resolveText(text);
    return createVarType(type.kind === TypeKind.basic ? type : structureType);
  };

  // -------------------------------------------------------------------
  // suffixes
  // -------------------------------------------------------------------

  const suffixTypes = (key: string, entry: SuffixEntry): Type[] => {
    const value = resolveText(entry.type);
    const params = entry.params ?? [];

    const create = (name: string): Type => {
      switch (entry.access) {
        case 'get':
          return createSuffixType(name, value);
        case 'getset':
          return createSetSuffixType(name, value);
        case 'set':
          return createSetOnlySuffixType(name, value);
        case 'call':
          if (params.some((p) => p.variadic)) {
            // a variadic parameter is only supported alone
            const only = params.length === 1 ? params[0].type : 'Structure';
            return createVarSuffixType(name, value, variadicOf(only));
          }
          return createArgSuffixType(name, value, ...params.map(parameterType));
      }
    };

    return [key, ...(entry.aliases ?? [])].map((name) => {
      const type = create(name);
      type.docs = docs(entry, entry.params);
      return type;
    });
  };

  // -------------------------------------------------------------------
  // structures
  // -------------------------------------------------------------------

  // every generated type exists before any is resolved
  for (const name of Object.keys(database.structures)) {
    if (!coreTypes.has(name)) {
      generated.set(name, createType(name));
    }
  }

  // any structure can be compared to any other
  if (structureType.getOperator(OperatorKind.equal, structureType) === undefined) {
    structureType.addOperators(
      new Operator(structureType, OperatorKind.equal, booleanType, structureType),
      new Operator(structureType, OperatorKind.notEqual, booleanType, structureType),
    );
  }

  for (const [name, structure] of Object.entries(database.structures)) {
    const type = generated.get(name);

    // hand-written: documentation, and the suffixes it lacks
    if (type === undefined) {
      const core = coreTypes.get(name)!;
      if (coreAliases.has(name)) {
        continue;
      }
      if (core instanceof Type || core instanceof ParametricType) {
        core.docs = docs(structure);
      }
      if (core instanceof Type && structure.dynamic) {
        core.dynamic = true;
      }
      const existing = core.suffixes();
      for (const [key, suffix] of Object.entries(structure.suffixes)) {
        const own = existing.get(key.toLowerCase());
        if (own !== undefined) {
          own.docs ??= docs(suffix, suffix.params);
          continue;
        }
        const expressions = [suffix.type, ...(suffix.params ?? []).map((p) => p.type)];
        if (expressions.some((text) => usesParameter(parseType(text), ['T']))) {
          continue;
        }
        const added = suffixTypes(key, suffix).filter(
          (t) => !existing.has(t.name),
        );
        if (core instanceof Type) {
          core.addSuffixes(...added.map((t) => noMap(t)));
        } else if (core instanceof ParametricType) {
          core.addSuffixes(...added.map((t) => noMap(t)));
        }
      }
      continue;
    }

    type.docs = docs(structure);
    type.dynamic = structure.dynamic;
    const parent = structure.inherits === undefined ? structureType : resolveText(structure.inherits);
    type.addSuper(noMap(parent));

    const seen = new Set<string>();
    for (const [key, suffix] of Object.entries(structure.suffixes)) {
      for (const suffixType of suffixTypes(key, suffix)) {
        if (!seen.has(suffixType.name)) {
          seen.add(suffixType.name);
          type.addSuffixes(noMap(suffixType));
        }
      }
    }
  }

  // -------------------------------------------------------------------
  // functions and variables
  // -------------------------------------------------------------------

  const functions: BuiltinSymbol[] = [];
  for (const [key, entry] of Object.entries(database.functions)) {
    const returns = resolveText(entry.returns);
    const variadic = entry.params.find((p) => p.variadic);

    for (const name of [key, ...(entry.aliases ?? [])]) {
      const type =
        variadic !== undefined
          ? createVarFunctionType(
              name,
              returns,
              variadicOf(entry.params.length === 1 ? variadic.type : 'Structure'),
            )
          : createFunctionType(name, returns, ...entry.params.map(parameterType));
      type.docs = docs(entry, entry.params);
      functions.push({ name, segments: nameSegments(name), type, lock: false, docs: type.docs });
    }
  }

  const variables: BuiltinSymbol[] = [];
  for (const [name, entry] of Object.entries(database.variables)) {
    variables.push({
      name,
      segments: nameSegments(name),
      type: resolveText(entry.type),
      lock: entry.lock === true,
      access: { get: true, set: entry.access === 'getset' },
      docs: docs(entry),
    });
  }

  return {
    structure: (name) => {
      const found = byLowerName.get(name.toLowerCase());
      return found === undefined ? undefined : resolve({ kind: 'name', name: found, args: [] });
    },
    functions,
    variables,
    structureNames: [...byLowerName.values()],
    parse: (text) => {
      const unknown: string[] = [];
      const expression = mapNames(parseType(text), (name) => {
        const found = byLowerName.get(name.toLowerCase());
        if (found === undefined) {
          unknown.push(name);
        }
        return found ?? 'Structure';
      });
      return { type: resolve(expression), unknown };
    },
  };
}
