import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { Token } from '../models/token';
import * as Expr from '../parser/models/expr';
import * as SuffixTerm from '../parser/models/suffixTerm';
import { IExpr } from '../parser/types';
import { kosTypes } from '../typeChecker/initialize';
import { builtIn } from '../utilities/constants';
import { createDiagnostic, DIAGNOSTICS } from '../utilities/diagnosticsUtils';
import { empty } from '../utilities/typeGuards';
import type { SymbolTableBuilder } from './models/symbolTableBuilder';
import { KsSymbolKind, SymbolTracker, TrackerKind } from './types';

/**
 * The kinds of kOS builtins, as `Compiler.cs` `BuiltInIdentifierType`
 * classifies them
 */
export enum BuiltinKind {
  function,
  systemLock,
  settableVariable,
  readOnlyVariable,
}

/**
 * The declarations kOS checks: a set (`set`, `local`/`global`,
 * `parameter`, `toggle`, `x on.`, `list ... in x`), a lock, a function
 */
export enum Clobber {
  set,
  lock,
  function,
}

/**
 * What each declaration may not hide (`Compiler.cs` `AssertNo*Violation`)
 */
const forbidden: Record<Clobber, BuiltinKind[]> = {
  [Clobber.set]: [
    BuiltinKind.function,
    BuiltinKind.readOnlyVariable,
    BuiltinKind.systemLock,
  ],
  [Clobber.lock]: [
    BuiltinKind.function,
    BuiltinKind.readOnlyVariable,
    BuiltinKind.settableVariable,
  ],
  [Clobber.function]: [
    BuiltinKind.function,
    BuiltinKind.readOnlyVariable,
    BuiltinKind.settableVariable,
    BuiltinKind.systemLock,
  ],
};

const kindNames: Record<BuiltinKind, string> = {
  [BuiltinKind.function]: 'function',
  [BuiltinKind.systemLock]: 'system lock',
  [BuiltinKind.settableVariable]: 'variable',
  [BuiltinKind.readOnlyVariable]: 'read-only variable',
};

const actionNames: Record<Clobber, string> = {
  [Clobber.set]: 'SET a name',
  [Clobber.lock]: 'LOCK a name',
  [Clobber.function]: 'make a function name',
};

let settable: Maybe<Set<string>> = undefined;

/**
 * Is this builtin variable settable (`target`), by lower case name
 * @param lookup lower case name
 */
export const settableBuiltin = (lookup: string): boolean => {
  if (settable === undefined) {
    settable = new Set(
      kosTypes()
        .variables.filter(({ access }) => access?.set)
        .map(({ name }) => name.toLowerCase()),
    );
  }
  return settable.has(lookup);
};

/**
 * The kind of builtin a tracker is, if it is one: a builtin lock is a
 * system lock, a builtin variable is settable when the database says so
 * (the bodies are not in it)
 * @param tracker tracker of a symbol
 */
export const trackerBuiltinKind = (
  tracker: Maybe<SymbolTracker>,
): Maybe<BuiltinKind> => {
  if (
    empty(tracker) ||
    tracker.kind !== TrackerKind.basic ||
    tracker.declared.uri !== builtIn
  ) {
    return undefined;
  }

  const { symbol } = tracker.declared;
  switch (symbol.tag) {
    case KsSymbolKind.function:
      return BuiltinKind.function;
    case KsSymbolKind.lock:
      return BuiltinKind.systemLock;
    case KsSymbolKind.variable:
      return settableBuiltin(symbol.name.lookup)
        ? BuiltinKind.settableVariable
        : BuiltinKind.readOnlyVariable;
    default:
      return undefined;
  }
};

/**
 * Does kOS refuse this declaration of a name hiding this builtin
 * @param clobber kind of declaration
 * @param builtin kind of the builtin of that name, if any
 */
export const forbids = (
  clobber: Clobber,
  builtin: Maybe<BuiltinKind>,
): boolean => builtin !== undefined && forbidden[clobber].includes(builtin);

/**
 * The name of an expression that is a lone identifier (`x`, not `x:y`,
 * `x[0]` or `x()`), the only set target kOS checks
 * @param expr expression
 */
export const bareIdentifier = (expr: IExpr): Maybe<Token> =>
  expr instanceof Expr.Suffix &&
  empty(expr.trailer) &&
  expr.suffixTerm.trailers.length === 0 &&
  expr.suffixTerm.atom instanceof SuffixTerm.Identifier
    ? expr.suffixTerm.atom.token
    : undefined;

/**
 * The error kOS gives at compile time when a declaration hides a builtin
 * it may not hide, if it does
 * @param name declared name
 * @param clobber kind of declaration
 * @param builtin kind of the builtin of that name, if any
 */
export const clobberError = (
  name: Token,
  clobber: Clobber,
  builtin: Maybe<BuiltinKind>,
): Maybe<Diagnostic> => {
  if (builtin === undefined || !forbids(clobber, builtin)) {
    return undefined;
  }

  return createDiagnostic(
    name,
    `Not allowed to ${actionNames[clobber]} that hides the builtin ` +
      `${kindNames[builtin]} ${name.lexeme}. Rename it, or allow it with ` +
      '@clobberbuiltins on.',
    DiagnosticSeverity.Error,
    DIAGNOSTICS.CLOBBER_BUILTIN,
  );
};

/**
 * Check a declaration against kOS's rule, before it is declared
 * @param tableBuilder symbol table builder, to find the builtin
 * @param name declared name
 * @param clobber kind of declaration
 */
export const checkClobber = (
  tableBuilder: SymbolTableBuilder,
  name: Token,
  clobber: Clobber,
): Diagnostic[] => {
  const error = clobberError(name, clobber, tableBuilder.builtinKind(name));
  return error === undefined ? [] : [error];
};
