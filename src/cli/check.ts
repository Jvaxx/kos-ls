import { relative, resolve } from 'path';
import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver/node';
import {
  checkPaths,
  findRoot,
  openWorkspace,
  Output,
  processOutput,
  selected,
} from './workspace';

export { Output } from './workspace';

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
  let status = checkPaths(root, paths, io, cwd);
  if (status !== 0) {
    return status;
  }

  const workspace = await openWorkspace(root);
  await workspace.close();
  const reported = [...workspace.diagnostics]
    .map(([path, diagnostics]) => ({ path, diagnostics }))
    .filter(({ path }) => selected(path, root, paths))
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

function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics
    .slice()
    .sort(
      (a, b) =>
        a.range.start.line - b.range.start.line ||
        a.range.start.character - b.range.start.character,
    );
}
