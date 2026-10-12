/**
 * Generate the kOS database from a kOS repository:
 *
 *     node out/tools/kos-db/generate.js --kos /path/to/KOS \
 *       --version 1.6.0.1 --previous data/kos-1.6.0.1.json \
 *       --out data/kos-1.6.0.1.json
 *
 * The previous database carries what the kOS sources do not state
 * (element types, optional parameters, signatures of functions), so
 * updating to a new kOS version is a re-run from the previous one.
 *
 * The repository must be checked out at the tag of the version. The
 * report of the merge is written next to the database, in
 * docs/kos-db-report.md unless --report says otherwise.
 */
import { Command } from 'commander';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, resolve } from 'path';
import { extractClasses, stripComments } from './csharp';
import { emptyModel, parseRst, parseRstSections } from './rst';
import {
  merge,
  PreviousBuiltin,
  PreviousParameter,
  PreviousType,
} from './merge';
import {
  KosDatabase,
  ParameterEntry,
} from '../../src/typeChecker/database/schema';

const walk = (dir: string, extension: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(dir, entry.name), extension)
        : entry.name.endsWith(extension)
          ? [join(dir, entry.name)]
          : [],
    );

/**
 * The names of VesselTarget.ShortCuttableShipSuffixes: the bound
 * variables that stand for a suffix of SHIP
 * @param kos kOS repository
 */
function shipShortcuts(kos: string): string[] {
  const file = join(kos, 'src/kOS/Suffixed/VesselTarget.cs');
  const source = stripComments(readFileSync(file, 'utf8'));
  const match =
    /ShortCuttableShipSuffixes\s*=\s*new\s*(?:string\s*)?\[\s*\]\s*\{([^}]*)\}/.exec(
      source,
    );
  if (match === null) {
    throw new Error(`ShortCuttableShipSuffixes not found in ${file}`);
  }
  return [...match[1].matchAll(/"(\w+)"/g)].map((m) => m[1].toUpperCase());
}

/**
 * The previous database in the shape of the previous definitions, which
 * the merge refines the sources with
 * @param database previous database
 */
function previousDefinitions(database: KosDatabase): {
  types: PreviousType[];
  builtins: PreviousBuiltin[];
} {
  const params = (list: ParameterEntry[] = []): PreviousParameter[] =>
    list.map((p) => ({
      type: p.type,
      ...(p.optional ? { optional: true } : {}),
      ...(p.variadic ? { variadic: true } : {}),
    }));

  const types = Object.entries(database.structures).map(
    ([name, structure]) => ({
      name,
      ...(structure.inherits
        ? { super: structure.inherits.replace(/<.*$/, '') }
        : {}),
      ...(structure.parameters ? { parameters: structure.parameters } : {}),
      suffixes: Object.entries(structure.suffixes).flatMap(([key, suffix]) =>
        [key, ...(suffix.aliases ?? [])].map((suffixName) => ({
          name: suffixName,
          get:
            suffix.access !== 'set' &&
            (suffix.access !== 'call' || !suffix.params?.length),
          set: suffix.access === 'getset' || suffix.access === 'set',
          params: params(suffix.params),
          type: suffix.type,
        })),
      ),
    }),
  );

  const builtins: PreviousBuiltin[] = [
    ...Object.entries(database.functions).flatMap(([key, fn]) =>
      [key, ...(fn.aliases ?? [])].map((name) => ({
        name,
        params: params(fn.params),
        type: fn.returns,
        kind: 'function' as const,
      })),
    ),
    ...Object.entries(database.variables).map(([name, variable]) => ({
      name,
      params: [],
      type: variable.type,
      kind: variable.lock ? ('lock' as const) : ('variable' as const),
    })),
  ];

  return { types, builtins };
}

const program = new Command()
  .requiredOption(
    '--kos <repository>',
    'kOS repository, checked out at the version',
  )
  .requiredOption('--version <version>', 'kOS version, e.g. 1.6.0.1')
  .requiredOption('--out <file>', 'database to write')
  .option('--report <file>', 'report to write', 'docs/kos-db-report.md')
  .option('--overrides <file>', 'overrides to apply', 'data/overrides.json')
  .requiredOption(
    '--previous <file>',
    'previous database, to refine the sources with (e.g. the one written by --out)',
  )
  .option(
    '--docs-base <url>',
    'base of documentation urls',
    'https://ksp-kos.github.io/KOS/',
  )
  .parse();

const options = program.opts<{
  kos: string;
  version: string;
  out: string;
  report: string;
  overrides: string;
  docsBase: string;
  previous: string;
}>();

const kos = resolve(options.kos);
const sources = join(kos, 'src');
const documentation = join(kos, 'doc/source');

const classes = walk(sources, '.cs')
  .filter((file) => !/\.Test[/\\]/.test(file))
  .flatMap((file) =>
    extractClasses(readFileSync(file, 'utf8'), relative(kos, file)),
  );

const docs = emptyModel();
const pages = walk(documentation, '.rst').map((file) => ({
  text: readFileSync(file, 'utf8'),
  file: relative(documentation, file),
}));
for (const { text, file } of pages) {
  parseRst(text, file, docs);
}
for (const { text, file } of pages) {
  parseRstSections(text, file, docs, { globals: file === 'bindings.rst' });
}

const { database, report } = merge({
  kos: options.version,
  docsBase: options.docsBase,
  classes,
  docs,
  previous: previousDefinitions(
    JSON.parse(readFileSync(options.previous, 'utf8')) as KosDatabase,
  ),
  shipShortcuts: shipShortcuts(kos),
  prose: pages.map((page) => page.text),
  overrides: existsSync(options.overrides)
    ? JSON.parse(readFileSync(options.overrides, 'utf8'))
    : undefined,
});

writeFileSync(options.out, JSON.stringify(database, null, 2) + '\n');
writeFileSync(
  options.report,
  report.toMarkdown(`kOS database report: kOS ${options.version}`),
);

for (const [name, value] of report.counts) {
  console.log(`${name}: ${value}`);
}
for (const [section, messages] of report.sections) {
  console.log(`${section}: ${messages.length}`);
}
