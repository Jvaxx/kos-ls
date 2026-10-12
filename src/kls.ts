import {
  Position,
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
  CodeAction,
  CodeActionKind,
  CodeActionParams,
  WorkspaceEdit,
  SemanticTokens,
  SemanticTokensParams,
  SemanticTokensRangeParams,
  CodeLens,
  CodeLensParams,
  CodeLensRefreshRequest,
  ExecuteCommandParams,
  MessageType,
  ShowMessageNotification,
} from 'vscode-languageserver';
import { DiskUsage, usageDetails, usageSummary } from './analysis/diskSize';
import { relative } from 'path';
import { semanticTokens, semanticTokensLegend } from './services/semanticTokens';
import { codeActions } from './services/codeActions';
import { ClientConfiguration, IClientCapabilities } from './types';
import { KsSymbolKind, SymbolTracker, KsBaseSymbol } from './analysis/types';
import { mockLogger, mockTracer, logException } from './models/logger';
import { empty } from './utilities/typeGuards';
import { AstContext } from './parser/scriptFind';
import * as Expr from './parser/models/expr';
import {
  diskUsageCommand,
  serverName,
  legacyServerNames,
  keywordCompletions,
  DEFAULT_BODIES,
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
import { IType, TypeKind } from './typeChecker/types';
import { FoldableService } from './services/foldableService';
import {
  AnalysisService,
  DiagnosticsByUri,
} from './services/analysisService';
import { IFindResult } from './parser/types';
import { ResolverService } from './services/resolverService';
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
import { CaseKind, LogLevel } from './utilities/enums';

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
   * Track an operation until it settles, for whenIdle. A failure is logged.
   * @param operation the operation's promise
   */
  private track(operation: Promise<unknown>): void {
    const settled = operation
      .catch((err) => logException(this.logger, this.tracer, err, LogLevel.error))
      .finally(() => this.pending.delete(settled));
    this.pending.add(settled);
  }

  /**
   * Log the failure of a message sent to the client, rather than leave its
   * rejection unhandled
   * @param operation the sending promise
   */
  private logFailure(operation: Promise<unknown>): void {
    operation.catch((err) =>
      logException(this.logger, this.tracer, err, LogLevel.warn),
    );
  }

  /**
   * Start the language server listening to requests from the client
   */
  public listen(): void {

    this.connection.onInitialize(this.onInitialize.bind(this));
    this.connection.onInitialized((params) => {
      this.track(this.onInitialized(params));
    });
    this.connection.onCompletion(this.onCompletion.bind(this));
    this.connection.onCompletionResolve(this.onCompletionResolve.bind(this));
    this.connection.onSignatureHelp(this.onSignatureHelp.bind(this));
    this.connection.onFoldingRanges(this.onFoldingRange.bind(this));
    this.connection.languages.inlayHint.on(this.onInlayHint.bind(this));
    this.connection.onDocumentFormatting(this.onFormatting.bind(this));
    this.connection.onCodeAction(this.onCodeAction.bind(this));
    this.connection.onCodeLens(this.onCodeLens.bind(this));
    this.connection.onExecuteCommand(this.onExecuteCommand.bind(this));
    this.connection.languages.semanticTokens.on((params, cancellation) =>
      this.onSemanticTokens(params, cancellation),
    );
    this.connection.languages.semanticTokens.onRange((params, cancellation) =>
      this.onSemanticTokens(params, cancellation),
    );
    this.connection.onDocumentRangeFormatting(
      this.onRangeFormatting.bind(this),
    );

    this.documentService.listen();
    this.symbolService.listen();

    this.documentService.on('change', (document) => {
      void this.onChange(document);
    });
    this.documentService.on('close', (uri) => {
      this.clearExcluded(uri);
      this.analysisService.invalidateDocument(uri);
    });
    this.documentService.on('configLoad', (load) => {
      this.track(load);
    });
    this.documentService.on('diskChange', (uri) =>
      this.analysisService.invalidateDocument(uri),
    );
    this.analysisService.on('propagate', (diagnostics) => {
      this.publishDiagnostics(diagnostics);
      this.refreshCodeLenses();
    });
    this.configurationService.on('change', (change) => {
      this.track(this.onConfigChange(change));
    });
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

    const clientCapability: IClientCapabilities = {
      hasConfiguration: false,
      hasWorkspaceFolder: false,
    };
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

    // can code lenses be refreshed when other files change
    clientCapability.hasCodeLensRefresh =
      !!capabilities.workspace?.codeLens?.refreshSupport;

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
    await this.onConfigChange(this.configurationService);

    return {
      serverInfo: {
        // The name of the server as defined by the server.
        name: serverName,

        // The servers's version as defined by the server.
        version: this.version,
      },
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Incremental,

        // Tell the client that the server supports code completion
        completionProvider: {
          resolveProvider: true,
          triggerCharacters: [':', '(', ','],
        },

        // Tell the client that the server support signature help
        signatureHelpProvider: {
          triggerCharacters: ['(', ','],
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
        codeActionProvider: {
          codeActionKinds: [CodeActionKind.QuickFix],
        },
        semanticTokensProvider: {
          legend: semanticTokensLegend,
          full: true,
          range: true,
        },
        codeLensProvider: { resolveProvider: false },
        executeCommandProvider: { commands: [diskUsageCommand] },
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
      this.logFailure(
        this.connection.client.register(
          DidChangeConfigurationNotification.type,
          { section: serverName },
        ),
      );
    }

    // watch scripts and the configuration changed outside the client
    if (clientCapability.hasWatchedFiles) {
      this.logFailure(
        this.connection.client.register(
          DidChangeWatchedFilesNotification.type,
          {
            watchers: [
              { globPattern: '**/*.ks' },
              { globPattern: '**/ksconfig.json' },
            ],
          },
        ),
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
    await this.onConfigChange(this.configurationService);

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
    try {
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
        params.length > 0 &&
        params[params.length - 1].kind === TypeKind.variadic;

      return {
        signatures: [signature],
        activeParameter: variadic ? Math.min(index, count - 1) : index,
        activeSignature: 0,
      };
    } catch (err) {
      logException(this.logger, this.tracer, err, LogLevel.error);
      return undefined;
    }
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
    try {
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

      return typeInlayHints(
        documentInfo.lexicalInfo.script.stmts,
        params.range,
      );
    } catch (err) {
      logException(this.logger, this.tracer, err, LogLevel.error);
      return undefined;
    }
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
   * This handler gives the quick fixes for the diagnostics of a range
   * @param params the document, range and diagnostics
   * @param cancellation request cancellation token
   */
  private async onCodeAction(
    params: CodeActionParams,
    cancellation: CancellationToken,
  ): Promise<Maybe<CodeAction[]>> {
    try {
      const { uri } = params.textDocument;
      const document = this.documentService.getDocument(uri);
      const documentInfo = await this.analysisService.loadInfo(uri);
      if (
        cancellation.isCancellationRequested ||
        empty(document) ||
        empty(documentInfo)
      ) {
        return undefined;
      }

      return await codeActions(
        this,
        params,
        document,
        documentInfo.lexicalInfo.script,
      );
    } catch (err) {
      logException(this.logger, this.tracer, err, LogLevel.error);
      return undefined;
    }
  }

  /**
   * This handler classifies the tokens of a document, or of a range, for
   * highlighting
   * @param params the document, and the range if any
   * @param cancellation request cancellation token
   */
  private async onSemanticTokens(
    params: SemanticTokensParams | SemanticTokensRangeParams,
    cancellation: CancellationToken,
  ): Promise<SemanticTokens> {
    const none = { data: [] };
    try {
      const { uri } = params.textDocument;
      const document = this.documentService.getDocument(uri);
      const documentInfo = await this.analysisService.loadInfo(uri);
      if (
        cancellation.isCancellationRequested ||
        empty(document) ||
        empty(documentInfo)
      ) {
        return none;
      }

      return semanticTokens(
        documentInfo.lexicalInfo,
        document,
        'range' in params ? params.range : undefined,
      );
    } catch (err) {
      logException(this.logger, this.tracer, err, LogLevel.error);
      return none;
    }
  }

  /**
   * This handler gives a lens at the top of a document with the disk
   * space it needs on a probe, stripped, with the files it runs
   * @param params the document
   * @param cancellation request cancellation token
   */
  private async onCodeLens(
    params: CodeLensParams,
    cancellation: CancellationToken,
  ): Promise<CodeLens[]> {
    try {
      const { uri } = params.textDocument;
      const usage = await this.analysisService.diskUsage(uri);
      if (cancellation.isCancellationRequested || empty(usage)) {
        return [];
      }

      return [
        {
          range: Range.create(0, 0, 0, 0),
          command: {
            title: usageSummary(usage),
            command: diskUsageCommand,
            arguments: [uri],
          },
        },
      ];
    } catch (err) {
      logException(this.logger, this.tracer, err, LogLevel.error);
      return [];
    }
  }

  /**
   * This handler runs the server's commands: the disk usage command shows
   * the size of each file a document needs
   * @param params the command and its arguments
   */
  private async onExecuteCommand(params: ExecuteCommandParams): Promise<void> {
    try {
      const [uri] = (params.arguments ?? []) as unknown[];
      if (params.command !== diskUsageCommand || typeof uri !== 'string') {
        return;
      }

      const usage = await this.analysisService.diskUsage(uri);
      if (empty(usage)) {
        return;
      }

      const root = this.configurationService.serverConfiguration.workspaceUri;
      const name = (file: string) => {
        const path = URI.parse(file).fsPath;
        return empty(root) ? path : relative(root.fsPath, path);
      };
      // a notification: the request form asks the client for a choice,
      // which some clients show as a prompt that waits for an answer
      this.logFailure(
        this.connection.sendNotification(ShowMessageNotification.type, {
        type: MessageType.Info,
          message: usageDetails(usage, name),
        }),
      );
    } catch (err) {
      logException(this.logger, this.tracer, err, LogLevel.error);
    }
  }

  /**
   * The uris of the workspace's scripts, excluded ones left out, sorted
   */
  public workspaceScripts(): string[] {
    const { workspaceConfiguration } = this.configurationService;
    return this.documentService
      .getAllDocuments()
      .map((document) => document.uri)
      .filter((uri) => !workspaceConfiguration.isExcluded(URI.parse(uri)))
      .sort();
  }

  /**
   * The disk space a script needs on a probe
   * @param uri script uri
   */
  public diskUsage(uri: string): Promise<Maybe<DiskUsage>> {
    return this.analysisService.diskUsage(uri);
  }

  /**
   * The edits renaming the symbol at a position everywhere
   * @param uri document uri
   * @param position position of the symbol
   * @param newName new name
   */
  public renameEdit(
    uri: string,
    position: Position,
    newName: string,
  ): Promise<Maybe<WorkspaceEdit>> {
    return this.symbolService.renameEdit(uri, position, newName);
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
    try {
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
    } catch (err) {
      logException(this.logger, this.tracer, err, LogLevel.error);
      return undefined;
    }
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
      .setClobberBuiltins(workspaceConfiguration.clobberBuiltins ?? false)
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
    this.refreshCodeLenses();
  }

  /**
   * Ask the client to request the code lenses again: the disk usage of a
   * file depends on the files it runs
   */
  private refreshCodeLenses(): void {
    const { clientCapability } = this.configurationService.serverConfiguration;
    if (clientCapability.hasCodeLensRefresh) {
      this.logFailure(this.connection.sendRequest(CodeLensRefreshRequest.type));
    }
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

      this.logFailure(
        this.connection.sendDiagnostics({
          uri,
          diagnostics: this.lintManager
            .apply(documentDiagnostics)
            .map(cleanDiagnostic),
        }),
      );
    }
  }

  /**
   * Clear the diagnostics of an excluded document once closed: only an
   * open excluded document has diagnostics
   * @param uri uri of the closed document
   */
  private clearExcluded(uri: string): void {
    const { workspaceConfiguration } = this.configurationService;
    if (workspaceConfiguration.isExcluded(URI.parse(uri))) {
      this.logFailure(this.connection.sendDiagnostics({ uri, diagnostics: [] }));
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
    return normalizeClientConfiguration(found);
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
    return this.symbolService.findToken(pos, uri, ...contexts);
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
   * The tracker of a called name. A call being typed often does not parse
   * yet, leaving its tokens unresolved: a function is then found by name,
   * a suffix through the type of what it is called on
   * @param tokens tokens scanned from the document
   * @param i index of the called name
   * @param uri document uri
   */
  private async calleeTracker(
    tokens: Token[],
    i: number,
    uri: string,
  ): Promise<Maybe<SymbolTracker>> {
    const tracker = await this.trackerOf(tokens[i], uri);
    if (!empty(tracker)) {
      return tracker;
    }

    if (i > 0 && tokens[i - 1].type === TokenType.colon) {
      return (await this.unresolvedType(tokens, i, uri))?.tracker();
    }

    return this.namedTracker(tokens[i], uri, [KsSymbolKind.function]);
  }

  /**
   * The tracker of the symbol a name refers to, found by name
   * @param token a token scanned from the document
   * @param uri document uri
   * @param kinds the kinds of symbol it may name
   */
  private async namedTracker(
    token: Token,
    uri: string,
    kinds: KsSymbolKind[],
  ): Promise<Maybe<SymbolTracker>> {
    const { lookup } = token;
    const symbols = [
      ...(await this.getScopedSymbols(token.start, uri)),
      ...(await this.getImportedSymbols(uri)),
    ];
    const symbol = symbols.find(
      (candidate) =>
        kinds.includes(candidate.tag) && candidate.name.lookup === lookup,
    );
    return symbol?.name.tracker;
  }

  /**
   * The type of a name in scanned tokens that the analysis may not have
   * resolved: a suffix is looked up on the value it follows (`ship:body`,
   * `ship:partsNamed("a"):length`), anything else by name
   * @param tokens tokens scanned from the document
   * @param i index of the name
   * @param uri document uri
   */
  private async unresolvedType(
    tokens: Token[],
    i: number,
    uri: string,
  ): Promise<Maybe<IType>> {
    const token = tokens[i];
    if (i > 1 && tokens[i - 1].type === TokenType.colon) {
      const receiver = await this.valueType(tokens, i - 2, uri);
      return receiver?.getSuffix(token.lookup);
    }

    const location = { uri, range: token };
    const tracker =
      (await this.trackerOf(token, uri)) ??
      (await this.namedTracker(token, uri, [
        KsSymbolKind.variable,
        KsSymbolKind.parameter,
        KsSymbolKind.lock,
        KsSymbolKind.function,
      ]));
    return tracker?.getType(location);
  }

  /**
   * The type of the value an expression of scanned tokens ends with: a
   * name, or a call (`body("Kerbin")`, `ship:partsNamed("a")`)
   * @param tokens tokens scanned from the document
   * @param end index of the last token of the expression
   * @param uri document uri
   */
  private async valueType(
    tokens: Token[],
    end: number,
    uri: string,
  ): Promise<Maybe<IType>> {
    const last = tokens[end];
    if (last.type === TokenType.bracketClose) {
      // back to the call's open bracket
      let depth = 0;
      for (let i = end; i > 0; i -= 1) {
        if (tokens[i].type === TokenType.bracketClose) depth += 1;
        if (tokens[i].type === TokenType.bracketOpen) depth -= 1;
        if (depth === 0) {
          const callee = await this.calleeTracker(tokens, i - 1, uri);
          const type = callee?.getType({ uri, range: tokens[i - 1] });
          return type?.callSignature()?.returns();
        }
      }
      return undefined;
    }

    if (last.type !== TokenType.identifier) {
      return undefined;
    }

    return (await this.unresolvedType(tokens, end, uri))?.assignmentType();
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
        case TokenType.bracketOpen: {
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
    }

    return undefined;
  }

}
