/**
 * Conversion of the reStructuredText used in the kOS documentation to
 * Markdown, as shown by editors in hovers and completion details.
 *
 * It covers the subset kOS uses: inline roles and literals, literal
 * blocks (`::`), code blocks, admonitions, version notes, bullet and
 * enumerated lists, and list tables. Images are dropped.
 */

/**
 * Display text of a role's content: `text <target>` gives text, and a
 * leading `~` (show the last component only) is applied
 * @param content role content
 */
function roleText(content: string): string {
  const titled = /^([\s\S]*?)\s*<[^<>]*>$/.exec(content);
  if (titled !== null && titled[1] !== '') {
    return titled[1];
  }
  if (content.startsWith('~')) {
    return content.slice(1).split(/[:.]/).pop()!;
  }
  return content;
}

/**
 * Convert inline markup of a line of text
 * @param text RST text
 */
export function convertInline(text: string): string {
  return (
    text
      // escaped whitespace (`\ `) joins text
      .replace(/\\ /g, '')
      // roles: :struct:`Vessel`, :ref:`text <label>`, :ks:attr:`X`
      .replace(
        /:(?:[\w-]+:)?([\w-]+):`([^`]+)`/g,
        (_, role: string, content: string) => {
          const display = roleText(content);
          switch (role.toLowerCase()) {
            case 'math':
              return `$${display}$`;
            case 'ref':
            case 'doc':
            case 'any':
              return display;
            default:
              return `\`${display}\``;
          }
        },
      )
      // ``literal``
      .replace(/``([^`]+)``/g, '`$1`')
      // hyperlinks: `text <url>`_ and `text <url>`__
      .replace(/`([^`<]+?)\s*<(https?:[^>]+)>`__?/g, '[$1]($2)')
      // links relative to the documentation: their text
      .replace(/`([^`<]+?)\s*<[^>:]+>`__?/g, '$1')
      // anonymous references: `text`_
      .replace(/`([^`]+)`__?(?=\W|$)/g, '$1')
      // substitutions: |name|
      .replace(/\|([\w -]+)\|(?=\W|$)/g, '$1')
  );
}

const admonitions: Record<string, string> = {
  note: 'Note',
  warning: 'Warning',
  tip: 'Tip',
  hint: 'Hint',
  important: 'Important',
  attention: 'Attention',
  caution: 'Caution',
  danger: 'Danger',
  error: 'Error',
  seealso: 'See also',
};

const indentOf = (line: string) => /^ */.exec(line)![0].length;
const isBlank = (line: string) => line.trim() === '';

/**
 * Remove the common indentation of lines
 * @param lines lines
 */
export function dedent(lines: string[]): string[] {
  const indents = lines.filter((l) => !isBlank(l)).map(indentOf);
  const common = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((l) => (isBlank(l) ? '' : l.slice(common)));
}

/**
 * The block of lines indented more than `indent` starting at `start`,
 * blank lines included
 * @returns the index after the block
 */
function blockEnd(lines: string[], start: number, indent: number): number {
  let i = start;
  let end = start;
  while (i < lines.length) {
    if (isBlank(lines[i])) {
      i++;
      continue;
    }
    if (indentOf(lines[i]) <= indent) {
      break;
    }
    i++;
    end = i;
  }
  return end;
}

/**
 * Convert a list-table directive's content to a Markdown table
 * @param lines content lines of the directive, options included
 */
function listTable(lines: string[]): string[] {
  const rows: string[][] = [];
  let headerRows = 0;

  for (const line of dedent(lines)) {
    const option = /^:header-rows:\s*(\d+)/.exec(line);
    if (option !== null) {
      headerRows = Number(option[1]);
    } else if (/^\* - /.test(line)) {
      rows.push([line.slice(4)]);
    } else if (/^  - ?/.test(line) && rows.length > 0) {
      rows[rows.length - 1].push(line.replace(/^  - ?/, ''));
    } else if (/^    \S/.test(line) && rows.length > 0) {
      const row = rows[rows.length - 1];
      row[row.length - 1] += ' ' + line.trim();
    }
  }

  if (rows.length === 0) {
    return [];
  }

  const width = Math.max(...rows.map((r) => r.length));
  const cell = (row: string[], i: number) =>
    convertInline((row[i] ?? '').trim()).replace(/\|/g, '\\|');
  const line = (row: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cell(row, i)).join(' | ')} |`;

  const header = headerRows > 0 ? rows[0] : rows[0].map(() => '');
  const body = headerRows > 0 ? rows.slice(1) : rows;
  return [
    line(header),
    `|${' --- |'.repeat(width)}`,
    ...body.map(line),
  ];
}

/**
 * Border of a simple table: `=====  =====`
 */
export const simpleTableBorder = /^=+(?:\s+=+)+\s*$/;

/**
 * The index after a simple table starting with a border at `start`: the
 * table ends with the border followed by a blank line or the end
 */
export function simpleTableEnd(lines: string[], start: number): number {
  let borders = 0;
  for (let i = start; i < lines.length; i++) {
    if (simpleTableBorder.test(lines[i])) {
      borders++;
      if (borders >= 2 && (i + 1 >= lines.length || isBlank(lines[i + 1]))) {
        return i + 1;
      }
    }
  }
  return lines.length;
}

/**
 * Convert a simple table to a Markdown table
 * @param lines the table, borders included
 */
function simpleTable(lines: string[]): string[] {
  // columns: the spans of the `=` runs of the first border
  const spans = [...lines[0].matchAll(/=+/g)].map((m) => ({
    start: m.index!,
    end: m.index! + m[0].length,
  }));
  const cells = (line: string) =>
    spans.map((span, i) =>
      line
        .slice(span.start, i === spans.length - 1 ? undefined : spans[i + 1].start)
        .trim(),
    );

  const borders = lines
    .map((line, i) => (simpleTableBorder.test(line) ? i : -1))
    .filter((i) => i >= 0);
  // a header when there are three borders: top, under the header, bottom
  const headerEnd = borders.length >= 3 ? borders[1] : -1;

  const rows: string[][] = [];
  let header: string[] | undefined;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (simpleTableBorder.test(line) || /^-+\s*$/.test(line.trim()) || isBlank(line)) {
      continue;
    }
    const row = cells(line);
    if (i < headerEnd) {
      header = header ? header.map((c, j) => `${c} ${row[j]}`.trim()) : row;
    } else if (row[0] === '' && rows.length > 0) {
      // continuation of the previous row
      const previous = rows[rows.length - 1];
      row.forEach((c, j) => {
        previous[j] = `${previous[j]} ${c}`.trim();
      });
    } else {
      rows.push(row);
    }
  }

  const cell = (text: string) => convertInline(text).replace(/\|/g, '\\|');
  const line = (row: string[]) => `| ${row.map(cell).join(' | ')} |`;
  return [
    line(header ?? spans.map(() => '')),
    `|${' --- |'.repeat(spans.length)}`,
    ...rows.map(line),
  ];
}

/**
 * Convert RST lines (already dedented to their block) to Markdown
 * @param lines RST lines
 * @param language language of literal blocks
 */
export function rstToMarkdown(
  lines: string[],
  language = 'kerboscript',
): string {
  const out: string[] = [];
  const source = dedent(lines);
  let i = 0;

  const fence = (block: string[], lang: string) => {
    out.push('```' + lang, ...dedent(block).join('\n').trim().split('\n'), '```');
  };

  while (i < source.length) {
    const line = source[i];
    const directive = /^\.\.\s+([\w-]+)::\s*(.*)$/.exec(line);

    if (directive !== null) {
      const [, name, argument] = directive;
      const end = blockEnd(source, i + 1, 0);
      const content = source.slice(i + 1, end);
      const kind = name.toLowerCase();

      if (kind in admonitions) {
        const text = rstToMarkdown([argument, ...dedent(content)], language);
        const [first, ...rest] = text.split('\n');
        out.push(
          `> **${admonitions[kind]}:** ${first}`,
          ...rest.map((l) => (l === '' ? '>' : `> ${l}`)),
        );
      } else if (kind === 'versionadded') {
        out.push(`*Added in kOS ${argument.trim()}.*`);
      } else if (kind === 'versionchanged' || kind === 'deprecated') {
        const label = kind === 'deprecated' ? 'Deprecated since' : 'Changed in';
        const text = rstToMarkdown(content, language).replace(/\n/g, ' ');
        out.push(`*${label} kOS ${argument.trim()}${text ? `: ${text}` : '.'}*`);
      } else if (kind === 'code-block' || kind === 'code') {
        const options = content.findIndex((l) => !/^\s*:\w[\w-]*:/.test(l));
        fence(content.slice(Math.max(options, 0)), argument.trim() || language);
      } else if (kind === 'list-table') {
        out.push(...listTable(content));
      }
      // other directives (images, figures, indexes, targets) are dropped

      out.push('');
      i = end;
      continue;
    }

    if (simpleTableBorder.test(line)) {
      const end = simpleTableEnd(source, i);
      out.push(...simpleTable(source.slice(i, end)), '');
      i = end;
      continue;
    }

    // comments and targets: `.. _label:`, `.. comment`
    if (/^\.\.(\s|$)/.test(line)) {
      i = blockEnd(source, i + 1, 0);
      continue;
    }

    // a paragraph ending with `::` introduces a literal block
    if (/::\s*$/.test(line) && !isBlank(line)) {
      const text = line.replace(/\s*::\s*$/, '');
      const intro = text === '' ? '' : convertInline(text) + ':';
      if (intro !== '') {
        out.push(intro);
      }

      let next = i + 1;
      while (next < source.length && isBlank(source[next])) {
        next++;
      }
      const end = blockEnd(source, next, indentOf(line));
      if (end > next) {
        if (intro !== '') {
          out.push('');
        }
        fence(source.slice(next, end), language);
        out.push('');
      }
      i = end > next ? end : i + 1;
      continue;
    }

    // enumerated lists: `#.` becomes `1.`
    out.push(convertInline(line.replace(/^(\s*)#\.(\s)/, '$11.$2')));
    i++;
  }

  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
