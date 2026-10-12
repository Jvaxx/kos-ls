import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { formatText } from '../formatter/formatter';
import { findFormatOptions } from '../formatter/config';

const usage = `Usage: kos-ls format [--check] [file or directory...]

Format Kerboscript files in place, or standard input to standard output
when no file is given. Directories are searched for .ks files.

Options come from the nearest .kos-format, or "format" section of a
ksconfig.json, from the directory of each file up (the current directory
for standard input).

  --check   change nothing; list the files that are not formatted
  -h, --help

Exit status: 0 when done (or, with --check, all formatted), 1 when --check
found files to format, 2 when a file could not be read or has syntax
errors.`;

/**
 * Where the command writes, replaceable for tests
 */
export interface Output {
  out: (text: string) => void;
  err: (text: string) => void;
  stdin: () => string;
}

const processOutput: Output = {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  stdin: () => readFileSync(0, 'utf8'),
};

/**
 * Run `kos-ls format`
 * @param args arguments after `format`
 * @param io where to read and write
 * @returns the exit status
 */
export function main(args: string[], io: Output = processOutput): number {
  let check = false;
  const paths: string[] = [];
  for (const arg of args) {
    if (arg === '--check') {
      check = true;
    } else if (arg === '-h' || arg === '--help') {
      io.out(`${usage}\n`);
      return 0;
    } else if (arg.startsWith('-') && arg !== '-') {
      io.err(`Unknown option ${arg}\n${usage}\n`);
      return 2;
    } else {
      paths.push(arg);
    }
  }

  if (paths.length === 0 || (paths.length === 1 && paths[0] === '-')) {
    const source = io.stdin();
    const found = findFormatOptions(process.cwd());
    reportOptions(found, io);
    const result = formatText(source, found.options);
    if ('error' in result) {
      io.err(`<stdin>: ${result.error}\n`);
      return 2;
    }
    if (check) {
      if (result.text !== source) {
        io.out('<stdin>\n');
        return 1;
      }
      return 0;
    }
    io.out(result.text);
    return 0;
  }

  let status = 0;
  const reported = new Set<string>();
  for (const file of paths.flatMap((path) => kosFiles(path, io))) {
    let source: string;
    try {
      source = readFileSync(file, 'utf8');
    } catch (err) {
      io.err(`${file}: ${(err as Error).message}\n`);
      status = 2;
      continue;
    }

    const found = findFormatOptions(file);
    if (found.file === undefined || !reported.has(found.file)) {
      reportOptions(found, io);
      reported.add(found.file ?? '');
    }

    const result = formatText(source, found.options);
    if ('error' in result) {
      io.err(`${file}: ${result.error}\n`);
      status = 2;
      continue;
    }
    if (result.text === source) {
      continue;
    }

    if (check) {
      io.out(`${file}\n`);
      status = Math.max(status, 1);
    } else {
      writeFileSync(file, result.text);
    }
  }

  return status;
}

/**
 * The .ks files of a path: itself if a file, those under it if a directory
 */
function kosFiles(path: string, io: Output): string[] {
  let stats;
  try {
    stats = statSync(path);
  } catch (err) {
    io.err(`${path}: ${(err as Error).message}\n`);
    return [];
  }
  if (!stats.isDirectory()) {
    return [path];
  }

  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        return kosFiles(child, io);
      }
      return entry.name.toLowerCase().endsWith('.ks') ? [child] : [];
    });
}

function reportOptions(
  found: ReturnType<typeof findFormatOptions>,
  io: Output,
): void {
  for (const error of found.errors) {
    io.err(`${found.file}: ${error}\n`);
  }
}
