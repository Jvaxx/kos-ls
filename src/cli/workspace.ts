import { existsSync, statSync } from 'fs';
import { dirname, join, relative, sep } from 'path';
import { PassThrough } from 'stream';
import {
  createConnection,
  Diagnostic,
  PublishDiagnosticsParams,
} from 'vscode-languageserver/node';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-jsonrpc/node';
import { URI } from 'vscode-uri';
import { KLS } from '../kls';
import { mockLogger, mockTracer } from '../models/logger';
import { typeInitializer } from '../typeChecker/initialize';
import { defaultServerConfiguration } from '../config/models/serverConfiguration';
import { defaultWorkspaceConfiguration } from '../config/models/workspaceConfiguration';
import { configFileName } from '../services/documentService';
import { CaseKind } from '../utilities/enums';

/**
 * Where a command writes, replaceable for tests
 */
export interface Output {
  out: (text: string) => void;
  err: (text: string) => void;
}

export const processOutput: Output = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

/**
 * A workspace analysed by an in-process language server, as a client
 * sees it after opening the folder
 */
export interface Workspace {
  server: KLS;

  /**
   * The last diagnostics published for each file, by path
   */
  diagnostics: Map<string, Diagnostic[]>;

  /**
   * Shut the server down
   */
  close(): Promise<void>;
}

/**
 * Start a language server on a workspace and wait for its load
 * @param root workspace root
 */
export async function openWorkspace(root: string): Promise<Workspace> {
  typeInitializer();

  const up = new PassThrough();
  const down = new PassThrough();
  const server = new KLS(
    CaseKind.camelCase,
    mockLogger,
    mockTracer,
    createConnection(up, down),
    'cli',
    defaultServerConfiguration,
    defaultWorkspaceConfiguration,
  );
  server.listen();

  const client = createMessageConnection(
    new StreamMessageReader(down),
    new StreamMessageWriter(up),
  );
  const diagnostics = new Map<string, Diagnostic[]>();
  client.onNotification(
    'textDocument/publishDiagnostics',
    (params: PublishDiagnosticsParams) => {
      diagnostics.set(URI.parse(params.uri).fsPath, params.diagnostics);
    },
  );
  client.onNotification('window/logMessage', () => {});
  client.listen();

  // no parent process: with one, the server's watchdog polls it with an
  // interval that keeps this process alive
  await client.sendRequest('initialize', {
    processId: null,
    rootUri: URI.file(root).toString(),
    capabilities: {},
  });
  await client.sendNotification('initialized', {});

  // once a request is answered, the server has received what was sent
  // before it; once idle, the diagnostics it sent before the next answer
  // have arrived
  const roundTrip = () => client.sendRequest('workspace/symbol', { query: '' });
  await roundTrip();
  await server.whenIdle();
  await roundTrip();

  return {
    server,
    diagnostics,
    close: async () => {
      await client.sendRequest('shutdown');
      client.dispose();
    },
  };
}

/**
 * The nearest directory with a ksconfig.json, from a directory up, else
 * the directory itself
 */
export function findRoot(start: string): string {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, configFileName))) {
      return dir;
    }
    if (dirname(dir) === dir) {
      return start;
    }
  }
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Is a path a directory or file inside another, or the same
 */
export function within(path: string, container: string): boolean {
  return (
    path === container ||
    path.startsWith(container.endsWith(sep) ? container : container + sep)
  );
}

/**
 * Check the root and the paths given to a command: the root must be a
 * directory, the paths exist inside it
 * @param root workspace root
 * @param paths absolute paths
 * @param io where errors go
 * @param cwd the directory paths are shown relative to
 * @returns the exit status: 0, or 2 on an error
 */
export function checkPaths(
  root: string,
  paths: string[],
  io: Output,
  cwd: string,
): number {
  if (!isDirectory(root)) {
    io.err(`${root}: not a directory\n`);
    return 2;
  }

  let status = 0;
  for (const path of paths) {
    if (!existsSync(path)) {
      io.err(`${relative(cwd, path)}: no such file or directory\n`);
      status = 2;
    } else if (!within(path, root)) {
      io.err(
        `${relative(cwd, path)}: outside the workspace root ${root} (see --root)\n`,
      );
      status = 2;
    }
  }
  return status;
}

/**
 * Is a file reported, given the paths a command was limited to
 * @param path the file
 * @param root workspace root
 * @param paths limits, none for the whole workspace
 */
export const selected = (path: string, root: string, paths: string[]): boolean =>
  paths.length === 0
    ? within(path, root)
    : paths.some((limit) => within(path, limit));
