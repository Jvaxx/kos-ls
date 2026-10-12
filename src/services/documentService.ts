import { EventEmitter } from 'events';
import {
  Connection,
  DidChangeWatchedFilesParams,
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  DidOpenTextDocumentParams,
  TextDocumentContentChangeEvent,
  TextDocumentItem,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import { join } from 'path';
import { logException, mockTracer } from '../models/logger';
import { normalizeExtensions } from '../utilities/pathUtils';
import { empty } from '../utilities/typeGuards';
import { IoService } from './ioService';
import { LogLevel } from '../utilities/enums';


type DocumentConnection = Pick<
  Connection,
  'onDidChangeTextDocument' | 'onDidCloseTextDocument' | 'onDidOpenTextDocument'
> &
  Partial<Pick<Connection, 'onDidChangeWatchedFiles'>>;

interface DocumentEvents {
  change: [document: TextDocument];
  configChange: [document: TextDocument];
  close: [uri: string];
  configLoad: [load: Promise<void>];
  diskChange: [uri: string];
}

/**
 * Name of the workspace configuration file
 */
export const configFileName = 'ksconfig.json';

/**
 * Service responsible for managing documents being loaded by the client and the server
 */
export class DocumentService extends EventEmitter<DocumentEvents> {
  /**
   * What is the root volume of this directory
   */
  public workspaceUri?: URI;

  /**
   * Files not loaded when caching the workspace
   */
  public isExcluded: (uri: URI) => boolean = () => false;

  /**
   * Currently cached documents loaded by the client
   */
  private clientDocs: Map<string, TextDocument>;

  /**
   * Current cached document only loaded by the server
   */
  private serverDocs: Map<string, TextDocument>;

  /**
   * A ksconfig.json if it exists reported by the client
   */
  private clientConfigDoc?: TextDocument;

  /**
   * A ksconfig.json if it exists read by the server
   */
  private serverConfigDoc?: TextDocument;

  /**
   * client connection with events for open, close, and change events
   */
  private conn: DocumentConnection;

  /**
   * A logger to log information to
   */
  private logger: ILogger;

  /**
   * A tracer to location exception
   */
  private tracer: ITracer;

  /**
   * A service for interacting with io
   */
  private ioService: IoService;

  /**
   * Create a new instance of the document service.
   * @param conn document connection holding the required callbacks from iconnection
   * @param ioService service to load from a provided uri
   * @param resolverService service to resolve uri for kerboscript
   * @param logger logger to log messages to client
   * @param tracer tracer to location exception
   */
  constructor(
    conn: DocumentConnection,
    ioService: IoService,
    logger: ILogger,
    tracer: ITracer,
    workspaceUri?: URI,
  ) {
    super();
    this.clientDocs = new Map();
    this.serverDocs = new Map();
    this.clientConfigDoc = undefined;
    this.serverConfigDoc = undefined;
    this.conn = conn;
    this.ioService = ioService;
    this.logger = logger;
    this.tracer = tracer;
    this.workspaceUri = workspaceUri;
  }

  /**
   * Attach to listener to connection events
   */
  public listen(): void {
    this.conn.onDidChangeTextDocument((params) => {
      this.onChangeHandler(params);
    });
    this.conn.onDidOpenTextDocument((params) => {
      this.onOpenHandler(params);
    });
    this.conn.onDidCloseTextDocument(this.onCloseHandler.bind(this));
    this.conn.onDidChangeWatchedFiles?.(this.onWatchedFilesHandler.bind(this));
  }

  /**
   * Read the configuration file at the root of the workspace, if the
   * client has not opened it, and emit a config change event. With no
   * file, the event carries an empty configuration.
   */
  public async loadWorkspaceConfig(): Promise<void> {
    if (empty(this.workspaceUri) || !empty(this.clientConfigDoc)) {
      return;
    }

    const uri = URI.file(join(this.workspaceUri.fsPath, configFileName));
    let text = '{}';
    try {
      text = await this.ioService.load(uri.fsPath);
    } catch {
      // no configuration file: defaults apply
    }

    this.serverConfigDoc = TextDocument.create(uri.toString(), 'json', 0, text);
    this.emit('configChange', this.serverConfigDoc);
  }

  /**
   * Is the document service read
   */
  public ready(): boolean {
    return !empty(this.workspaceUri);
  }

  /**
   * Get a document from this document service
   * @param uri uri to lookup document
   */
  public getDocument(uri: string): Maybe<TextDocument> {
    const normalized = normalizeExtensions(uri);

    if (empty(normalized)) {
      return undefined;
    }

    return this.clientDocs.get(normalized) || this.serverDocs.get(normalized);
  }

  /**
   * Is a document open in the client
   * @param uri document uri
   */
  public isOpen(uri: string): boolean {
    return this.clientDocs.has(uri);
  }

  /**
   * Get all document held in this service
   */
  public getAllDocuments(): TextDocument[] {
    return [...this.clientDocs.values(), ...this.serverDocs.values()];
  }

  /**
   * Attempt to load a document from a provided uri
   * @param uri the requested uri
   */
  public async loadDocument(uri: string): Promise<Maybe<TextDocument>> {
    // resolver must first be ready
    if (!this.ready()) {
      return undefined;
    }

    // attempt to load a resource from whatever uri is provided
    const normalized = normalizeExtensions(uri);
    if (empty(normalized)) {
      return undefined;
    }

    // check for cached versions first
    const cached = this.serverDocs.get(normalized);
    if (!empty(cached)) {
      return cached;
    }

    try {
      // attempt to load a resource from whatever uri is provided
      const uri = URI.parse(normalized);
      const retrieved = await this.retrieveResource(uri);
      const textDocument = TextDocument.create(normalized, 'kos', 0, retrieved);

      // if found set in cache and return document
      this.serverDocs.set(normalized, textDocument);
      return textDocument;
    } catch (err) {
      logException(this.logger, this.tracer, err, LogLevel.error);

      return undefined;
    }
  }

  /**
   * Cache all documents in the workspace.
   */
  public async cacheDocuments() {
    if (empty(this.workspaceUri)) {
      return;
    }

    try {
      for await (const { uri, text } of this.ioService.loadDirectory(
        this.workspaceUri.fsPath,
        (path) => this.isExcluded(URI.file(path)),
      )) {
        // store as sever doc if .ks
        if (uri.endsWith('.ks')) {
          const textDocument = TextDocument.create(uri, 'kos', 0, text);
          if (!this.clientDocs.has(uri)) {
            this.serverDocs.set(uri, textDocument);
          }
        }

      }
    } catch (err) {
      logException(this.logger, mockTracer, err, LogLevel.error);
    }
  }

  /**
   * Retrieve a resource from the provided uri
   * @param uri uri to load resources from
   */
  private retrieveResource(uri: URI): Promise<string> {
    const path = uri.fsPath;
    return this.ioService.load(path);
  }

  /**
   * Handle calls to open text document.
   * @param handler handler to call when did open text document events fires
   */
  private onOpenHandler(params: DidOpenTextDocumentParams): boolean {
    const document = params.textDocument;

    // emit change file if a .ks file was opened
    if (document.uri.endsWith('.ks')) {
      return this.onOpenFile(document);
    }

    // emit change config if the workspace ksconfig.json was opened
    if (this.isWorkspaceConfig(document.uri)) {
      return this.onOpenConfig(document);
    }

    return false;
  }

  /**
   * Set the client cache emit a file change event
   * @param document document to cache
   */
  private onOpenFile(document: TextDocumentItem): boolean {
    const textDocument = TextDocument.create(
      document.uri,
      document.languageId,
      document.version,
      document.text,
    );

    this.clientDocs.set(document.uri, textDocument);
    return this.emit('change', textDocument);
  }

  /**
   * Set the config cache and emit a config changed events
   * @param config config to cache
   */
  private onOpenConfig(config: TextDocumentItem): boolean {
    this.clientConfigDoc = TextDocument.create(
      config.uri,
      config.languageId,
      config.version,
      config.text,
    );

    return this.emit('configChange', this.clientConfigDoc);
  }

  /**
   * Handle calls to on change text document
   * @param handler handler to call when did change text document event fires
   */
  private onChangeHandler(params: DidChangeTextDocumentParams): boolean {
    // lookup existing document
    const document = this.getCache(params.textDocument.uri);

    if (empty(document)) {
      return false;
    }

    // generate a new updated doc, falling back if overlapping edits
    const updatedDoc = this.applyChanges(document, params.contentChanges);

    // set document cache
    return this.setCache(params, updatedDoc);
  }

  /**
   * Apply all text sequentially
   * @param document original document
   * @param changes changes to apply
   */
  private applyChanges(
    document: TextDocument,
    changes: TextDocumentContentChangeEvent[],
  ): TextDocument {
    let updatedDoc = document;

    // apply edits sequentially
    for (const change of changes) {
      const content =
        'range' in change
          ? TextDocument.applyEdits(updatedDoc, [
              {
                range: change.range,
                newText: change.text,
              },
            ])
          : change.text;

      updatedDoc = TextDocument.create(
        document.uri,
        document.languageId,
        document.version,
        content,
      );
    }

    return updatedDoc;
  }

  /**
   * Get the cached file for the requested uri
   * @param uri file uri
   */
  private getCache(uri: string): Maybe<TextDocument> {
    if (uri.endsWith('.ks')) {
      return this.clientDocs.get(uri);
    }

    if (this.isWorkspaceConfig(uri)) {
      return this.clientConfigDoc || this.serverConfigDoc;
    }

    return undefined;
  }

  /**
   * Set cached with an new text document
   * @param uri file uri
   * @param document new text document
   */
  private setCache(
    params: DidChangeTextDocumentParams,
    document: TextDocument,
  ): boolean {
    const { uri } = params.textDocument;

    if (uri.endsWith('.ks')) {
      // update cache
      this.clientDocs.set(document.uri, document);
      this.serverDocs.delete(document.uri);

      // emit change event
      return this.emit('change', document);
    }

    if (this.isWorkspaceConfig(uri)) {
      // update cache
      this.clientConfigDoc = document;

      // emit config change event
      return this.emit('configChange', document);
    }

    return false;
  }

  /**
   * On document close handler. Move document from editor docs to server docs.
   * This call notifies any provided handler
   * @param handler document closed handler
   */
  private onCloseHandler(params: DidCloseTextDocumentParams): void {
    const { uri } = params.textDocument;

    // the text on disk applies again, it is reloaded when needed
    this.clientDocs.delete(uri);
    this.serverDocs.delete(uri);

    if (uri.endsWith(configFileName) && this.clientConfigDoc?.uri === uri) {
      this.clientConfigDoc = undefined;
      this.emit('configLoad', this.loadWorkspaceConfig());
    }

    this.emit('close', uri);
  }

  /**
   * Handle files changed on disk. Open documents are managed by the
   * client and ignored.
   * @param params changed files
   */
  private onWatchedFilesHandler(params: DidChangeWatchedFilesParams): void {
    for (const { uri } of params.changes) {
      if (uri.endsWith('.ks') && !this.clientDocs.has(uri)) {
        this.serverDocs.delete(uri);
        this.emit('diskChange', uri);
      } else if (this.isWorkspaceConfig(uri)) {
        this.emit('configLoad', this.loadWorkspaceConfig());
      }
    }
  }

  /**
   * Is this the ksconfig.json at the workspace root. A ksconfig.json in a
   * subfolder is not the workspace configuration.
   * @param uri file uri
   */
  private isWorkspaceConfig(uri: string): boolean {
    return (
      uri.endsWith(configFileName) &&
      !empty(this.workspaceUri) &&
      URI.parse(uri).fsPath === join(this.workspaceUri.fsPath, configFileName)
    );
  }
}
