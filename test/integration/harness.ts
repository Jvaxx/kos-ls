import { readFileSync } from 'fs';
import { join, relative } from 'path';
import { PassThrough } from 'stream';
import {
  CodeAction,
  CodeLens,
  CompletionItem,
  ConfigurationParams,
  createConnection,
  Diagnostic,
  DocumentHighlight,
  DocumentHighlightKind,
  Hover,
  InlayHint,
  Location,
  PublishDiagnosticsParams,
  Range,
  SemanticTokens,
  ShowMessageParams,
  SignatureHelp,
  TextEdit,
  WorkspaceEdit,
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
import { semanticTokensLegend } from '../../src/services/semanticTokens';

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

  /**
   * Messages the server showed (`window/showMessage`)
   */
  public readonly shown: string[] = [];

  /**
   * How many times the server asked to refresh the code lenses
   */
  public codeLensRefreshes = 0;

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
    connection.onNotification('window/showMessage', (params: ShowMessageParams) =>
      client.shown.push(params.message),
    );
    connection.onRequest('workspace/codeLens/refresh', () => {
      client.codeLensRefreshes += 1;
      return null;
    });
    connection.onRequest('workspace/configuration', (params: ConfigurationParams) =>
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
          codeLens: { refreshSupport: true },
          didChangeWatchedFiles: { dynamicRegistration: true },
        },
      },
    });
    void connection.sendNotification('initialized', {});
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
    void this.connection.sendNotification('textDocument/didOpen', {
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
    void this.connection.sendNotification('textDocument/didChange', {
      textDocument: { uri: this.uri(path), version },
      contentChanges: [{ text }],
    });
  }

  close(path: string): void {
    void this.connection.sendNotification('textDocument/didClose', {
      textDocument: { uri: this.uri(path) },
    });
  }

  /**
   * Notify the server that files changed on disk
   * @param changes paths relative to the workspace root and change type
   * (1 created, 2 changed, 3 deleted)
   */
  filesChanged(...changes: [string, 1 | 2 | 3][]): void {
    void this.connection.sendNotification('workspace/didChangeWatchedFiles', {
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
   * The code actions for the diagnostics of a document, as a client asks
   * for them: with the diagnostics at a line (1-based), or all
   * @param path path relative to the workspace root
   * @param line only the diagnostics starting on this line
   * @param only the kinds of actions wanted
   */
  async codeActions(
    path: string,
    line?: number,
    only?: string[],
  ): Promise<CodeAction[]> {
    const diagnostics = (await this.diagnosticsFor(path)).filter(
      (d) => line === undefined || d.range.start.line === line - 1,
    );
    const range = diagnostics[0]?.range ?? {
      start: { line: (line ?? 1) - 1, character: 0 },
      end: { line: (line ?? 1) - 1, character: 0 },
    };
    return this.connection.sendRequest('textDocument/codeAction', {
      textDocument: { uri: this.uri(path) },
      range,
      context: { diagnostics, ...(only ? { only } : {}) },
    });
  }

  /**
   * The semantic tokens of a document, decoded: `text type mod,mod`, in
   * document order
   * @param path path relative to the workspace root
   * @param range only this range
   */
  async semanticTokens(path: string, range?: Range): Promise<string[]> {
    await this.settle();
    const textDocument = { uri: this.uri(path) };
    const result: SemanticTokens = range
      ? await this.connection.sendRequest('textDocument/semanticTokens/range', {
          textDocument,
          range,
        })
      : await this.connection.sendRequest('textDocument/semanticTokens/full', {
          textDocument,
        });

    const lines = readFileSync(join(this.root, path), 'utf8').split('\n');
    const tokens: string[] = [];
    let line = 0;
    let character = 0;
    for (let i = 0; i < result.data.length; i += 5) {
      const [deltaLine, deltaStart, length, type, modifiers] = result.data.slice(
        i,
        i + 5,
      );
      line += deltaLine;
      character = deltaLine === 0 ? character + deltaStart : deltaStart;
      const names = semanticTokensLegend.tokenModifiers.filter(
        (_, bit) => modifiers & (1 << bit),
      );
      tokens.push(
        [
          lines[line].slice(character, character + length),
          semanticTokensLegend.tokenTypes[type],
          ...(names.length > 0 ? [names.join(',')] : []),
        ].join(' '),
      );
    }
    return tokens;
  }

  /**
   * The code lenses of a document
   * @param path path relative to the workspace root
   */
  async codeLenses(path: string): Promise<CodeLens[]> {
    await this.settle();
    return this.connection.sendRequest('textDocument/codeLens', {
      textDocument: { uri: this.uri(path) },
    });
  }

  /**
   * Run a server command
   * @param command the command
   * @param args its arguments
   */
  executeCommand(command: string, ...args: unknown[]): Promise<unknown> {
    return this.connection.sendRequest('workspace/executeCommand', {
      command,
      arguments: args,
    });
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
   * Document highlights at a position, as `line:col R|W` (1-based, R a
   * read, W a write), in document order
   */
  async highlights(
    path: string,
    line: number,
    character: number,
  ): Promise<string[]> {
    await this.settle();
    const highlights: DocumentHighlight[] | null =
      await this.connection.sendRequest('textDocument/documentHighlight', {
        textDocument: { uri: this.uri(path) },
        position: { line, character },
      });
    return (highlights ?? [])
      .map(({ range: { start }, kind }) => ({ start, kind }))
      .sort((a, b) => a.start.line - b.start.line || a.start.character - b.start.character)
      .map(
        ({ start, kind }) =>
          `${start.line + 1}:${start.character + 1} ` +
          (kind === DocumentHighlightKind.Write ? 'W' : 'R'),
      );
  }

  /**
   * References at a position, declaration included, as `path line:col`
   * (path relative to the root, 1-based), sorted
   */
  async references(
    path: string,
    line: number,
    character: number,
  ): Promise<string[]> {
    await this.settle();
    const locations: Location[] | null = await this.connection.sendRequest(
      'textDocument/references',
      {
        textDocument: { uri: this.uri(path) },
        position: { line, character },
        context: { includeDeclaration: true },
      },
    );
    return (locations ?? [])
      .map(
        ({ uri, range: { start } }) =>
          `${relative(this.root, URI.parse(uri).fsPath)} ` +
          `${start.line + 1}:${start.character + 1}`,
      )
      .sort();
  }

  /**
   * Rename the symbol at a position
   */
  async rename(
    path: string,
    line: number,
    character: number,
    newName: string,
  ): Promise<WorkspaceEdit | null> {
    await this.settle();
    return this.connection.sendRequest('textDocument/rename', {
      textDocument: { uri: this.uri(path) },
      position: { line, character },
      newName,
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
