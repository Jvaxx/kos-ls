import { relative, resolve } from 'path';
import { URI } from 'vscode-uri';
import { DiskUsage, totalStripped } from '../analysis/diskSize';
import {
  checkPaths,
  findRoot,
  openWorkspace,
  Output,
  processOutput,
  selected,
} from './workspace';

export type { Output } from './workspace';

const usage = `Usage: kos-ls size [--root dir] [--max bytes] [--files] [file or directory...]

Print the disk space each Kerboscript file of a workspace needs on a
probe: its size stripped of comments and indentation (lines are kept, so
kOS error line numbers still match), and the total with every file it
runs, the preloaded files of ksconfig.json included, each counted once.
kOS counts a file's UTF-8 bytes. Without files, every file of the
workspace is listed; files and directories limit the list to them.

  --root dir     the workspace root (default: the nearest directory with
                 a ksconfig.json, from the current directory up, else the
                 current directory)
  --max bytes    fail when a total is larger: the probe's disk
  --files        list the files of each total
  -h, --help

Columns: stripped and source sizes of the file, total stripped size with
what it runs, and the number of files in the total. A run whose file is
not known (a path built at runtime, a missing file) is not counted, and
reported.

Exit status: 0, 1 when a total is larger than --max, 2 on a usage error
or a path that cannot be checked.`;

/**
 * Run `kos-ls size`
 * @param args arguments after `size`
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
  let max: number | undefined;
  let listFiles = false;
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      io.out(`${usage}\n`);
      return 0;
    } else if (arg === '--files') {
      listFiles = true;
    } else if (arg === '--root' || arg === '--max') {
      const value = args[++i];
      if (value === undefined) {
        io.err(`Missing value for ${arg}\n${usage}\n`);
        return 2;
      }
      if (arg === '--root') {
        root = resolve(cwd, value);
      } else if (/^\d+$/.test(value)) {
        max = Number(value);
      } else {
        io.err(`Not a number of bytes: ${value}\n${usage}\n`);
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
  const status = checkPaths(root, paths, io, cwd);
  if (status !== 0) {
    return status;
  }

  const workspace = await openWorkspace(root);
  const rows: { path: string; usage: DiskUsage }[] = [];
  try {
    for (const uri of workspace.server.workspaceScripts()) {
      const path = URI.parse(uri).fsPath;
      if (!selected(path, root, paths)) {
        continue;
      }
      const found = await workspace.server.diskUsage(uri);
      if (found !== undefined) {
        rows.push({ path, usage: found });
      }
    }
  } finally {
    await workspace.close();
  }

  if (rows.length === 0) {
    io.err('No Kerboscript files\n');
    return 0;
  }

  const show = (uri: string) => relative(cwd, URI.parse(uri).fsPath);
  const width = Math.max(
    4,
    ...rows.map(({ path }) => relative(cwd, path).length),
  );
  const columns = (...cells: (string | number)[]) =>
    cells
      .map((cell, i) =>
        i === 0
          ? String(cell).padEnd(width)
          : String(cell).padStart(i === 4 ? 5 : 8),
      )
      .join(' ');

  io.out(`${columns('path', 'stripped', 'source', 'total', 'files')}\n`);
  let over = 0;
  for (const { path, usage: found } of rows) {
    const [self] = found.files;
    const total = totalStripped(found);
    const notes: string[] = [];
    if (found.unresolved > 0) {
      notes.push(
        `${found.unresolved} run${found.unresolved === 1 ? '' : 's'} not followed`,
      );
    }
    if (max !== undefined && total > max) {
      over += 1;
      notes.push(`${total - max} B over ${max}`);
    }

    io.out(
      columns(
        relative(cwd, path),
        self.stripped,
        self.source,
        total,
        found.files.length,
      ) +
        (notes.length > 0 ? `  (${notes.join(', ')})` : '') +
        '\n',
    );
    if (listFiles) {
      for (const file of found.files.slice(1)) {
        io.out(`  ${show(file.uri)} ${file.stripped}\n`);
      }
    }
  }

  const files = `${rows.length} file${rows.length === 1 ? '' : 's'}`;
  if (max === undefined) {
    io.err(`${files}\n`);
    return 0;
  }
  io.err(
    over === 0
      ? `${files}, all within ${max} B\n`
      : `${over} of ${files} over ${max} B\n`,
  );
  return over === 0 ? 0 : 1;
}
