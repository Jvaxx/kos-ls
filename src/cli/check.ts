import { existsSync, statSync } from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';
import { PassThrough } from 'stream';
import {
  createConnection,
  Diagnostic,
  DiagnosticSeverity,
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

const usage = `Usage: kos-ls check [--root dir] [--fail-on severity] [file or directory...]

Print the diagnostics of the Kerboscript files of a workspace, as the
language server reports them to an editor: same ksconfig.json (volumes,
preload, exclude, linting rules), and each file analysed with the scripts
it runs. Without files, the whole workspace is reported; files and
directories limit the report to them (excluded files are never reported).

  --root dir           the workspace root (default: the nearest directory
                       with a ksconfig.json, from the current directory
                       up, else the current directory)
  --fail-on severity   the lowest severity that fails the check: error
                       (default), warning, info or hint
  -h, --help

Each diagnostic is printed as path:line:column: severity: message [code],
paths relative to the current directory; a summary goes to standard error.

Exit status: 0 when no diagnostic reaches the --fail-on severity, 1 when
one does, 2 on a usage error or a path that cannot be checked.`;

/**
 * Where the command writes, replaceable for tests
 */
export interface Output {
  out: (text: string) => void;
  err: (text: string) => void;
}

const processOutput: Output = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
};

const severityNames: Record<DiagnosticSeverity, string> = {
  [DiagnosticSeverity.Error]: 'error',
  [DiagnosticSeverity.Warning]: 'warning',
  [DiagnosticSeverity.Information]: 'info',
  [DiagnosticSeverity.Hint]: 'hint',
};

const severities = new Map(
  Object.entries(severityNames).map(([severity, name]) => [
    name,
    Number(severity) as DiagnosticSeverity,
  ]),
);

/**
 * Run `kos-ls check`
 * @param args arguments after `check`
 * @param io where to write
 * @param cwd the directory relative paths start from
 * @returns the exit status
 */
export async function main(
  args: string[],
  io: Output = processOutput,
  cwd: string = process.cwd(),
): Promise<number> {
  let root: string | undefined;
  let failOn: DiagnosticSeverity = DiagnosticSeverity.Error;
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      io.out(`${usage}\n`);
      return 0;
    } else if (arg === '--root' || arg === '--fail-on') {
      const value = args[++i];
      if (value === undefined) {
        io.err(`Missing value for ${arg}\n${usage}\n`);
        return 2;
      }
      if (arg === '--root') {
        root = resolve(cwd, value);
      } else if (severities.has(value)) {
        failOn = severities.get(value)!;
      } else {
        io.err(`Unknown severity ${value}\n${usage}\n`);
        return 2;
      }
    } else if (arg.startsWith('-')) {
      io.err(`Unknown option ${arg}\n${usage}\n`);
      return 2;
    } else {
      paths.push(resolve(cwd, arg));
    }
  }

  root = root ?? findRoot(cwd);
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
  if (status !== 0) {
    return status;
  }

  const reported = (await workspaceDiagnostics(root))
    .filter(
      ({ path }) =>
        paths.length === 0
          ? within(path, root!)
          : paths.some((limit) => within(path, limit)),
    )
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  const counts = new Map<DiagnosticSeverity, number>();
  let files = 0;
  for (const { path, diagnostics } of reported) {
    if (diagnostics.length > 0) {
      files += 1;
    }
    for (const diagnostic of sortDiagnostics(diagnostics)) {
      const severity = diagnostic.severity ?? DiagnosticSeverity.Error;
      counts.set(severity, (counts.get(severity) ?? 0) + 1);
      if (severity <= failOn) {
        status = 1;
      }

      const { line, character } = diagnostic.range.start;
      const code = diagnostic.code === undefined ? '' : ` [${diagnostic.code}]`;
      io.out(
        `${relative(cwd, path)}:${line + 1}:${character + 1}: ` +
          `${severityNames[severity]}: ${diagnostic.message}${code}\n`,
      );
    }
  }

  const summary = [...severities.values()]
    .filter((severity) => counts.has(severity))
    .map((severity) => {
      const count = counts.get(severity)!;
      const name = severityNames[severity];
      return `${count} ${name}${count === 1 || name === 'info' ? '' : 's'}`;
    });
  io.err(
    summary.length === 0
      ? 'No diagnostics\n'
      : `${summary.join(', ')} in ${files} file${files === 1 ? '' : 's'}\n`,
  );

  return status;
}

/**
 * Analyse a workspace with an in-process language server, as a client
 * would see it after opening the folder
 * @param root workspace root
 * @returns the last diagnostics published for each file
 */
async function workspaceDiagnostics(
  root: string,
): Promise<{ path: string; diagnostics: Diagnostic[] }[]> {
  typeInitializer();

  const up = new PassThrough();
  const down = new PassThrough();
  const server = new KLS(
    CaseKind.camelCase,
    mockLogger,
    mockTracer,
    createConnection(up, down),
    'check',
    defaultServerConfiguration,
    defaultWorkspaceConfiguration,
  );
  server.listen();

  const client = createMessageConnection(
    new StreamMessageReader(down),
    new StreamMessageWriter(up),
  );
  const published = new Map<string, Diagnostic[]>();
  client.onNotification(
    'textDocument/publishDiagnostics',
    (params: PublishDiagnosticsParams) =>
      published.set(params.uri, params.diagnostics),
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
  client.sendNotification('initialized', {});

  // once a request is answered, the server has received what was sent
  // before it; once idle, the diagnostics it sent before the next answer
  // have arrived
  const roundTrip = () => client.sendRequest('workspace/symbol', { query: '' });
  await roundTrip();
  await server.whenIdle();
  await roundTrip();

  await client.sendRequest('shutdown');
  client.dispose();

  return [...published].map(([uri, diagnostics]) => ({
    path: URI.parse(uri).fsPath,
    diagnostics,
  }));
}

/**
 * The nearest directory with a ksconfig.json, from a directory up, else
 * the directory itself
 */
function findRoot(start: string): string {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, configFileName))) {
      return dir;
    }
    if (dirname(dir) === dir) {
      return start;
    }
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Is a path a directory or file inside another, or the same
 */
function within(path: string, container: string): boolean {
  return (
    path === container ||
    path.startsWith(container.endsWith(sep) ? container : container + sep)
  );
}

function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics
    .slice()
    .sort(
      (a, b) =>
        a.range.start.line - b.range.start.line ||
        a.range.start.character - b.range.start.character,
    );
}
