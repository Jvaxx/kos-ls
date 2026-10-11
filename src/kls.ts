import {
  Position,
  Location,
  Range,
  Connection,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  InitializedParams,
  DidChangeConfigurationNotification,
  DidChangeWatchedFilesNotification,
  CompletionParams,
  InlayHint,
  InlayHintParams,
  CompletionItem,
  TextDocumentPositionParams,
  SignatureHelp,
  FoldingRangeParams,
  FoldingRange,
  CancellationToken,
  TextDocument,
  DocumentFormattingParams,
  DocumentRangeFormattingParams,
  TextEdit,
} from 'vscode-languageserver';
import { ClientConfiguration } from './types';
import { KsSymbolKind, SymbolTracker, KsBaseSymbol } from './analysis/types';
import { mockLogger, mockTracer, logException } from './models/logger';
import { empty } from './utilities/typeGuards';
import { ScriptFind, AstContext } from './parser/scriptFind';
import * as Expr from './parser/models/expr';
import * as Stmt from './parser/models/stmt';
import {
  builtIn,
  serverName,
  legacyServerNames,
  keywordCompletions,
  DEFAULT_BODIES,
  languageServer,
} from './utilities/constants';
import { rangeContains } from './utilities/positionUtils';
import { Scanner } from './scanner/scanner';
import { TokenType } from './models/tokentypes';
import { Token } from './models/token';
import { DocumentService } from './services/documentService';
import {
  caseMapper,
  logMapper,
  suffixCompletionItems,
  symbolCompletionItems,
  CompletionDocs,
} from './utilities/serverUtils';
import { symbolDocs, signatureInformation } from './utilities/documentation';
import { typeInlayHints } from './utilities/inlayHints';
import { formatText, formatRange, FormatResult } from './formatter/formatter';
import { findFormatOptions } from './formatter/config';
import { FormatOptions } from './formatter/options';
import { cleanDiagnostic } from './utilities/clean';
import { TypeKind } from './typeChecker/types';
import { FoldableService } from './services/foldableService';
import {
  AnalysisService,
  DiagnosticsByUri,
} from './services/analysisService';
import { IFindResult } from './parser/types';
import { ResolverService } from './services/resolverService';
import { runPath } from './utilities/pathUtils';
import { WorkspaceConfiguration } from './config/models/workspaceConfiguration';
import { LintManager } from './config/lintManager';
import {
  ServerConfiguration,
  defaultClientConfiguration,
  normalizeClientConfiguration,
} from './config/models/serverConfiguration';
import {
  ConfigurationService,
  ChangeConfiguration,
} from './services/configurationService';
import { URI } from 'vscode-uri';
import { CONFIG_DIAGNOSTICS } from './utilities/diagnosticsUtils';
import { SymbolService } from './services/symbolService';
import { IoService } from './services/ioService';

export class KLS {
  /**
   * The logger used by this and all dependencies
   */
  private readonly logger: ILogger;

  /**
   * The tracer used by this and all dependencies
   */
  private readonly tracer: ITracer;

  /**
   * Connection to the client
   */
  private readonly connection: Connection;

  /**
   * Server version
   */
  private readonly version: string;

  /**
   * The current set of lint rules
   */
  private lintManager: LintManager;

  /**
   * The current cased set of keywords for completions
   */
  private keywords: CompletionItem[];

  /**
   * The case completions are presented in
   */
  public completionCase: CaseKind;

  /**
   * Documentation of the items of the last completion
   */
  public readonly completionDocs = new CompletionDocs();

  /**
   * Has the client finished initialization, after which configuration
   * changes reload the workspace
   */
  private initialized = false;

  /**
   * Operations in progress that lead to analysis, e.g. a configuration
   * reload waiting for the file to be read
   */
  private readonly pending = new Set<Promise<unknown>>();

  /**
   * A service to handle changes to the configuration
   */
  private readonly configurationService: ConfigurationService;

  /**
   * The document service to store and manage documents
   */
  private readonly documentService: DocumentService;

  /**
   * A service to take document info and generate all foldable regions
   */
  private readonly foldableService: FoldableService;

  /**
   * A service to provide analysis against scripts
   */
  private readonly analysisService: AnalysisService;

  /**
   * A service for providing symbols when requested by the client
   */
  private readonly symbolService: SymbolService;

  /**
   * A service to resolve path in kos
   */
  private readonly resolverService: ResolverService;

  /**
   * A service for interacting with io
   */
  private readonly ioService: IoService;

  constructor(
    caseKind: CaseKind = CaseKind.camelCase,
    logger: ILogger = mockLogger,
    tracer: ITracer = mockTracer,
    connection: Connection,
    version: string,
    defaultServerConfiguration: ServerConfiguration,
    defaultWorkspaceConfiguration: WorkspaceConfiguration,
  ) {
    this.logger = logger;
    this.tracer = tracer;
    this.version = version;
    this.lintManager = LintManager.fromRules(
      [...defaultWorkspaceConfiguration.lintRules!.values()],
      new Set(Object.values(CONFIG_DIAGNOSTICS)),
    );
    this.connection = connection;
    this.keywords = keywordCompletions(caseKind);
    this.completionCase = caseKind;
    this.ioService = new IoService();
    this.resolverService = new ResolverService();
    this.documentService = new DocumentService(
      connection,
      this.ioService,
      logger,
      tracer,
    );
    this.configurationService = new ConfigurationService(
      defaultServerConfiguration,
      defaultWorkspaceConfiguration,
      connection,
      this.documentService,
    );
    this.foldableService = new FoldableService();
    this.analysisService = new AnalysisService(
      caseKind,
      this.logger,
      this.tracer,
      this.documentService,
      this.resolverService,
    );
    this.symbolService = new SymbolService(
      connection,
      this.resolverService,
      this.ioService,
      this.documentService,
      this.analysisService,
    );
  }

  /**
   * Resolves once all pending analysis is done and its diagnostics sent
   */
  public async whenIdle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all(this.pending);
    }
    await this.analysisService.whenIdle();
  }

  /**
   * Track an operation until it settles, for whenIdle
   * @param operation the operation's promise
   */
  private track<T>(operation: Promise<T>): Promise<T> {
    this.pending.add(operation);
    const untrack = () => this.pending.delete(operation);
    operation.then(untrack, untrack);
    return operation;
  }

  /**
   * Start the language server listening to requests from the client
   */
  public listen(): void {

    this.connection.onInitialize(this.onInitialize.bind(this));
    this.connection.onInitialized((params) =>
      this.track(this.onInitialized(params)),
    );
    this.connection.onCompletion(this.onCompletion.bind(this));
    this.connection.onCompletionResolve(this.onCompletionResolve.bind(this));
    this.connection.onSignatureHelp(this.onSignatureHelp.bind(this));
    this.connection.onFoldingRanges(this.onFoldingRange.bind(this));
    this.connection.languages.inlayHint.on(this.onInlayHint.bind(this));
    this.connection.onDocumentFormatting(this.onFormatting.bind(this));
    this.connection.onDocumentRangeFormatting(
      this.onRangeFormatting.bind(this),
    );

    this.documentService.listen();
    this.symbolService.listen();

    this.documentService.on('change', this.onChange.bind(this));
    this.documentService.on('close', (uri) =>
      this.analysisService.invalidateDocument(uri),
    );
    this.documentService.on('configLoad', (load) => this.track(load));
    this.documentService.on('diskChange', (uri) =>
      this.analysisService.invalidateDocument(uri),
    );
    this.analysisService.on('propagate', (diagnostics) =>
      this.publishDiagnostics(diagnostics),
    );
    this.configurationService.on('change', (change) =>
      this.track(this.onConfigChange(change)),
    );
    this.configurationService.on('error', (diagnostics, uri) =>
      this.publishDiagnostics(new Map([[uri, diagnostics]])),
    );

    this.connection.listen();
  }

  /**
   * Initialize the server from the client connection
   * @param params initialization parameters
   */
  private async onInitialize(
    params: InitializeParams,
  ): Promise<InitializeResult> {
    const { capabilities, rootPath, rootUri, workspaceFolders } = params;
    this.connection.console.log(
      `[KLS Server(${process.pid})] Started and initialize received.`,
    );

    const clientCapability: any = {};
    const serverConfiguration: Partial<Writeable<
      Pick<
        ServerConfiguration,
        'clientCapability' | 'workspaceFolder' | 'workspaceUri'
      >
    >> = {
      clientCapability,
    };

    // does the client support configurations
    clientCapability.hasConfiguration = !!capabilities.workspace?.configuration;

    // does the client support workspace folders
    clientCapability.hasWorkspaceFolder = !!capabilities.workspace
      ?.workspaceFolders;

    // can file watchers be registered
    clientCapability.hasWatchedFiles =
      !!capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration;

    // only the first workspace folder is supported
    const workspaceUri = workspaceFolders?.[0]?.uri ?? rootUri;
    if (workspaceUri) {
      serverConfiguration.workspaceUri = URI.parse(workspaceUri);
      serverConfiguration.workspaceFolder =
        serverConfiguration.workspaceUri.fsPath;
    } else if (rootPath) {
      serverConfiguration.workspaceFolder = rootPath;
    }

    this.configurationService.updateServerConfiguration(serverConfiguration);

    // the workspace configuration is read before any document is analysed,
    // as it determines how run statements are resolved
    this.documentService.workspaceUri = serverConfiguration.workspaceUri;
    await this.documentService.loadWorkspaceConfig();
    this.onConfigChange(this.configurationService);

    return {
      serverInfo: {
        // The name of the server as defined by the server.
        name: languageServer,

        // The servers's version as defined by the server.
        version: this.version,
      },
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,

        // Tell the client that the server supports code completion
        completionProvider: {
          resolveProvider: true,
          triggerCharacters: [':', '(', ', '],
        },

        // Tell the client that the server support signature help
        signatureHelpProvider: {
          triggerCharacters: ['(', ',', ', '],
        },

        // indicate other capabilities
        renameProvider: true,
        documentHighlightProvider: true,
        hoverProvider: true,
        referencesProvider: true,
        documentSymbolProvider: true,
        workspaceSymbolProvider: true,
        definitionProvider: true,
        foldingRangeProvider: true,
        inlayHintProvider: true,
        documentFormattingProvider: true,
        documentRangeFormattingProvider: true,
      },
    };
  }

  /**
   * Post initialization register additional hooks and retrieve client
   * configurations
   * @param _ initialized parameters
   */
  private async onInitialized(_: InitializedParams): Promise<void> {
    const { clientCapability } = this.configurationService.serverConfiguration;

    // register for all configuration changes.
    if (clientCapability.hasConfiguration) {
      this.connection.client.register(DidChangeConfigurationNotification.type, {
        section: serverName,
      });
    }

    // watch scripts and the configuration changed outside the client
    if (clientCapability.hasWatchedFiles) {
      this.connection.client.register(
        DidChangeWatchedFilesNotification.type,
        {
          watchers: [
            { globPattern: '**/*.{ks,KS}' },
            { globPattern: '**/ksconfig.json' },
          ],
        },
      );
    }

    // register workspace changes
    if (clientCapability.hasWorkspaceFolder) {
      this.connection.workspace.onDidChangeWorkspaceFolders(_ => {
        // TODO dump all documents
        this.logger.log('Workspace folder change event received.');
      });
    }

    const clientConfig = await this.getClientSettings();

    this.configurationService.updateServerConfiguration({ clientConfig });
    this.onConfigChange(this.configurationService);

    this.initialized = true;
    await this.reloadWorkspace();
  }

  /**
   * Respond to completion requests from the client. This handler currently provides
   * both symbol completion as well as suffix completion.
   * @param completion the parameters describing the completion request
   * @param cancellation request cancellation token
   */
  private async onCompletion(
    completion: CompletionParams,
    cancellation: CancellationToken,
  ): Promise<Maybe<CompletionItem[]>> {
    const { textDocument, position } = completion;

    try {
      // exit if cancel requested
      if (cancellation.isCancellationRequested) {
        return undefined;
      }

      this.completionDocs.reset();

      // determine if we're inside a suffix of some kind
      const result = await this.findToken(
        position,
        textDocument.uri,
        Expr.Suffix,
      );

      // exit if cancel requested
      if (cancellation.isCancellationRequested) {
        return undefined;
      }

      // if we're not in a suffix just do symbol completion
      if (empty(result) || empty(result.node)) {
        return await symbolCompletionItems(this, completion, this.keywords);
      }

      const { token, node } = result;

      // check what shouldn't happen
      if (!(node instanceof Expr.Suffix)) {
        throw new Error('Unable to find suffix');
      }

      // if we're in the atom also do symbol completion
      if (rangeContains(node.suffixTerm.atom, token)) {
        return await symbolCompletionItems(this, completion, this.keywords);
      }

      // if we're not in the atom then we need to complete with suffixes
      return suffixCompletionItems(this, completion);

      // catch any errors
    } catch (err) {
      logException(this.logger, this.tracer, err, LogLevel.error);
      return undefined;
    }
  }

  /**
   * This handler provider completion item resolution capability. This provides
   * additional information for the currently completion item selection
   * @param completionItem the item to resolve further
   */
  private onCompletionResolve(completionItem: CompletionItem): CompletionItem {
    try {
      return this.completionDocs.resolve(completionItem);
    } catch (err) {
      logException(this.logger, this.tracer, err, LogLevel.error);
      return completionItem;
    }
  }

  /**
   * This handler provides signature help suffixes and function within the document. This
   * provides extra context to the client such as the current parameter
   * @param positionParams the position of the signature request
   * @param cancellation request cancellation token
   */
  private async onSignatureHelp(
    positionParams: TextDocumentPositionParams,
    cancellation: CancellationToken,
  ): Promise<Maybe<SignatureHelp>> {
    const { position } = positionParams;
    const { uri } = positionParams.textDocument;

    // exit if cancel requested
    if (cancellation.isCancellationRequested) {
      return undefined;
    }

    const result = await this.getFunctionAtPosition(position, uri);
    if (empty(result)) {
      return undefined;
    }

    const { tracker, index } = result;

    const type = tracker.getType({
      uri,
      range: { start: position, end: position },
    });

    if (
      empty(type) ||
      (type.kind !== TypeKind.function && type.kind !== TypeKind.suffix) ||
      empty(type.callSignature())
    ) {
      return undefined;
    }

    const { symbol, uri: declaredUri } = tracker.declared;
    const { name, docs } = symbolDocs(symbol, declaredUri, type);
    const signature = signatureInformation(name, type, docs);

    // every argument past a variadic parameter is that parameter
    const count = signature.parameters?.length ?? 0;
    const params = type.callSignature()!.params();
    const variadic =
      params.length > 0 && params[params.length - 1].kind === TypeKind.variadic;

    return {
      signatures: [signature],
      activeParameter: variadic ? Math.min(index, count - 1) : index,
      activeSignature: 0,
    };
  }

  /**
   * This handler provides inlay hints: the types inferred for the
   * variables, locks and loop elements declared in the requested range
   * @param params the document and range
   * @param cancellation request cancellation token
   */
  private async onInlayHint(
    params: InlayHintParams,
    cancellation: CancellationToken,
  ): Promise<Maybe<InlayHint[]>> {
    // exit if cancel requested
    if (cancellation.isCancellationRequested) {
      return undefined;
    }

    const documentInfo = await this.analysisService.loadInfo(
      params.textDocument.uri,
    );
    if (empty(documentInfo)) {
      return undefined;
    }

    return typeInlayHints(documentInfo.lexicalInfo.script.stmts, params.range);
  }

  /**
   * This handler formats a whole document. The options come from the
   * nearest `.kos-format` or `ksconfig.json` `format` section, not from the
   * editor, so the result is the same as `kos-ls format`.
   * @param params the document
   */
  private onFormatting(params: DocumentFormattingParams): Maybe<TextEdit[]> {
    return this.format(params.textDocument.uri, (text, options) =>
      formatText(text, options),
    );
  }

  /**
   * This handler formats the lines of a range of a document
   * @param params the document and range
   */
  private onRangeFormatting(
    params: DocumentRangeFormattingParams,
  ): Maybe<TextEdit[]> {
    return this.format(params.textDocument.uri, (text, options) =>
      formatRange(text, params.range, options),
    );
  }

  /**
   * Format an open document with the options found for it
   * @param uri uri of the document
   * @param run the formatting to run
   */
  private format(
    uri: string,
    run: (text: string, options: Partial<FormatOptions>) => FormatResult,
  ): Maybe<TextEdit[]> {
    const document = this.documentService.getDocument(uri);
    if (empty(document)) {
      return undefined;
    }

    const parsed = URI.parse(uri);
    const found =
      parsed.scheme === 'file'
        ? findFormatOptions(parsed.fsPath)
        : { options: {}, errors: [] };
    for (const error of found.errors) {
      this.logger.warn(`${found.file}: ${error}`);
    }

    const result = run(document.getText(), found.options);
    if ('error' in result) {
      this.logger.warn(`Not formatting ${parsed.fsPath}: ${result.error}`);
      return undefined;
    }
    return result.edits;
  }

  /**
   * This handler provide folding region capabilities. The client will ask for available folding
   * region in which this will respond with the ranges defined by #region and #endregion
   * @param foldingParams the document to preform folding analysis on
   */
  private async onFoldingRange(
    foldingParams: FoldingRangeParams,
    cancellation: CancellationToken,
  ): Promise<Maybe<FoldingRange[]>> {
    const { uri } = foldingParams.textDocument;

    // exit if cancel requested
    if (cancellation.isCancellationRequested) {
      return undefined;
    }

    const documentInfo = await this.analysisService.loadInfo(uri);

    // exit if cancel requested or no document found
    if (cancellation.isCancellationRequested || empty(documentInfo)) {
      return undefined;
    }

    const { script, directives } = documentInfo.lexicalInfo;
    return this.foldableService.findRegions(script, [
      ...directives.region,
      ...directives.endRegion,
    ]);
  }

  /**
   * Respond to updates made to document by the client. This method
   * will parse and update the internal state of affects scripts
   * reporting errors to the client as they are discovered
   * @param document the updated document
   */
  private async onChange(document: TextDocument) {
    try {
      const diagnostics = await this.analysisService.analyzeDocument(
        document.uri,
        document.getText(),
      );

      this.publishDiagnostics(new Map([[document.uri, diagnostics]]));
    } catch (err) {
      // report any exceptions to the client
      logException(this.logger, this.tracer, err, LogLevel.error);
    }
  }

  /**
   * Updates to the server configuration and the workspace ksconfig.json
   * @param serverConfiguration the server configuration
   * @param workspaceConfiguration the workspace configuration
   */
  private async onConfigChange({
    serverConfiguration,
    workspaceConfiguration,
  }: ChangeConfiguration) {
    this.lintManager = LintManager.fromRules(
      [...workspaceConfiguration.lintRules!.values()],
      new Set(Object.values(CONFIG_DIAGNOSTICS)),
    );
    const casePreference = caseMapper(
      serverConfiguration.clientConfig.completionCase,
    );
    const logPreference = logMapper(
      serverConfiguration.clientConfig.trace.server.level,
    );

    this.keywords = keywordCompletions(casePreference);
    this.completionCase = casePreference;
    this.logger.level = logPreference;

    const { workspaceUri } = serverConfiguration;
    this.documentService.workspaceUri = workspaceUri;
    this.resolverService.rootVolume =
      workspaceConfiguration.rootVolumeUri() ?? workspaceUri;
    this.resolverService.volumes = workspaceConfiguration.volumeUris();
    this.documentService.isExcluded = (uri) =>
      workspaceConfiguration.isExcluded(uri);

    this.analysisService
      .setCase(casePreference)
      .setBodies(workspaceConfiguration.bodies ?? DEFAULT_BODIES)
      .setPreload(workspaceConfiguration.preloadUris());

    // path resolution may have changed: everything is reanalysed
    this.analysisService.invalidateAll();
    if (this.initialized) {
      await this.reloadWorkspace();
    }
  }

  /**
   * Analyse every document of the workspace and publish the diagnostics
   */
  private async reloadWorkspace() {
    this.publishDiagnostics(await this.analysisService.loadDirectory());
  }

  /**
   * Publish the diagnostics of documents, after applying the lint rules.
   * Each document present replaces its previous diagnostics, so a document
   * with none clears them.
   * @param diagnostics diagnostics by document uri
   */
  private publishDiagnostics(diagnostics: DiagnosticsByUri): void {
    const { workspaceConfiguration } = this.configurationService;
    for (const [uri, documentDiagnostics] of diagnostics) {
      if (
        workspaceConfiguration.isExcluded(URI.parse(uri)) &&
        !this.documentService.isOpen(uri)
      ) {
        continue;
      }

      this.connection.sendDiagnostics({
        uri,
        diagnostics: this.lintManager
          .apply(documentDiagnostics)
          .map(cleanDiagnostic),
      });
    }
  }

  /**
   * Get document settings from the client. If the client does not support
   * have configurations then return the default configurations.
   */
  private async getClientSettings(): Promise<ClientConfiguration> {
    const {
      clientCapability,
      workspaceUri,
    } = this.configurationService.serverConfiguration;

    if (!clientCapability.hasConfiguration) {
      return defaultClientConfiguration;
    }

    const sections = [serverName, ...legacyServerNames];
    const settings: unknown[] = await this.connection.workspace.getConfiguration(
      sections.map((section) => ({
        scopeUri: workspaceUri?.toString(),
        section,
      })),
    );

    const found = settings.find(
      (setting) => typeof setting === 'object' && setting !== null,
    );
    return normalizeClientConfiguration(found as Partial<ClientConfiguration>);
  }

  /**
   * Get the token at the provided position in the text document
   * @param pos position in the text document
   * @param uri uri of the text document
   */
  public async findToken(
    pos: Position,
    uri: string,
    ...contexts: AstContext[]
  ): Promise<Maybe<IFindResult>> {
    const documentInfo = await this.analysisService.loadInfo(uri);
    if (empty(documentInfo)) {
      return undefined;
    }

    // try to find an symbol at the position
    const { script } = documentInfo.lexicalInfo;
    const finder = new ScriptFind();
    return finder.find(script, pos, ...contexts);
  }

  /**
   * Get the declaration location for the token at the provided position
   * @param pos position in the document
   * @param uri uri of the document
   */
  public async getDeclarationLocation(
    pos: Position,
    uri: string,
  ): Promise<Maybe<Location>> {
    const documentInfo = await this.analysisService.loadInfo(uri);
    if (empty(documentInfo)) {
      return undefined;
    }

    // try to find an symbol at the position
    const { script } = documentInfo.lexicalInfo;
    const finder = new ScriptFind();
    const result = finder.find(
      script,
      pos,
      Stmt.Run,
      Stmt.RunPath,
      Stmt.RunOncePath,
    );

    if (empty(result)) {
      return undefined;
    }

    // check if symbols exists
    const { token, node } = result;
    if (empty(token.tracker)) {
      // if no tracker it might be a run statement
      if (
        node instanceof Stmt.Run ||
        node instanceof Stmt.RunPath ||
        node instanceof Stmt.RunOncePath
      ) {
        // get the kos run path
        const kosPath = runPath(node);
        if (typeof kosPath !== 'string') {
          return undefined;
        }

        const resolved = this.resolverService.resolve(
          node.toLocation(uri),
          kosPath,
        );

        if (empty(resolved)) {
          return undefined;
        }

        // resolve to the file system
        const found = this.ioService.exists(resolved);
        return (
          found &&
          Location.create(
            found.toString(),
            Range.create(Position.create(0, 0), Position.create(0, 0)),
          )
        );
      }

      return undefined;
    }

    const { declared } = token.tracker;

    // exit if undefined
    if (declared.uri === builtIn) {
      return undefined;
    }

    return typeof declared.symbol.name !== 'string'
      ? declared.symbol.name
      : undefined;
  }

  /**
   * Get all usage locations in all files
   * @param pos position in document
   * @param uri uri of document
   */
  public async getSymbolLocations(
    pos: Position,
    uri: string,
  ): Promise<Maybe<Location[]>> {
    const documentInfo = await this.analysisService.loadInfo(uri);
    if (
      empty(documentInfo) ||
      empty(documentInfo.semanticInfo.symbolTable) ||
      empty(documentInfo.lexicalInfo.script)
    ) {
      return undefined;
    }

    // try to find the symbol at the position
    const { semanticInfo, lexicalInfo } = documentInfo;
    const finder = new ScriptFind();
    const result = finder.find(lexicalInfo.script, pos);

    if (empty(result)) {
      return undefined;
    }

    // try to find the tracker at a given position
    const { token } = result;
    const tracker = semanticInfo.symbolTable.scopedNamedTracker(
      pos,
      token.lookup,
    );
    if (empty(tracker)) {
      return undefined;
    }

    return [tracker.declared, ...tracker.usages, ...tracker.sets].filter(
      location => location.uri !== builtIn,
    );
  }

  /**
   * Get all symbols locally in scope at this particular script
   * @param pos position in document
   * @param uri document uri
   */
  public async getScopedSymbols(
    pos: Position,
    uri: string,
  ): Promise<KsBaseSymbol[]> {
    const documentInfo = await this.analysisService.loadInfo(uri);

    if (empty(documentInfo)) {
      return [];
    }

    return documentInfo.semanticInfo.symbolTable.scopedSymbols(pos);
  }

  /**
   * Get all symbols imported in this particular script
   * @param uri document uri
   */
  public async getImportedSymbols(uri: string): Promise<KsBaseSymbol[]> {
    const documentInfo = await this.analysisService.loadInfo(uri);

    if (empty(documentInfo)) {
      return [];
    }

    return documentInfo.semanticInfo.symbolTable.importedSymbols();
  }

  /**
   * Get all symbols in a provided file
   * @param uri document uri
   */
  public async getAllFileSymbols(uri: string): Promise<KsBaseSymbol[]> {
    const documentInfo = await this.analysisService.loadInfo(uri);

    if (empty(documentInfo)) {
      return [];
    }

    return documentInfo.semanticInfo.symbolTable.allSymbols();
  }

  /**
   * The tracker of a called name. A call being typed often does not parse
   * yet, leaving its tokens unresolved: a function is then found by name
   * @param tokens tokens scanned from the document
   * @param i index of the called name
   * @param uri document uri
   */
  private async calleeTracker(
    tokens: Token[],
    i: number,
    uri: string,
  ): Promise<Maybe<SymbolTracker>> {
    const callee = tokens[i];
    const tracker = await this.trackerOf(callee, uri);
    if (!empty(tracker) || (i > 0 && tokens[i - 1].type === TokenType.colon)) {
      return tracker;
    }

    const lookup = callee.lookup;
    const symbols = [
      ...(await this.getScopedSymbols(callee.start, uri)),
      ...(await this.getImportedSymbols(uri)),
    ];
    const symbol = symbols.find(
      (candidate) =>
        candidate.tag === KsSymbolKind.function &&
        candidate.name.lookup === lookup,
    );
    return symbol?.name.tracker;
  }

  /**
   * The tracker of the analyzed token at the place of a scanned one
   * @param token a token scanned from the document
   * @param uri document uri
   */
  private async trackerOf(
    token: Token,
    uri: string,
  ): Promise<Maybe<SymbolTracker>> {
    // ranges include both ends: a position may also find the token
    // touching this one, so only one starting at the same place counts
    const { line, character } = token.start;
    const middle = character + Math.floor(token.lexeme.length / 2);
    for (const pos of [token.start, Position.create(line, middle)]) {
      const found = await this.findToken(pos, uri);
      if (
        !empty(found) &&
        found.token.start.line === line &&
        found.token.start.character === character
      ) {
        return found.token.tracker;
      }
    }

    return undefined;
  }

  /**
   * Get the call around a position: the tracker of the called function or
   * suffix, and the index of the argument at the position
   * @param pos position in the document
   * @param uri document uri
   */
  public async getFunctionAtPosition(
    pos: Position,
    uri: string,
  ): Promise<Maybe<{ tracker: SymbolTracker; index: number }>> {
    const document = this.documentService.getDocument(uri);
    if (empty(document)) return undefined;

    // the tokens up to the position: the call may not parse yet
    const text = document.getText(Range.create(Position.create(0, 0), pos));
    const { tokens } = new Scanner(text, uri).scanTokens();

    // walk back to each unclosed bracket, counting the commas between
    let depth = 0;
    let index = 0;
    for (let i = tokens.length - 1; i >= 0; i -= 1) {
      switch (tokens[i].type) {
        case TokenType.bracketClose:
        case TokenType.squareClose:
          depth += 1;
          break;
        case TokenType.squareOpen:
          depth = Math.max(depth - 1, 0);
          break;
        case TokenType.comma:
          if (depth === 0) index += 1;
          break;
        case TokenType.period:
        case TokenType.curlyOpen:
        case TokenType.curlyClose:
          // the statement ends here
          if (depth === 0) return undefined;
          break;
        case TokenType.bracketOpen:
          if (depth > 0) {
            depth -= 1;
            break;
          }

          // a call if the token before is a function or a suffix
          const tracker =
            i > 0 ? await this.calleeTracker(tokens, i - 1, uri) : undefined;
          if (!empty(tracker)) {
            switch (tracker.declared.symbol.tag) {
              case KsSymbolKind.function:
              case KsSymbolKind.suffix:
                return { tracker, index };
            }
          }

          // a grouping: the call, if any, is further out
          index = 0;
          break;
      }
    }

    return undefined;
  }

}
