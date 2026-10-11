/**
 * The text of a script as written to a probe's disk to save space:
 * comments and the whitespace around each line removed. Lines are kept
 * (an emptied line costs a byte), so the line numbers of kOS error
 * messages still match the source; blank lines at the end are dropped.
 * Kerboscript strings have no escapes; one can span lines, and its
 * whitespace is kept.
 * @param text source text
 */
export function strippedText(text: string): string {
  const lines: string[] = [];
  let inString = false;

  for (const line of text.split(/\r?\n/)) {
    // a line starting inside a string keeps its leading whitespace
    const startsInString = inString;
    let end = line.length;
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '"') {
        inString = !inString;
      } else if (!inString && line.startsWith('//', i)) {
        end = i;
        break;
      }
    }

    let stripped = line.slice(0, end);
    stripped = startsInString ? stripped : stripped.trimStart();
    // a line ending inside a string keeps its trailing whitespace
    lines.push(inString ? stripped : stripped.trimEnd());
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The size of a text in a kOS file: its UTF-8 bytes (`FileContent`)
 * @param text the text
 */
export function byteSize(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * The size of a script on disk, as written and stripped
 */
export interface FileSize {
  uri: string;

  /** bytes of the text as written */
  source: number;

  /** bytes of the stripped text */
  stripped: number;
}

/**
 * The disk space a script needs: itself and every file it runs, the
 * preloaded files included
 */
export interface DiskUsage {
  /**
   * The script first, then the files it runs, depth first in the order
   * of its run statements, each once
   */
  files: FileSize[];

  /**
   * Run statements whose file is not known (a path built at runtime, a
   * file that does not exist, an unmapped volume): their files are not
   * counted
   */
  unresolved: number;
}

/**
 * The stripped bytes of every file of a disk usage
 * @param usage disk usage
 */
export const totalStripped = (usage: DiskUsage): number =>
  usage.files.reduce((total, file) => total + file.stripped, 0);

const plural = (count: number, word: string): string =>
  `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * A one-line summary of a disk usage, e.g. `1310 B on disk (2741 B
 * source) · 4012 B with the 3 files it runs`
 * @param usage disk usage
 */
export function usageSummary(usage: DiskUsage): string {
  const [self, ...runs] = usage.files;
  const parts = [`${self.stripped} B on disk (${self.source} B source)`];
  if (runs.length > 0) {
    parts.push(
      `${totalStripped(usage)} B with the ${plural(runs.length, 'file')} it runs`,
    );
  }
  if (usage.unresolved > 0) {
    parts.push(`${plural(usage.unresolved, 'run')} not followed`);
  }
  return parts.join(' · ');
}

/**
 * The details of a disk usage, one file per line
 * @param usage disk usage
 * @param name how to show a file's uri
 */
export function usageDetails(
  usage: DiskUsage,
  name: (uri: string) => string,
): string {
  const lines = [
    `${totalStripped(usage)} B stripped in ${plural(usage.files.length, 'file')}:`,
    ...usage.files.map(
      (file) =>
        `  ${name(file.uri)}: ${file.stripped} B (${file.source} B source)`,
    ),
  ];
  if (usage.unresolved > 0) {
    lines.push(
      `${plural(usage.unresolved, 'run')} not followed (a path built at ` +
        'runtime, or a file not found): not counted',
    );
  }
  return lines.join('\n');
}
