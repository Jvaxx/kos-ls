import { readFileSync } from 'fs';
import { join } from 'path';
import { PassThrough } from 'stream';
import {
  CompletionItem,
  createConnection,
  Diagnostic,
  Hover,
  InlayHint,
  PublishDiagnosticsParams,
  SignatureHelp,
  TextEdit,
} from 'vscode-languageserver/node';
import {
  createMessageConnection,
  MessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import { URI } from 'vscode-uri';
import { KLS } from '../../src/kls';
import { mockLogger, mockTracer } from '../../src/models/logger';
import { typeInitializer } from '../../src/typeChecker/initialize';
import { defaultServerConfiguration } from '../../src/config/models/serverConfiguration';
import { defaultWorkspaceConfiguration } from '../../src/config/models/workspaceConfiguration';

export const workspaces = join(__dirname, '../fixtures/workspaces');

export interface StartOptions {
  /** Client settings */
  settings?: object;
  /** The section the settings are returned for (default `kos-ls`) */
  section?: string;
}

/**
 * A language client driving a real KLS instance in-process, for
 * end-to-end tests of the protocol behaviour.
 */
export class TestClient {
  private readonly diagnostics = new Map<string, Diagnostic[]>();
  private readonly versions = new Map<string, number>();

  private constructor(
    public readonly root: string,
    private readonly connection: MessageConnection,
    public readonly server: KLS,
  ) {}

  /**
   * Start a server on a workspace folder and complete the initialize
   * handshake.
   * @param root absolute path of the workspace folder
   */
  static async start(
    root: string,
    options: StartOptions = {},
  ): Promise<TestClient> {
    typeInitializer();

    const up = new PassThrough();
    const down = new PassThrough();
    const serverConnection = createConnection(up, down);
    const server = new KLS(
      CaseKind.camelCase,
      mockLogger,
      mockTracer,
      serverConnection,
      'test',
      defaultServerConfiguration,
      defaultWorkspaceConfiguration,
    );
    server.listen();

    const connection = createMessageConnection(
      new StreamMessageReader(down),
      new StreamMessageWriter(up),
    );
    const client = new TestClient(root, connection, server);

    connection.onNotification(
      'textDocument/publishDiagnostics',
      (params: PublishDiagnosticsParams) =>
        client.diagnostics.set(params.uri, params.diagnostics),
    );
    connection.onNotification('window/logMessage', () => {});
    connection.onRequest('workspace/configuration', (params) =>
      params.items.map(({ section }: { section?: string }) =>
        section === (options.section ?? 'kos-ls')
          ? options.settings ?? null
          : null,
      ),
    );
    connection.onRequest('client/registerCapability', () => null);
    connection.listen();

    await connection.sendRequest('initialize', {
      processId: null,
      rootUri: URI.file(root).toString(),
      capabilities: {
        workspace: {
          configuration: true,
          didChangeWatchedFiles: { dynamicRegistration: true },
        },
      },
    });
    connection.sendNotification('initialized', {});
    return client;
  }

  uri(path: string): string {
    return URI.file(join(this.root, path)).toString();
  }

  /**
   * Open a document, with its content on disk unless text is given
   * @param path path relative to the workspace root
   */
  open(path: string, text?: string): void {
    this.versions.set(path, 1);
    this.connection.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: this.uri(path),
        languageId: 'kerboscript',
        version: 1,
        text: text ?? readFileSync(join(this.root, path), 'utf8'),
      },
    });
  }

  /**
   * Replace the whole content of an open document
   * @param path path relative to the workspace root
   */
  change(path: string, text: string): void {
    const version = (this.versions.get(path) ?? 1) + 1;
    this.versions.set(path, version);
    this.connection.sendNotification('textDocument/didChange', {
      textDocument: { uri: this.uri(path), version },
      contentChanges: [{ text }],
    });
  }

  close(path: string): void {
    this.connection.sendNotification('textDocument/didClose', {
      textDocument: { uri: this.uri(path) },
    });
  }

  /**
   * Notify the server that files changed on disk
   * @param changes paths relative to the workspace root and change type
   * (1 created, 2 changed, 3 deleted)
   */
  filesChanged(...changes: [string, 1 | 2 | 3][]): void {
    this.connection.sendNotification('workspace/didChangeWatchedFiles', {
      changes: changes.map(([path, type]) => ({ uri: this.uri(path), type })),
    });
  }

  /**
   * Wait for the server to finish all pending analysis, then return the
   * last diagnostics published for a document
   * @param path path relative to the workspace root
   */
  async diagnosticsFor(path: string): Promise<Diagnostic[]> {
    await this.settle();
    return this.diagnostics.get(this.uri(path)) ?? [];
  }

  /**
   * Messages of the diagnostics for a document, as `line:col message`
   * with 1-based positions, in document order
   * @param path path relative to the workspace root
   */
  async messages(path: string): Promise<string[]> {
    return (await this.diagnosticsFor(path))
      .slice()
      .sort(
        (a, b) =>
          a.range.start.line - b.range.start.line ||
          a.range.start.character - b.range.start.character,
      )
      .map(
        (d) =>
          `${d.range.start.line + 1}:${d.range.start.character + 1} ${
            d.message
          }`,
      );
  }

  /**
   * Wait for the server to settle, then return the last diagnostics
   * published for every document, as `uri line:col message` lines
   */
  async allMessages(): Promise<string[]> {
    await this.settle();
    return [...this.diagnostics].flatMap(([uri, diagnostics]) =>
      diagnostics.map(
        (d) =>
          `${uri} ${d.range.start.line + 1}:${d.range.start.character + 1} ` +
          d.message,
      ),
    ).sort();
  }

  /**
   * Labels of the completions at a position
   * @param path path relative to the workspace root
   */
  async completionLabels(
    path: string,
    line: number,
    character: number,
  ): Promise<string[]> {
    await this.settle();
    const items: CompletionItem[] | null = await this.connection.sendRequest(
      'textDocument/completion',
      {
        textDocument: { uri: this.uri(path) },
        position: { line, character },
      },
    );
    return (items ?? []).map((item) => item.label);
  }

  /**
   * The completions at a position
   * @param path path relative to the workspace root
   */
  async completion(
    path: string,
    line: number,
    character: number,
  ): Promise<CompletionItem[]> {
    await this.settle();
    const items: CompletionItem[] | null = await this.connection.sendRequest(
      'textDocument/completion',
      {
        textDocument: { uri: this.uri(path) },
        position: { line, character },
      },
    );
    return items ?? [];
  }

  resolve(item: CompletionItem): Promise<CompletionItem> {
    return this.connection.sendRequest('completionItem/resolve', item);
  }

  async signatureHelp(
    path: string,
    line: number,
    character: number,
  ): Promise<SignatureHelp | null> {
    await this.settle();
    return this.connection.sendRequest('textDocument/signatureHelp', {
      textDocument: { uri: this.uri(path) },
      position: { line, character },
    });
  }

  async inlayHints(
    path: string,
    range: { start: { line: number; character: number }; end: { line: number; character: number } },
  ): Promise<InlayHint[] | null> {
    await this.settle();
    return this.connection.sendRequest('textDocument/inlayHint', {
      textDocument: { uri: this.uri(path) },
      range,
    });
  }

  async formatting(path: string): Promise<TextEdit[] | null> {
    await this.settle();
    return this.connection.sendRequest('textDocument/formatting', {
      textDocument: { uri: this.uri(path) },
      options: { tabSize: 8, insertSpaces: false },
    });
  }

  async rangeFormatting(
    path: string,
    range: { start: { line: number; character: number }; end: { line: number; character: number } },
  ): Promise<TextEdit[] | null> {
    await this.settle();
    return this.connection.sendRequest('textDocument/rangeFormatting', {
      textDocument: { uri: this.uri(path) },
      range,
      options: { tabSize: 8, insertSpaces: false },
    });
  }

  async hover(
    path: string,
    line: number,
    character: number,
  ): Promise<Hover | null> {
    await this.settle();
    return this.connection.sendRequest('textDocument/hover', {
      textDocument: { uri: this.uri(path) },
      position: { line, character },
    });
  }

  /**
   * Wait until the server has processed every message sent so far and
   * finished the analysis they caused
   */
  async settle(): Promise<void> {
    // the server handles messages in order: once a request is answered,
    // the notifications sent before it have been received
    await this.roundTrip();
    await this.server.whenIdle();
    // and the notifications the server sent before answering have arrived
    await this.roundTrip();
  }

  private roundTrip(): Promise<unknown> {
    return this.connection.sendRequest('workspace/symbol', { query: '' });
  }

  async stop(): Promise<void> {
    await this.connection.sendRequest('shutdown');
    this.connection.dispose();
  }
}
