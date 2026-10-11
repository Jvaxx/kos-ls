import { Diagnostic, DiagnosticSeverity } from 'vscode-languageserver';
import { Token } from '../models/token';
import { kosTypes } from '../typeChecker/initialize';
import { createDiagnostic, DIAGNOSTICS } from '../utilities/diagnosticsUtils';
import type { SymbolTableBuilder } from './models/symbolTableBuilder';

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
  if (builtin === undefined || !forbidden[clobber].includes(builtin)) {
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
