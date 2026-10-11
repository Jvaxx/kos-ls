import { OptionValues } from 'commander';
import {
  CompletionItem,
  CompletionItemKind,
  Diagnostic,
  MarkupKind,
  DiagnosticSeverity,
  DocumentSymbol,
  MessageReader,
  MessageWriter,
  Position,
  SymbolInformation,
  SymbolKind,
  TextDocumentPositionParams,
} from 'vscode-languageserver';
import {
  IPCMessageReader,
  IPCMessageWriter,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';
import { KsBaseSymbol, KsSymbolKind } from '../analysis/types';
import { KLS } from '../kls';
import * as Expr from '../parser/models/expr';
import { ParseError } from '../parser/models/parserError';
import * as SuffixTerm from '../parser/models/suffixTerm';
import { IoKind } from '../services/ioService';
import { structureType } from '../typeChecker/ksTypes/primitives/structure';
import { IType } from '../typeChecker/types';
import { tokenTrackedType } from '../typeChecker/utilities/typeUtilities';
import { DiagnosticUri } from '../types';
import {
  cleanCompletion,
  cleanLocation,
  cleanRange,
} from './clean';
import { DIAGNOSTICS, createDiagnosticUri } from './diagnosticsUtils';
import { mapper } from './mapper';
import { rangeAfter, rangeContainsPos } from './positionUtils';
import { empty } from './typeGuards';
import { presentName } from './stringUtils';
import { formatDocs, formatSignature, symbolDocs } from './documentation';

/**
 * The documentation of the items of the last completion, given on
 * `completionItem/resolve`: it is only built for the items the client
 * shows
 */
export class CompletionDocs {
  /**
   * Which completion the items belong to
   */
  private generation = 0;

  /**
   * Builders of the documentation of each item
   */
  private builders: (() => string)[] = [];

  /**
   * Forget the items of the previous completion
   */
  public reset(): void {
    this.generation += 1;
    this.builders = [];
  }

  /**
   * Give an item documentation, built when it is resolved
   * @param item completion item
   * @param build builds the documentation in Markdown
   */
  public add(item: CompletionItem, build: () => string): CompletionItem {
    item.data = { generation: this.generation, index: this.builders.length };
    this.builders.push(build);
    return item;
  }

  /**
   * Add its documentation to an item of the last completion
   * @param item completion item
   */
  public resolve(item: CompletionItem): CompletionItem {
    const { generation, index } = item.data ?? {};
    if (generation !== this.generation || typeof index !== 'number') {
      return item;
    }

    const build = this.builders[index];
    const value = build === undefined ? '' : build();
    return value === ''
      ? item
      : { ...item, documentation: { kind: MarkupKind.Markdown, value } };
  }
}

/**
 * Get the connection primitives based on the request connection type
 * @param connectionType connection type
 */
export const getConnectionPrimitives = (
  options: OptionValues,
): { writer: MessageWriter; reader: MessageReader } => {
  let reader: MessageReader;
  let writer: MessageWriter;

  if (options.nodeIpc) {
    reader = new IPCMessageReader(process);
    writer = new IPCMessageWriter(process);
  } else {
    reader = new StreamMessageReader(process.stdin);
    writer = new StreamMessageWriter(process.stdout);

    // the client is gone when it closes our stdin or stops reading our
    // stdout; without this, a failed write is logged, the log write fails
    // too, and the orphaned process spins forever
    process.stdin.on('end', () => process.exit(0));
    process.stdout.on('error', () => process.exit(0));
  }

  // stdout carries the protocol: errors go to stderr
  writer.onError(([error]) => {
    console.error('[kos-ls] write error:', error);
    process.exit(0);
  });
  writer.onClose(() => process.exit(0));
  reader.onError((error) => {
    console.error('[kos-ls] read error:', error);
  });
  reader.onClose(() => process.exit(0));

  return {
    reader,
    writer,
  };
};

const caseMap = new Map([
  ['lowercase', CaseKind.lowerCase],
  ['uppercase', CaseKind.upperCase],
  ['camelcase', CaseKind.camelCase],
  ['pascalcase', CaseKind.pascalCase],
]);

/**
 * Map a string to a case kind
 */
export const caseMapper = mapper(caseMap, 'CaseKind');

const logMap = new Map([
  ['verbose', LogLevel.verbose],
  ['info', LogLevel.info],
  ['log', LogLevel.log],
  ['warn', LogLevel.warn],
  ['error', LogLevel.error],
  ['none', LogLevel.none],
]);

/**
 * Map a string to a log level
 */
export const logMapper = mapper(logMap, 'LogLevel');

const ioEntityMap = new Map([
  [IoKind.file, CompletionItemKind.File],
  [IoKind.directory, CompletionItemKind.Folder],
]);

/**
 * Map of io kind to completion kind
 */
export const ioEntityMapper = mapper(ioEntityMap, 'IoEntity');

const symbolCompletionMap = new Map([
  [KsSymbolKind.function, CompletionItemKind.Function],
  [KsSymbolKind.parameter, CompletionItemKind.Variable],
  [KsSymbolKind.lock, CompletionItemKind.Property],
  [KsSymbolKind.variable, CompletionItemKind.Variable],
]);

/**
 * Map a ks symbol kind to a completion kind
 */
const symbolCompletionMapper = mapper(symbolCompletionMap, 'KsSymbolKind');

const symbolSymbolMap = new Map([
  [KsSymbolKind.function, SymbolKind.Function],
  [KsSymbolKind.parameter, SymbolKind.Variable],
  [KsSymbolKind.lock, SymbolKind.Object],
  [KsSymbolKind.variable, SymbolKind.Variable],
]);

/**
 * Map a ks symbol kind to a lang-server symbol kind
 */
const symbolSymbolMapper = mapper(symbolSymbolMap, 'KsSymbolKind');

/**
 * Get a list of all symbols currently in scope at the given line
 * @param analyzer analyzer instance
 * @param documentPosition the current position in the document
 * @param keywordCompletions a list of keywords to always concat
 */
export const symbolCompletionItems = async (
  analyzer: KLS,
  documentPosition: TextDocumentPositionParams,
  keywordCompletions: CompletionItem[],
): Promise<CompletionItem[]> => {
  const { position } = documentPosition;
  const { uri } = documentPosition.textDocument;

  // get all symbols currently in scope
  const localSymbols = await analyzer.getScopedSymbols(position, uri);
  const importedSymbols = await analyzer.getImportedSymbols(uri);

  const sortString = (priority: number, label: string) => `${priority}${label}`;
  const locals = sortString.bind(null, 0);
  const imports = sortString.bind(null, 1);

  const toCompletion = (
    sortLabel: (label: string) => string,
    entity: KsBaseSymbol,
  ): CompletionItem => {
    const kind = symbolCompletionMapper(entity.tag);
    const label = entity.name.lexeme;

    let type: Maybe<IType>;
    const { tracker } = entity.name;
    if (!empty(tracker)) {
      type = tracker.getType({ uri, range: entity.name });
    }
    type ??= structureType;

    const { docs, access } = symbolDocs(entity, entity.name.uri, type);
    return analyzer.completionDocs.add(
      {
        kind,
        label,
        sortText: sortLabel(label),
        detail: formatSignature(label, type, docs),
      },
      () => formatDocs(docs, access),
    );
  };

  const localCompletions = toCompletion.bind(null, locals);
  const importedCompletions = toCompletion.bind(null, imports);

  // generate completions
  return localSymbols
    .map(localCompletions)
    .concat(importedSymbols.map(importedCompletions))
    .concat(keywordCompletions)
    .map((completion) => cleanCompletion(completion));
};

/**
 * Get a list of all known suffixes give a suffix completion trigger
 * @param analyzer analyzer instance
 * @param documentPosition the current position in the document
 */
export const suffixCompletionItems = async (
  analyzer: KLS,
  documentPosition: TextDocumentPositionParams,
): Promise<CompletionItem[]> => {
  const { position } = documentPosition;
  const { uri } = documentPosition.textDocument;

  const type = await suffixReceiverType(analyzer, uri, position);

  // if type not found exit
  if (empty(type)) {
    return [];
  }

  // get all suffixes on the predicted type
  const suffixes = [...type.assignmentType().suffixes().values()];

  // generate completions, in the requested case
  return suffixes.map((suffix) => {
    const label = presentName(
      analyzer.completionCase,
      suffix.displayName ?? suffix.name,
    );
    return analyzer.completionDocs.add(
      {
        kind: empty(suffix.callSignature())
          ? CompletionItemKind.Property
          : CompletionItemKind.Method,
        label,
        detail: formatSignature(label, suffix, suffix.docs),
      },
      () => formatDocs(suffix.docs, suffix.access),
    );
  });
};

/**
 * The type whose suffix is at a position (`ship` in `ship:alt|`), as
 * suffix completion sees it
 * @param analyzer the server
 * @param uri document uri
 * @param position position in or right after the suffix
 */
export const suffixReceiverType = async (
  analyzer: KLS,
  uri: string,
  position: Position,
): Promise<Maybe<IType>> => {
  const findResult = await analyzer.findToken(position, uri, Expr.Suffix);
  if (empty(findResult) || !(findResult.node instanceof Expr.Suffix)) {
    return undefined;
  }

  const suffixResult = findContainingSuffixTerm(findResult.node, position);
  if (empty(suffixResult)) {
    return undefined;
  }

  return resolveSuffixTermType(suffixResult.parentSuffixTerm);
};

const resolveSuffixTermType = (
  suffixTerm: SuffixTerm.SuffixTerm,
): Maybe<IType> => {
  const { atom } = suffixTerm;
  let type: Maybe<IType>;

  if (atom instanceof SuffixTerm.Literal) {
    type = tokenTrackedType(atom.token);
  } else if (atom instanceof SuffixTerm.Identifier) {
    type = tokenTrackedType(atom.token);
  } else if (atom instanceof SuffixTerm.Grouping) {
    type = tokenTrackedType(atom.open);
  } else {
    type = structureType;
  }

  return type;
};

const findContainingSuffixTerm = (
  suffix: Expr.Suffix,
  pos: Position,
): Maybe<FindSuffixTerm> => {
  if (empty(suffix.trailer) || rangeContainsPos(suffix.suffixTerm, pos)) {
    return undefined;
  }

  return findContainingSuffixTermTrailer(suffix, suffix.trailer, pos);
};

interface FindSuffixTerm {
  parentSuffixTerm: SuffixTerm.SuffixTerm;
  suffixTerm: SuffixTerm.SuffixTerm;
}

const findContainingSuffixTermTrailer = (
  parent: Expr.Suffix | SuffixTerm.SuffixTrailer,
  suffixTrailer: SuffixTerm.SuffixTrailer,
  pos: Position,
): Maybe<FindSuffixTerm> => {
  if (
    rangeContainsPos(suffixTrailer.suffixTerm, pos) ||
    rangeAfter(suffixTrailer.suffixTerm, pos)
  ) {
    return {
      parentSuffixTerm: parent.suffixTerm,
      suffixTerm: suffixTrailer.suffixTerm,
    };
  }

  if (!empty(suffixTrailer.trailer)) {
    return findContainingSuffixTermTrailer(
      suffixTrailer,
      suffixTrailer.trailer,
      pos,
    );
  }

  return undefined;
};

/**
 * Create lang server document symbols from ks symbols
 * @param analyzer analyzer instance
 * @param documentSymbol document identifier
 */
export function toSymbolInformation(
  entities: KsBaseSymbol[],
): Maybe<SymbolInformation[]> {
  return entities.map((entity) => {
    const kind: Maybe<SymbolKind> = symbolSymbolMapper(entity.tag);

    const symbol: SymbolInformation = {
      kind,
      name: entity.name.lexeme,
      location: cleanLocation({
        uri: entity.name.uri,
        range: entity.range,
      }),
    };

    return symbol;
  });
}

export function toDocumentSymbol(
  entities: KsBaseSymbol[],
): Maybe<DocumentSymbol[]> {
  return entities.map((entity) => {
    const kind: Maybe<SymbolKind> = symbolSymbolMapper(entity.tag);

    const symbol: DocumentSymbol = {
      kind,
      name: entity.name.lexeme,
      range: cleanRange(entity.range),
      selectionRange: cleanRange(entity.name),
    };

    return symbol;
  });
}

/**
 * Convert parser error to diagnostic
 * @param error parser error
 * @param uri uri string
 */
export const parseToDiagnostics = (
  error: ParseError,
  diagnostics: DiagnosticUri[] = [],
): DiagnosticUri[] => {
  diagnostics.push(
    createDiagnosticUri(
      error.token,
      error.message,
      DiagnosticSeverity.Error,
      DIAGNOSTICS.PARSER_ERROR,
    ),
  );

  for (const inner of error.inner) {
    parseToDiagnostics(inner, diagnostics);
  }

  return diagnostics;
};

/**
 * convert resolver error to diagnostic
 * @param error diagnostic
 * @param uri uri string
 */
export const addDiagnosticsUri = (
  error: Diagnostic,
  uri: string,
): DiagnosticUri => {
  return { uri, ...error };
};
