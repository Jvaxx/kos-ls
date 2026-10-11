import {
  DiagnosticUri,
  DocumentInfo,
  LexicalInfo,
  SemanticInfo,
  DependencyInfo,
} from '../types';
import { SymbolTable } from '../analysis/models/symbolTable';
import { IScript } from '../parser/types';
import { SymbolTableBuilder } from '../analysis/models/symbolTableBuilder';
import { PreResolver } from '../analysis/preResolver';
import { TypeChecker } from '../typeChecker/typeChecker';
import { empty } from '../utilities/typeGuards';
import { Scanner } from '../scanner/scanner';
import { Parser } from '../parser/parser';
import { DiagnosticSeverity, Location } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { addDiagnosticsUri } from '../utilities/serverUtils';
import { DocumentService } from './documentService';
import { logException } from '../models/logger';
import { Resolver } from '../analysis/resolver';
import {
  standardLibraryBuilder,
  bodyLibraryBuilder,
} from '../analysis/standardLibrary';
import { ControlFlow } from '../controlFlow/controlFlow';
import { runPath, normalizeExtensions } from '../utilities/pathUtils';
import { ResolverService } from './resolverService';
import { Graph } from '../models/graph';
import {
  byteSize,
  DiskUsage,
  FileSize,
  strippedText,
} from '../analysis/diskSize';
import { scc } from '../utilities/graphUtils';
import {
  DIAGNOSTICS,
  createDiagnosticUri,
} from '../utilities/diagnosticsUtils';
import { EventEmitter } from 'events';
import { DEFAULT_BODIES } from '../utilities/constants';
import { directiveParser } from '../directives/directiveParser';

/**
 * Diagnostics of a set of analysed documents, with every analysed
 * document present (possibly with no diagnostics, to clear old ones)
 */
export type DiagnosticsByUri = Map<string, DiagnosticUri[]>;

type PropagateHandler = (diagnostics: DiagnosticsByUri) => void;

export declare interface AnalysisService {
  on(event: 'propagate', listener: PropagateHandler): this;
  emit(event: 'propagate', ...args: Parameters<PropagateHandler>): boolean;
}

/**
 * Lexical information with the text it was computed from
 */
interface LexicalEntry {
  text: string;
  info: LexicalInfo;
}

/**
 * The documents a document depends on
 */
interface Edges {
  /** normalized uris of the documents it runs, includes or preloads */
  uris: string[];
  /** diagnostics about paths that cannot be followed */
  diagnostics: DiagnosticUri[];
}

/**
 * Delay between the last change and the reanalysis of the documents it
 * affects
 */
const PROPAGATION_DELAY = 200;

/**
 * Analyses the documents of a workspace: lexical analysis of each file,
 * dependencies between files (run statements, include directives and
 * preloaded files), then semantic analysis.
 *
 * kOS globals are visible across files in both directions: a script sees
 * the globals of the scripts it runs, and of the scripts that run it. So
 * a change to a document can change the analysis of every document
 * connected to it. Such documents are marked dirty; they are reanalysed
 * before their information is returned, and in the background shortly
 * after the change, which publishes their new diagnostics.
 *
 * Analysis jobs run one at a time, as symbol tables of different
 * documents are linked together and must not be rebuilt concurrently.
 */
export class AnalysisService extends EventEmitter {
  private readonly logger: ILogger;
  private readonly tracer: ITracer;
  private readonly documentService: DocumentService;
  private readonly resolverService: ResolverService;

  private readonly lexicalCache: Map<string, LexicalEntry>;
  private readonly semanticCache: Map<string, SemanticInfo>;
  private readonly dependencyCache: Map<string, DependencyInfo>;

  /**
   * Documents whose semantic information must be recomputed
   */
  private readonly dirty: Set<string>;

  /**
   * Documents analysed outside a propagation, against tables that may
   * change: everything connected to them is rebuilt at the next one
   */
  private readonly stale: Set<string>;

  /**
   * Normalized uris of the preloaded files
   */
  private preload: string[];

  /**
   * Tail of the queue of analysis jobs
   */
  private queue: Promise<unknown>;

  /**
   * Pending background reanalysis, and the promise of its completion
   */
  private propagation?: {
    timer: NodeJS.Timeout;
    done: Promise<void>;
    resolve: () => void;
  };

  /**
   * The preloaded files and the files they run, once computed
   */
  private preloadClosure?: Set<string>;

  private standardLibrary: SymbolTable;
  private bodyLibrary: SymbolTable;
  private caseKind: CaseKind;
  private celestialBodies: string[];

  /**
   * May declarations hide builtins without `@clobberbuiltins on.`
   */
  private clobberBuiltins = false;

  /**
   * Construct a new analysis service
   * @param caseKind the typing case of the build in standard and body libraries
   * @param logger A logger to log performance and exception
   * @param tracer a tracer to location exceptions
   * @param documentService The document service to load new files from disk
   * @param resolverService A service to resolver kos paths
   */
  constructor(
    caseKind: CaseKind,
    logger: ILogger,
    tracer: ITracer,
    documentService: DocumentService,
    resolverService: ResolverService,
  ) {
    super();

    this.logger = logger;
    this.tracer = tracer;
    this.documentService = documentService;
    this.resolverService = resolverService;

    this.lexicalCache = new Map();
    this.semanticCache = new Map();
    this.dependencyCache = new Map();
    this.dirty = new Set();
    this.stale = new Set();
    this.preload = [];
    this.queue = Promise.resolve();

    this.caseKind = caseKind;
    this.celestialBodies = DEFAULT_BODIES;
    this.standardLibrary = standardLibraryBuilder(caseKind);
    this.bodyLibrary = bodyLibraryBuilder(caseKind, DEFAULT_BODIES);
  }

  /**
   * Set the case of the body library and standard library
   * @param caseKind case to set
   */
  public setCase(caseKind: CaseKind): this {
    if (this.caseKind !== caseKind) {
      this.caseKind = caseKind;
      this.standardLibrary = standardLibraryBuilder(caseKind);
      this.bodyLibrary = bodyLibraryBuilder(caseKind, this.celestialBodies);
      this.invalidateAll();
    }

    return this;
  }

  /**
   * Set the current bodies that should be completed
   * @param bodies
   */
  public setBodies(bodies: string[]): this {
    const current = new Set(this.celestialBodies);
    if (
      bodies.length !== current.size ||
      bodies.some((body) => !current.has(body))
    ) {
      this.celestialBodies = bodies;
      this.bodyLibrary = bodyLibraryBuilder(this.caseKind, bodies);
      this.invalidateAll();
    }

    return this;
  }

  /**
   * Set the files run before every script. Their globals, and those of
   * the files they run, are visible in every other file.
   * @param uris preloaded files
   */
  /**
   * Set whether declarations may hide builtins without the directive
   * @param clobberBuiltins kOS's `Config:CLOBBERBUILTINS`
   */
  public setClobberBuiltins(clobberBuiltins: boolean): this {
    if (clobberBuiltins !== this.clobberBuiltins) {
      this.clobberBuiltins = clobberBuiltins;
      this.invalidateAll();
    }

    return this;
  }

  public setPreload(uris: URI[]): this {
    const preload = uris
      .map((uri) => normalizeExtensions(uri))
      .filter((uri): uri is string => !empty(uri));

    if (preload.join('\n') !== this.preload.join('\n')) {
      this.preload = preload;
      this.invalidateAll();
    }

    return this;
  }

  /**
   * Forget everything computed so far, e.g. when path resolution changed.
   * Lexical information is kept, as it only depends on the text.
   */
  public invalidateAll(): void {
    for (const uri of this.lexicalCache.keys()) {
      this.dirty.add(uri);
    }
    this.preloadClosure = undefined;
  }

  /**
   * Analyse a document whose text changed in the client, and schedule the
   * reanalysis of the documents it affects
   * @param uri uri of the document
   * @param text source text of the document
   */
  public analyzeDocument(uri: string, text: string): Promise<DiagnosticUri[]> {
    return this.enqueue(async () => {
      try {
        this.markAffected(uri);
        // dependencies are only stale for the globals of this document:
        // their cached tables do until the propagation
        const info = await this.analyzeLexical(
          uri,
          this.analyzeLexicon(uri, text),
          new Set(),
          true,
        );
        this.schedulePropagation();
        return this.documentInfoDiagnostics(info);
      } catch (err) {
        logException(this.logger, this.tracer, err, LogLevel.error);
        return [];
      }
    });
  }

  /**
   * A document changed outside the client (on disk), or was closed:
   * forget its text and reanalyse what it affects
   * @param uri uri of the document
   */
  public invalidateDocument(uri: string): void {
    this.markAffected(uri);
    this.lexicalCache.delete(uri);
    this.schedulePropagation();
  }

  /**
   * Get up to date information about a document, analysing it if needed
   * @param uri document uri
   */
  public loadInfo(uri: string): Promise<Maybe<DocumentInfo>> {
    return this.enqueue(async () => {
      try {
        return await this.freshInfo(uri);
      } catch (err) {
        logException(this.logger, this.tracer, err, LogLevel.error);
        return undefined;
      }
    });
  }

  /**
   * Get the information computed so far about a document, if any, even
   * if it is out of date
   * @param uri document uri
   */
  public getInfo(uri: string): Maybe<DocumentInfo> {
    const lexical = this.lexicalCache.get(uri);
    const semanticInfo = this.semanticCache.get(uri);
    const dependencyInfo = this.dependencyCache.get(uri);

    if (empty(lexical) || empty(semanticInfo) || empty(dependencyInfo)) {
      return undefined;
    }

    return { lexicalInfo: lexical.info, semanticInfo, dependencyInfo };
  }

  /**
   * Load and analyse every document in the workspace
   */
  public loadDirectory(): Promise<DiagnosticsByUri> {
    return this.enqueue(async () => {
      try {
        await this.documentService.cacheDocuments();
        for (const document of this.documentService.getAllDocuments()) {
          this.dirty.add(document.uri);
        }
        return await this.analyzeDirty();
      } catch (err) {
        logException(this.logger, this.tracer, err, LogLevel.error);
        return new Map();
      }
    });
  }

  /**
   * Resolve once every queued and scheduled analysis is done
   */
  public async whenIdle(): Promise<void> {
    while (true) {
      const queue = this.queue;
      await queue;
      if (!empty(this.propagation)) {
        await this.propagation.done;
      } else if (queue === this.queue) {
        return;
      }
    }
  }

  /**
   * Run an analysis job after the previous ones
   * @param job analysis job
   */
  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const result = this.queue.then(job);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /**
   * Reanalyse the dirty documents shortly, unless more changes come
   */
  private schedulePropagation(): void {
    let done: Promise<void>;
    let resolve: () => void;

    if (!empty(this.propagation)) {
      // postpone the pending propagation
      clearTimeout(this.propagation.timer);
      ({ done, resolve } = this.propagation);
    } else {
      let resolveDone!: () => void;
      done = new Promise<void>((r) => (resolveDone = r));
      resolve = resolveDone;
    }

    const timer = setTimeout(() => {
      this.propagation = undefined;
      this.enqueue(async () => {
        try {
          const diagnostics = await this.analyzeDirty();
          if (diagnostics.size > 0) {
            this.emit('propagate', diagnostics);
          }
        } catch (err) {
          logException(this.logger, this.tracer, err, LogLevel.error);
        }
      }).finally(resolve);
    }, PROPAGATION_DELAY);

    this.propagation = { timer, done, resolve };
  }

  /**
   * Mark dirty every document whose analysis can depend on a document:
   * all the documents connected to it through dependencies
   * @param uri document uri
   */
  private markAffected(uri: string): void {
    const neighbours = this.cachedNeighbours();
    const stack = [uri];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (this.dirty.has(current) && current !== uri) {
        continue;
      }
      this.dirty.add(current);
      for (const next of neighbours.get(current) ?? []) {
        if (!this.dirty.has(next)) {
          stack.push(next);
        }
      }
    }
  }

  /**
   * The documents linked to each document by the dependencies of the
   * last analyses, in both directions
   */
  private cachedNeighbours(): Map<string, Set<string>> {
    const neighbours = new Map<string, Set<string>>();
    const link = (a: string, b: string) => {
      neighbours.set(a, (neighbours.get(a) ?? new Set()).add(b));
    };

    for (const [source, info] of this.dependencyCache) {
      for (const sink of this.edgesOf(info)) {
        link(source, sink);
        link(sink, source);
      }
    }

    return neighbours;
  }

  /**
   * Reanalyse every dirty or stale document, and every document
   * connected to them, dependencies first
   *
   * A document can use globals of the documents that run it, which only
   * exist once those are analysed. So when documents depend on each
   * other, all are analysed a second time in the same order: dependencies
   * see their dependents, and the usages dependents record in the symbol
   * tables of their dependencies are recorded in the final tables.
   *
   * Which file of a cycle declares a global set in several of them
   * depends on which tables exist when each is analysed. So the tables of
   * the connected documents are rebuilt from scratch, in an order that
   * only depends on the documents: the result does not depend on what
   * was analysed before, or in which order the client opened them.
   */
  private async analyzeDirty(): Promise<DiagnosticsByUri> {
    const neighbours = this.cachedNeighbours();
    const lexical = new Map<string, LexicalInfo>();
    const edges = new Map<string, Edges>();

    const pending = [...this.dirty, ...this.stale];
    const seen = new Set(pending);
    while (pending.length > 0) {
      const uri = pending.pop()!;
      const info = await this.lexical(uri);
      if (empty(info)) {
        this.forget(uri);
        continue;
      }

      const documentEdges = await this.edges(uri, info);
      lexical.set(uri, info);
      edges.set(uri, documentEdges);
      for (const next of [
        ...documentEdges.uris,
        ...(neighbours.get(uri) ?? []),
      ]) {
        if (!seen.has(next)) {
          seen.add(next);
          pending.push(next);
        }
      }
    }

    const uris = [...lexical.keys()].sort();
    for (const uri of uris) {
      this.semanticCache.get(uri)?.symbolTable.removeSelf();
      this.semanticCache.delete(uri);
      this.dirty.add(uri);
    }

    // dependency graph of the documents
    const graph = new Graph(...uris);
    for (const uri of uris) {
      for (const sink of edges.get(uri)!.uris) {
        if (graph.hasNode(sink)) {
          graph.addEdge(uri, sink);
        }
      }
    }

    // components are in topological order: dependents first
    const order = scc(graph)
      .components.reverse()
      .flatMap((component) => [...component]);

    const linked = [...edges.values()].some(
      (documentEdges) => documentEdges.uris.length > 0,
    );
    const passes = linked ? [...order, ...order] : order;

    const results: DiagnosticsByUri = new Map();
    for (const uri of passes) {
      const info = await this.analyzeLexical(uri, lexical.get(uri)!);
      results.set(uri, this.documentInfoDiagnostics(info));
    }

    this.stale.clear();
    return results;
  }

  /**
   * Up to date information about a document
   * @param uri document uri
   */
  private async freshInfo(uri: string): Promise<Maybe<DocumentInfo>> {
    const cached = this.getInfo(uri);
    const document = this.documentService.getDocument(uri);
    if (
      !empty(cached) &&
      !this.dirty.has(uri) &&
      (empty(document) ||
        this.lexicalCache.get(uri)?.text === document.getText())
    ) {
      return cached;
    }

    const lexicalInfo = await this.lexical(uri);
    if (empty(lexicalInfo)) {
      return undefined;
    }
    return this.analyzeLexical(uri, lexicalInfo);
  }

  /**
   * Analyse the dependencies and semantics of a document
   * @param uri document uri
   * @param lexicalInfo the lexical information of the document
   * @param visiting documents being analysed up the stack, to stop at cycles
   * @param allowStale use the cached tables of dependencies even if dirty
   */
  private async analyzeLexical(
    uri: string,
    lexicalInfo: LexicalInfo,
    visiting: Set<string> = new Set(),
    allowStale = false,
  ): Promise<DocumentInfo> {
    visiting.add(uri);
    const edges = await this.edges(uri, lexicalInfo);

    const dependencyTables = new Set([this.standardLibrary, this.bodyLibrary]);
    for (const dependency of edges.uris) {
      const table = await this.dependencyTable(dependency, visiting, allowStale);
      if (!empty(table)) {
        dependencyTables.add(table);
      }
    }

    const dependencyInfo: DependencyInfo = {
      dependencyTables,
      diagnostics: edges.diagnostics,
    };
    const semanticInfo = this.analyzeSemantics(
      uri,
      lexicalInfo.script,
      dependencyTables,
    );

    this.dependencyCache.set(uri, dependencyInfo);
    this.semanticCache.set(uri, semanticInfo);
    this.dirty.delete(uri);
    this.stale.add(uri);
    visiting.delete(uri);

    return { lexicalInfo, semanticInfo, dependencyInfo };
  }

  /**
   * The symbol table of a dependency, analysing it if needed
   * @param uri dependency uri
   * @param visiting documents being analysed up the stack
   * @param allowStale use the cached table even if dirty
   */
  private async dependencyTable(
    uri: string,
    visiting: Set<string>,
    allowStale: boolean,
  ): Promise<Maybe<SymbolTable>> {
    const cached = this.semanticCache.get(uri);
    if (
      visiting.has(uri) ||
      (!empty(cached) && (allowStale || !this.dirty.has(uri)))
    ) {
      return cached?.symbolTable;
    }

    const lexicalInfo = await this.lexical(uri);
    if (empty(lexicalInfo)) {
      return undefined;
    }

    const info = await this.analyzeLexical(uri, lexicalInfo, visiting);
    return info.semanticInfo.symbolTable;
  }

  /**
   * The documents a document depends on, with diagnostics for the paths
   * that cannot be followed
   * @param uri document uri
   * @param lexicalInfo its lexical information
   */
  private async edges(uri: string, lexicalInfo: LexicalInfo): Promise<Edges> {
    const { uris, diagnostics } = await this.runTargets(uri, lexicalInfo);

    // includes before the preloaded files: the order of the tables
    // decides which declaration of a name a lookup finds
    for (const include of lexicalInfo.directives.include) {
      const target = await this.resolveDocument(
        include.directive,
        include.includePath(),
      );
      if (typeof target === 'string') {
        uris.add(target);
      } else if (!empty(target)) {
        diagnostics.push(target);
      }
    }

    for (const preload of await this.preloadTargets(uri)) {
      uris.add(preload);
    }

    uris.delete(uri);
    return { uris: [...uris], diagnostics };
  }

  /**
   * The documents a document runs, in the order of its run statements,
   * with diagnostics for the runs that cannot be followed
   * @param uri document uri
   * @param lexicalInfo its lexical information
   */
  private async runTargets(
    uri: string,
    lexicalInfo: LexicalInfo,
  ): Promise<{ uris: Set<string>; diagnostics: DiagnosticUri[] }> {
    const uris = new Set<string>();
    const diagnostics: DiagnosticUri[] = [];

    for (const runStmt of lexicalInfo.script.runStmts) {
      const path = runPath(runStmt);
      if (typeof path !== 'string') {
        diagnostics.push(addDiagnosticsUri(path, uri));
        continue;
      }

      const target = await this.resolveDocument(runStmt.toLocation(uri), path);
      if (typeof target === 'string') {
        uris.add(target);
      } else if (!empty(target)) {
        diagnostics.push(target);
      }
    }

    uris.delete(uri);
    return { uris, diagnostics };
  }

  /**
   * The preloaded files a document depends on: all of them, unless it is
   * one, or run by one
   * @param uri document uri
   */
  private async preloadTargets(uri: string): Promise<string[]> {
    if (await this.inPreloadClosure(uri)) {
      return [];
    }

    const found: string[] = [];
    for (const preload of this.preload) {
      if (preload !== uri && !empty(await this.documentService.loadDocument(preload))) {
        found.push(preload);
      }
    }
    return found;
  }

  /**
   * The disk space a document needs on a probe: its stripped size, and
   * that of every file it runs, the preloaded files included
   * @param uri document uri
   */
  public diskUsage(uri: string): Promise<Maybe<DiskUsage>> {
    return this.enqueue(async () => {
      try {
        const files: FileSize[] = [];
        let unresolved = 0;
        const seen = new Set<string>();

        const visit = async (current: string): Promise<void> => {
          if (seen.has(current)) {
            return;
          }
          seen.add(current);

          const document =
            this.documentService.getDocument(current) ??
            (await this.documentService.loadDocument(current));
          const info = await this.lexical(current);
          if (empty(document) || empty(info)) {
            return;
          }

          const text = document.getText();
          files.push({
            uri: current,
            source: byteSize(text),
            stripped: byteSize(strippedText(text)),
          });

          const targets = await this.runTargets(current, info);
          unresolved += targets.diagnostics.length;
          for (const target of targets.uris) {
            await visit(target);
          }
        };

        // the preloaded files run first, but the script is the subject
        await visit(uri);
        for (const preload of await this.preloadTargets(uri)) {
          await visit(preload);
        }
        return files.length === 0 ? undefined : { files, unresolved };
      } catch (err) {
        logException(this.logger, this.tracer, err, LogLevel.error);
        return undefined;
      }
    });
  }

  /**
   * Resolve a path used in a document to a loadable document
   * @param location location of the run statement or include
   * @param path kOS path
   * @returns the normalized uri, a diagnostic, or nothing when paths
   * cannot be resolved yet
   */
  private async resolveDocument(
    location: Location,
    path: string,
  ): Promise<Maybe<string | DiagnosticUri>> {
    const resolution = this.resolverService.resolvePath(location, path);

    switch (resolution.kind) {
      case 'notReady':
        return undefined;
      case 'unmappedVolume':
        return createDiagnosticUri(
          location,
          `Volume ${resolution.volume}: is not mapped to a directory: ` +
            'add it to "volumes" in ksconfig.json',
          DiagnosticSeverity.Information,
          DIAGNOSTICS.LOAD_ERROR,
        );
      case 'file':
        const normalized = normalizeExtensions(resolution.uri);
        if (
          !empty(normalized) &&
          !empty(await this.documentService.loadDocument(normalized))
        ) {
          return normalized;
        }
        return createDiagnosticUri(
          location,
          `Unable to load script at ${path}`,
          DiagnosticSeverity.Information,
          DIAGNOSTICS.LOAD_ERROR,
        );
    }
  }

  /**
   * Is a document a preloaded file or run by one: such documents do not
   * depend on the preloaded files
   * @param uri document uri
   */
  private async inPreloadClosure(uri: string): Promise<boolean> {
    if (empty(this.preloadClosure)) {
      const closure = new Set<string>();
      const stack = [...this.preload];

      while (stack.length > 0) {
        const current = stack.pop()!;
        if (closure.has(current)) {
          continue;
        }
        closure.add(current);

        const info = await this.lexical(current);
        if (empty(info)) {
          continue;
        }
        for (const runStmt of info.script.runStmts) {
          const path = runPath(runStmt);
          if (typeof path === 'string') {
            const target = await this.resolveDocument(
              runStmt.toLocation(current),
              path,
            );
            if (typeof target === 'string') {
              stack.push(target);
            }
          }
        }
      }

      this.preloadClosure = closure;
    }

    return this.preloadClosure.has(uri);
  }

  /**
   * The dependency uris recorded in a dependency info
   * @param info dependency info
   */
  private *edgesOf(info: DependencyInfo): IterableIterator<string> {
    for (const table of info.dependencyTables) {
      if (table !== this.standardLibrary && table !== this.bodyLibrary) {
        yield table.uri;
      }
    }
  }

  /**
   * Lexical information about the current text of a document
   * @param uri document uri
   */
  private async lexical(uri: string): Promise<Maybe<LexicalInfo>> {
    const document =
      this.documentService.getDocument(uri) ??
      (await this.documentService.loadDocument(uri));
    if (empty(document)) {
      return undefined;
    }

    const text = document.getText();
    const cached = this.lexicalCache.get(uri);
    if (!empty(cached) && cached.text === text) {
      return cached.info;
    }

    return this.analyzeLexicon(uri, text);
  }

  /**
   * Remove a document that no longer exists
   * @param uri document uri
   */
  private forget(uri: string): void {
    this.semanticCache.get(uri)?.symbolTable.removeSelf();
    this.lexicalCache.delete(uri);
    this.semanticCache.delete(uri);
    this.dependencyCache.delete(uri);
    this.dirty.delete(uri);
    this.stale.delete(uri);
  }

  /**
   * Perform lexical analysis on the provided provided source text
   * @param uri uri to document
   * @param text source text of document
   */
  private analyzeLexicon(uri: string, text: string): LexicalInfo {
    const scanner = new Scanner(text, uri, this.logger, this.tracer);
    const {
      tokens,
      diagnostics: scanDiagnostics,
      directiveTokens,
      trailingComments,
    } = scanner.scanTokens();

    const parser = new Parser(uri, tokens, this.logger, this.tracer);
    const { script, diagnostics: parseDiagnostics } = parser.parse();

    const { directives, diagnostics: directiveDiagnostics } =
      directiveParser(directiveTokens);

    const info: LexicalInfo = {
      script,
      directives,
      tokens,
      trailingComments,
      diagnostics: [
        ...scanDiagnostics,
        ...parseDiagnostics,
        ...directiveDiagnostics,
      ],
    };

    this.lexicalCache.set(uri, { text, info });
    this.preloadClosure = undefined;
    return info;
  }

  /**
   * Perform semantic analysis on the an ast and provided dependency symbol tables
   * @param uri uri to document
   * @param script Ast of the document
   * @param tables symbol tables that are dependencies of this document
   */
  private analyzeSemantics(
    uri: string,
    script: IScript,
    tables: Set<SymbolTable>,
  ): SemanticInfo {
    const symbolTableBuilder = new SymbolTableBuilder(uri, this.logger);

    // keep the documents that depend on this one linked to the new table
    const oldSemanticInfo = this.semanticCache.get(uri);
    if (!empty(oldSemanticInfo)) {
      for (const dependent of oldSemanticInfo.symbolTable.dependentTables) {
        symbolTableBuilder.linkDependent(dependent);
      }
      oldSemanticInfo.symbolTable.removeSelf();
    }

    for (const symbolTable of tables) {
      symbolTableBuilder.linkDependency(symbolTable);
    }

    const preResolver = new PreResolver(
      script,
      symbolTableBuilder,
      this.logger,
      this.tracer,
      this.clobberBuiltins,
    );
    const resolver = new Resolver(
      script,
      symbolTableBuilder,
      this.logger,
      this.tracer,
      this.clobberBuiltins,
    );

    // functions first, as they can be called before their declaration
    const resolverDiagnostics = preResolver
      .resolve()
      .map((error) => addDiagnosticsUri(error, uri));
    resolverDiagnostics.push(
      ...resolver.resolve().map((error) => addDiagnosticsUri(error, uri)),
    );
    resolverDiagnostics.push(
      ...symbolTableBuilder
        .findUnused()
        .map((error) => addDiagnosticsUri(error, uri)),
    );

    const symbolTable = symbolTableBuilder.build();

    const flowGraph = new ControlFlow(script, this.logger, this.tracer).flow();
    const flowDiagnostics = empty(flowGraph)
      ? []
      : flowGraph
          .reachable()
          .map((diagnostic) => addDiagnosticsUri(diagnostic, uri));

    const typeDiagnostics = new TypeChecker(
      script,
      this.logger,
      this.tracer,
      this.clobberBuiltins,
    )
      .check()
      .map((error) => addDiagnosticsUri(error, uri));

    return {
      symbolTable,
      diagnostics: [
        ...flowDiagnostics,
        ...typeDiagnostics,
        ...resolverDiagnostics,
      ],
    };
  }

  /**
   * Extract all diagnostics from a document info
   * @param documentInfo document info
   */
  private documentInfoDiagnostics(
    documentInfo: DocumentInfo,
  ): DiagnosticUri[] {
    const { lexicalInfo, semanticInfo, dependencyInfo } = documentInfo;
    return [
      ...lexicalInfo.diagnostics,
      ...semanticInfo.diagnostics,
      ...dependencyInfo.diagnostics,
    ];
  }
}
