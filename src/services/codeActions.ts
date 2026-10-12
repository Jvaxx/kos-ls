import {
  CodeAction,
  CodeActionKind,
  CodeActionParams,
  Diagnostic,
  Position,
  Range,
  TextEdit,
  WorkspaceEdit,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { KLS } from '../kls';
import { NodeBase } from '../parser/models/base';
import * as Decl from '../parser/models/declare';
import * as Stmt from '../parser/models/stmt';
import * as SuffixTerm from '../parser/models/suffixTerm';
import { Token } from '../models/token';
import { TokenType } from '../models/tokentypes';
import { IScript } from '../parser/types';
import { DIAGNOSTICS, diagnosticText } from '../utilities/diagnosticsUtils';
import { levenshteinDistance } from '../utilities/levenshtein';
import { rangeEqual } from '../utilities/positionUtils';
import { suffixReceiverType } from '../utilities/serverUtils';
import { presentName } from '../utilities/stringUtils';
import { empty } from '../utilities/typeGuards';
import { kosTypes } from '../typeChecker/initialize';

/**
 * Most names suggested for a misspelled one
 */
const maxSuggestions = 3;

/**
 * What a quick fix needs to know about a document
 */
interface FixContext {
  server: KLS;
  uri: string;
  document: TextDocument;
  script: IScript;
}

/**
 * The quick fixes for the diagnostics of a code action request
 * @param server the server
 * @param params code action request
 * @param document the document's current text
 * @param script the document's syntax tree, up to date with the text
 */
export async function codeActions(
  server: KLS,
  params: CodeActionParams,
  document: TextDocument,
  script: IScript,
): Promise<CodeAction[]> {
  const { only, diagnostics } = params.context;
  if (
    !empty(only) &&
    !only.some(
      (kind) =>
        kind === CodeActionKind.QuickFix ||
        CodeActionKind.QuickFix.startsWith(`${kind}.`),
    )
  ) {
    return [];
  }

  const context: FixContext = {
    server,
    uri: params.textDocument.uri,
    document,
    script,
  };

  const actions: CodeAction[] = [];
  for (const diagnostic of diagnostics) {
    actions.push(...(await fixes(context, diagnostic)));
  }

  return actions;
}

/**
 * The quick fixes for one diagnostic
 * @param context the document
 * @param diagnostic the diagnostic
 */
async function fixes(
  context: FixContext,
  diagnostic: Diagnostic,
): Promise<CodeAction[]> {
  switch (diagnostic.code) {
    case DIAGNOSTICS.PARSER_ERROR:
      return missingPeriod(context, diagnostic);
    case DIAGNOSTICS.CLOBBER_BUILTIN:
      return clobberBuiltin(context, diagnostic);
    case DIAGNOSTICS.SYMBOL_MAY_NOT_EXIST:
      return misspelledSymbol(context, diagnostic);
    case DIAGNOSTICS.TYPE_MISSING_SUFFIX:
      return misspelledSuffix(context, diagnostic);
    case DIAGNOSTICS.TYPE_UNKNOWN_IN_DOC:
      return misspelledType(context, diagnostic);
    case DIAGNOSTICS.UNINITIALIZED_SET:
      return undeclaredSet(context, diagnostic);
    case DIAGNOSTICS.INVALID_LAZY_GLOBAL:
    case DIAGNOSTICS.INVALID_CLOBBER_BUILTINS:
      return misplacedDirective(context, diagnostic);
    case DIAGNOSTICS.GLOBAL_PARAMETER:
      return globalParameter(context, diagnostic);
    default:
      return [];
  }
}

/**
 * A quick fix editing the document
 */
function quickFix(
  context: FixContext,
  diagnostic: Diagnostic,
  title: string,
  edits: TextEdit[] | WorkspaceEdit,
  isPreferred = false,
): CodeAction {
  const edit = Array.isArray(edits)
    ? { changes: { [context.uri]: edits } }
    : edits;
  return {
    title,
    kind: CodeActionKind.QuickFix,
    diagnostics: [diagnostic],
    edit,
    ...(isPreferred ? { isPreferred } : {}),
  };
}

/**
 * Insert the period a statement lacks
 */
function missingPeriod(
  context: FixContext,
  diagnostic: Diagnostic,
): CodeAction[] {
  if (diagnostic.message !== 'Expected ".".') {
    return [];
  }

  return [
    quickFix(
      context,
      diagnostic,
      'Insert "."',
      [TextEdit.insert(diagnostic.range.end, '.')],
      true,
    ),
  ];
}

/**
 * Rename a name that hides a builtin, or allow it in the file
 */
async function clobberBuiltin(
  context: FixContext,
  diagnostic: Diagnostic,
): Promise<CodeAction[]> {
  const actions: CodeAction[] = [];
  const name = context.document.getText(diagnostic.range);

  const newName = await freeName(context, diagnostic.range.start, `${name}_`);
  const rename = await context.server.renameEdit(
    context.uri,
    diagnostic.range.start,
    newName,
  );
  if (!empty(rename)) {
    actions.push(
      quickFix(
        context,
        diagnostic,
        `Rename ${name} to ${newName}`,
        rename,
        true,
      ),
    );
  }

  const directives = Stmt.leadingDirectives(context.script.stmts);
  const off = directives.find(
    ({ directive }) => directive.type === TokenType.clobberBuiltins,
  );
  const allow = !empty(off)
    ? [TextEdit.replace(off.onOff, 'on')]
    : [insertDirective(context, '@clobberbuiltins on.')];
  actions.push(
    quickFix(
      context,
      diagnostic,
      'Allow names that hide builtins in this file (@clobberbuiltins on.)',
      allow,
    ),
  );

  return actions;
}

/**
 * A name based on another that no symbol visible from a position has
 * @param context the document
 * @param position where the name is used
 * @param base the name wanted
 */
async function freeName(
  context: FixContext,
  position: Position,
  base: string,
): Promise<string> {
  const taken = new Set(
    (await visibleNames(context, position)).map((name) => name.toLowerCase()),
  );
  let name = base;
  for (let i = 2; taken.has(name.toLowerCase()); i++) {
    name = `${base}${i}`;
  }
  return name;
}

/**
 * The names of the symbols visible from a position, builtins included
 */
async function visibleNames(
  context: FixContext,
  position: Position,
): Promise<string[]> {
  const symbols = [
    ...(await context.server.getScopedSymbols(position, context.uri)),
    ...(await context.server.getImportedSymbols(context.uri)),
  ];
  return symbols.map((symbol) => symbol.name.lexeme);
}

/**
 * Replace an unknown name by close names that exist
 */
async function misspelledSymbol(
  context: FixContext,
  diagnostic: Diagnostic,
): Promise<CodeAction[]> {
  const name = context.document.getText(diagnostic.range);
  const candidates = await visibleNames(context, diagnostic.range.start);
  return replaceWithClosest(context, diagnostic, name, candidates);
}

/**
 * Replace an unknown suffix by close suffixes of the type
 */
async function misspelledSuffix(
  context: FixContext,
  diagnostic: Diagnostic,
): Promise<CodeAction[]> {
  const type = await suffixReceiverType(
    context.server,
    context.uri,
    diagnostic.range.start,
  );
  if (empty(type)) {
    return [];
  }

  const name = context.document.getText(diagnostic.range);
  const suffixes = [...type.assignmentType().suffixes().values()].map(
    (suffix) =>
      presentName(
        context.server.completionCase,
        suffix.displayName ?? suffix.name,
      ),
  );
  return replaceWithClosest(context, diagnostic, name, suffixes);
}

/**
 * Replace an unknown structure name in a doc comment tag by close ones
 */
function misspelledType(
  context: FixContext,
  diagnostic: Diagnostic,
): CodeAction[] {
  const match = /^Unknown type (\w+):/.exec(diagnosticText(diagnostic));
  if (match === null) {
    return [];
  }

  const unknown = match[1];
  const text = context.document.getText(diagnostic.range);
  const word = new RegExp(`\\b${unknown}\\b`, 'gi');
  return closest(unknown, kosTypes().structureNames).map((name, i) =>
    quickFix(
      context,
      diagnostic,
      `Change to ${name}`,
      [TextEdit.replace(diagnostic.range, text.replace(word, name))],
      i === 0,
    ),
  );
}

/**
 * Fixes replacing the text of a diagnostic by the closest candidates
 */
function replaceWithClosest(
  context: FixContext,
  diagnostic: Diagnostic,
  name: string,
  candidates: string[],
): CodeAction[] {
  const suggestions = closest(name, candidates);
  return suggestions.map((suggestion, i) =>
    quickFix(
      context,
      diagnostic,
      `Change to ${suggestion}`,
      [TextEdit.replace(diagnostic.range, suggestion)],
      i === 0 && suggestions.length === 1,
    ),
  );
}

/**
 * The candidates close enough to a misspelled name to be what was meant,
 * closest first: at most a third of its letters differ (one for short
 * names), ignoring case as kOS does
 * @param name misspelled name
 * @param candidates names that exist
 */
export function closest(name: string, candidates: string[]): string[] {
  const limit = Math.max(1, Math.floor(name.length / 3));
  const seen = new Set<string>();
  const found: { candidate: string; distance: number }[] = [];

  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    if (seen.has(lower) || lower === name.toLowerCase()) {
      continue;
    }
    seen.add(lower);

    const distance = levenshteinDistance(name, candidate);
    if (distance <= limit) {
      found.push({ candidate, distance });
    }
  }

  return found
    .sort(
      (a, b) =>
        a.distance - b.distance ||
        a.candidate.toLowerCase().localeCompare(b.candidate.toLowerCase()),
    )
    .slice(0, maxSuggestions)
    .map(({ candidate }) => candidate);
}

/**
 * Declare a variable set while `@lazyglobal off.`: `set x to` becomes
 * `local x is` or `global x is`
 */
function undeclaredSet(
  context: FixContext,
  diagnostic: Diagnostic,
): CodeAction[] {
  const chained = new Set<NodeBase>();
  const set = findNode(context.script, (node) => {
    if (node instanceof Stmt.Chain) {
      node.clauses.forEach((clause) => chained.add(clause));
    }
    return (
      node instanceof Stmt.Set &&
      empty(node.suffix.trailer) &&
      node.suffix.suffixTerm.atom instanceof SuffixTerm.Identifier &&
      rangeEqual(node.suffix.suffixTerm.atom.token, diagnostic.range)
    );
  });
  // a clause of `set a to 1, b to 2.` cannot become a declaration alone
  if (!(set instanceof Stmt.Set) || chained.has(set)) {
    return [];
  }

  const name = context.document.getText(diagnostic.range);
  const atTop = context.script.stmts.includes(set);
  const declare = (scope: string) =>
    quickFix(
      context,
      diagnostic,
      `Declare ${name} with ${scope}`,
      [
        TextEdit.replace(
          { start: set.set.start, end: set.to.end },
          `${scope} ${name} is`,
        ),
      ],
      atTop === (scope === 'global'),
    );

  return atTop
    ? [declare('global'), declare('local')]
    : [declare('local'), declare('global')];
}

/**
 * Move a directive that is not at the top of the file there, or remove
 * it
 */
function misplacedDirective(
  context: FixContext,
  diagnostic: Diagnostic,
): CodeAction[] {
  const directive = findNode(
    context.script,
    (node) =>
      node instanceof Stmt.Directive &&
      rangeEqual(node.directive, diagnostic.range),
  );
  if (!(directive instanceof Stmt.Directive)) {
    return [];
  }

  const statement = withPeriod(context.document, directive);
  const text = context.document.getText(statement);
  const remove = removeStatement(context.document, statement);
  return [
    quickFix(
      context,
      diagnostic,
      `Move ${text} to the top of the file`,
      [insertDirective(context, text), remove],
      true,
    ),
    quickFix(context, diagnostic, `Remove ${text}`, [remove]),
  ];
}

/**
 * Remove `global` from `declare global parameter`
 */
function globalParameter(
  context: FixContext,
  diagnostic: Diagnostic,
): CodeAction[] {
  const param = findNode(
    context.script,
    (node) =>
      node instanceof Decl.Param &&
      !empty(node.scope?.scope) &&
      rangeEqual(node.scope.scope, diagnostic.range),
  );
  if (!(param instanceof Decl.Param)) {
    return [];
  }

  return [
    quickFix(
      context,
      diagnostic,
      'Remove "global"',
      [
        TextEdit.del({
          start: diagnostic.range.start,
          end: param.parameterToken.start,
        }),
      ],
      true,
    ),
  ];
}

/**
 * The edit inserting a directive after the directives at the top of the
 * file, or at its start
 * @param context the document
 * @param text the directive statement
 */
function insertDirective(context: FixContext, text: string): TextEdit {
  const directives = Stmt.leadingDirectives(context.script.stmts);
  if (directives.length === 0) {
    return TextEdit.insert(Position.create(0, 0), `${text}\n`);
  }

  const last = directives[directives.length - 1].end;
  return last.line + 1 < context.document.lineCount
    ? TextEdit.insert(Position.create(last.line + 1, 0), `${text}\n`)
    : TextEdit.insert(last, `\n${text}`);
}

/**
 * A statement's range with the period that ends it, which the ranges of
 * some nodes leave out
 * @param document the document
 * @param range range of the statement node
 */
function withPeriod(document: TextDocument, range: Range): Range {
  const text = document.getText();
  let offset = document.offsetAt(range.end);
  while (offset < text.length && /[ \t]/.test(text[offset])) {
    offset++;
  }
  return text[offset] === '.'
    ? { start: range.start, end: document.positionAt(offset + 1) }
    : range;
}

/**
 * The edit removing a statement, with its line when nothing else is on it
 * @param document the document
 * @param stmt the statement
 */
function removeStatement(document: TextDocument, stmt: Range): TextEdit {
  const { start, end } = stmt;
  const line = document.getText({
    start: Position.create(start.line, 0),
    end: Position.create(start.line + 1, 0),
  });
  if (start.line === end.line && line.trim() === document.getText(stmt)) {
    return TextEdit.del({
      start: Position.create(start.line, 0),
      end: Position.create(start.line + 1, 0),
    });
  }

  return TextEdit.del(stmt);
}

/**
 * The first syntax node of a script, depth first, matching a predicate
 * @param script the script
 * @param predicate what is looked for; sees every node before a match
 */
function findNode(
  script: IScript,
  predicate: (node: NodeBase) => boolean,
): Maybe<NodeBase> {
  const seen = new Set<object>();
  const visit = (node: unknown): Maybe<NodeBase> => {
    if (
      typeof node !== 'object' ||
      node === null ||
      node instanceof Token ||
      seen.has(node)
    ) {
      return undefined;
    }
    seen.add(node);

    if (Array.isArray(node)) {
      for (const element of node) {
        const found = visit(element);
        if (!empty(found)) {
          return found;
        }
      }
      return undefined;
    }
    if (!(node instanceof NodeBase)) {
      return undefined;
    }
    if (predicate(node)) {
      return node;
    }
    for (const value of Object.values(node)) {
      const found = visit(value);
      if (!empty(found)) {
        return found;
      }
    }
    return undefined;
  };

  return visit(script.stmts);
}
