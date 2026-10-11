import { ScopeKind } from '../parser/types';
import { Token } from '../models/token';
import { TokenType } from '../models/tokentypes';
import { builtIn, DEFAULT_BODIES } from '../utilities/constants';
import { SymbolTableBuilder } from './models/symbolTableBuilder';
import { SymbolTable } from './models/symbolTable';
import { toCase } from '../utilities/stringUtils';
import { Marker } from '../scanner/models/marker';
import { Range } from 'vscode-languageserver';
import { kosType, kosTypes } from '../typeChecker/initialize';
import { TypeKind } from '../typeChecker/types';

/**
 * A token for a builtin symbol
 * @param name name in the requested case
 */
const builtInToken = (name: string) =>
  new Token(
    TokenType.identifier,
    name,
    undefined,
    new Marker(0, 0),
    new Marker(0, 0),
    builtIn,
  );

const builtInRange = Range.create(new Marker(0, 0), new Marker(0, 0));

/**
 * The symbol table of the builtin functions, bound variables and locks of
 * the kOS database
 * @param caseKind case of the names
 */
export const standardLibraryBuilder = (caseKind: CaseKind): SymbolTable => {
  const libraryBuilder = new SymbolTableBuilder(builtIn);
  const { functions, variables } = kosTypes();

  for (const { segments, type } of functions) {
    const params = type.callSignature()?.params() ?? [];
    const optional = params.filter((param) => param.noneType || param.kind === TypeKind.variadic).length;

    libraryBuilder.declareFunction(
      ScopeKind.global,
      builtInToken(toCase(caseKind, ...segments)),
      builtInRange,
      params.length - optional,
      optional,
      !(type.callSignature()?.returns().noneType ?? true),
      type,
    );
  }

  for (const { segments, type, lock } of variables) {
    const token = builtInToken(toCase(caseKind, ...segments));
    if (lock) {
      libraryBuilder.declareLock(ScopeKind.global, token, builtInRange, type);
    } else {
      libraryBuilder.declareVariable(ScopeKind.global, token, builtInRange, type);
    }
  }

  return libraryBuilder.build();
};

/**
 * The symbol table of the celestial bodies
 * @param caseKind case of the names
 * @param celetrialBodies names of the bodies
 */
export const bodyLibraryBuilder = (
  caseKind: CaseKind,
  celetrialBodies = DEFAULT_BODIES,
): SymbolTable => {
  const bodyBuilder = new SymbolTableBuilder(builtIn);
  const bodyType = kosType('Body');

  for (const identifier of celetrialBodies) {
    bodyBuilder.declareVariable(
      ScopeKind.global,
      builtInToken(toCase(caseKind, identifier)),
      builtInRange,
      bodyType,
    );
  }

  return bodyBuilder.build();
};
