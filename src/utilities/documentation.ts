import {
  ParameterInformation,
  SignatureInformation,
  MarkupKind,
} from 'vscode-languageserver';
import { IType, TypeDocs, Access, TypeKind } from '../typeChecker/types';
import { UnionType } from '../typeChecker/models/types/unionType';
import { VariadicType } from '../typeChecker/models/types/variadicType';
import { KsSymbol, KsSymbolKind } from '../analysis/types';
import { kosTypes } from '../typeChecker/initialize';
import { builtIn } from './constants';

/**
 * What is shown about a symbol besides its type
 */
export interface SymbolDocs {
  /**
   * Name of the symbol as it is presented
   */
  name: string;

  /**
   * Its documentation, if any
   */
  docs?: TypeDocs;

  /**
   * Its access, for properties
   */
  access?: Access;
}

/**
 * Builtin variables by lowercase name: they share their types, so their
 * docs are kept apart
 */
let builtinVariables: Maybe<Map<string, { docs: TypeDocs; access?: Access }>>;

/**
 * The documentation of a symbol
 * @param symbol the symbol
 * @param uri uri of its declaration
 * @param type its type
 */
export const symbolDocs = (
  symbol: KsSymbol,
  uri: string,
  type: IType,
): SymbolDocs => {
  const { name } = symbol;
  const lexeme = typeof name === 'string' ? name : name.lexeme;

  switch (symbol.tag) {
    case KsSymbolKind.suffix:
      // the type is the suffix itself
      return {
        name: type.displayName ?? lexeme,
        docs: type.docs,
        access: type.access,
      };
    case KsSymbolKind.function:
      return { name: lexeme, docs: type.docs };
    case KsSymbolKind.variable:
    case KsSymbolKind.lock:
      if (uri === builtIn) {
        builtinVariables ??= new Map(
          kosTypes().variables.map((variable) => [
            variable.name.toLowerCase(),
            variable,
          ]),
        );
        const builtin = builtinVariables.get(lexeme.toLowerCase());
        return { name: lexeme, docs: builtin?.docs, access: builtin?.access };
      }
      return { name: lexeme };
    default:
      return { name: lexeme };
  }
};

/**
 * A parameter of a call signature, ready to be shown
 */
export interface ParameterLabel {
  /**
   * The parameter as written in a signature, e.g. `dv: Scalar`
   */
  label: string;

  /**
   * Description in Markdown
   */
  doc?: string;
}

/**
 * Write a type as it is written in doc comment tags: optional parameters
 * lose their `None`, unions use `|`
 * @param type the type
 */
const typeText = (type: IType): string => {
  if (type instanceof VariadicType) {
    return type.base.toString();
  }
  if (type instanceof UnionType) {
    return type.types
      .filter((member) => !member.noneType)
      .map(typeText)
      .join(' | ');
  }
  return type.toString();
};

/**
 * Is this type called rather than read or set
 * @param type the type
 */
export const isCallable = (type: IType): boolean =>
  type.callSignature() !== undefined && !type.access.get && !type.access.set;

/**
 * The parameters of a callable type, named from its docs when they are
 * known
 * @param type callable type
 * @param docs documentation of the type
 */
export const parameterLabels = (
  type: IType,
  docs?: TypeDocs,
): ParameterLabel[] => {
  const signature = type.callSignature();
  if (signature === undefined) {
    return [];
  }

  return signature.params().map((param, i) => {
    const { name, doc } = docs?.params?.[i] ?? {};
    const variadic = param.kind === TypeKind.variadic;
    const optional = !variadic && param.noneType;
    const text = typeText(param);

    let label: string;
    if (name === undefined) {
      label = variadic ? `...${text}` : optional ? `${text}?` : text;
    } else {
      label = `${variadic ? '...' : ''}${name}${optional ? '?' : ''}: ${text}`;
    }
    return { label, doc };
  });
};

/**
 * The signature of a symbol: `name(params): Returns` for a call,
 * `name: Type` otherwise
 * @param name name of the symbol
 * @param type its type
 * @param docs its documentation
 */
export const formatSignature = (
  name: string,
  type: IType,
  docs?: TypeDocs,
): string => {
  if (!isCallable(type)) {
    return `${name}: ${type.toString()}`;
  }

  const params = parameterLabels(type, docs)
    .map((param) => param.label)
    .join(', ');
  const returns = type.callSignature()!.returns();
  return returns.noneType
    ? `${name}(${params})`
    : `${name}(${params}): ${typeText(returns)}`;
};

/**
 * The documentation of a symbol in Markdown, without its signature:
 * access, units, description, parameters and a link to the kOS
 * documentation
 * @param docs documentation of the symbol
 * @param access access of the symbol, shown for properties
 */
export const formatDocs = (docs?: TypeDocs, access?: Access): string => {
  const sections: string[] = [];

  const facts: string[] = [];
  if (access !== undefined && (access.get || access.set)) {
    const modes = [access.get && 'get', access.set && 'set'].filter(Boolean);
    facts.push(`Access: ${modes.join(', ')}`);
  }
  if (docs?.units !== undefined) {
    facts.push(`Units: ${docs.units}`);
  }
  if (facts.length > 0) {
    sections.push(`*${facts.join(' · ')}*`);
  }

  if (docs?.doc !== undefined) {
    sections.push(docs.doc);
  }

  const params = (docs?.params ?? []).filter(
    (param) => param.name !== undefined && param.doc !== undefined,
  );
  if (params.length > 0) {
    sections.push(
      params.map((param) => `- \`${param.name}\`: ${param.doc}`).join('\n'),
    );
  }

  if (docs?.url !== undefined) {
    sections.push(`[kOS documentation](${docs.url})`);
  }

  return sections.join('\n\n');
};

/**
 * A hover in Markdown: the signature in a code block, then the
 * documentation
 * @param kind kind of symbol, e.g. `function`
 * @param name name of the symbol
 * @param type its type
 * @param docs its documentation
 * @param access its access, shown for properties
 */
export const formatHover = (
  kind: string,
  name: string,
  type: IType,
  docs?: TypeDocs,
  access?: Access,
): string => {
  const signature = `(${kind}) ${formatSignature(name, type, docs)}`;
  const body = formatDocs(docs, access);
  const block = '```kerboscript\n' + signature + '\n```';
  return body === '' ? block : `${block}\n\n${body}`;
};

/**
 * Signature help for a call: the signature, with the range of each
 * parameter in it, and the documentation
 * @param name name of the called symbol
 * @param type its type
 * @param docs its documentation
 */
export const signatureInformation = (
  name: string,
  type: IType,
  docs?: TypeDocs,
): SignatureInformation => {
  const params = parameterLabels(type, docs);
  const returns = type.callSignature()?.returns();

  // the label is built here to know where each parameter is
  let label = `${name}(`;
  const parameters: ParameterInformation[] = params.map((param, i) => {
    if (i > 0) {
      label += ', ';
    }
    const start = label.length;
    label += param.label;
    const range: [number, number] = [start, label.length];
    return param.doc === undefined
      ? { label: range }
      : {
          label: range,
          documentation: { kind: MarkupKind.Markdown, value: param.doc },
        };
  });
  label += ')';
  if (returns !== undefined && !returns.noneType) {
    label += `: ${typeText(returns)}`;
  }

  const body = formatDocs(docs);
  return body === ''
    ? { label, parameters }
    : {
        label,
        documentation: { kind: MarkupKind.Markdown, value: body },
        parameters,
      };
};
