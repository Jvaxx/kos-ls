import { TokenType } from '../models/tokentypes';
import { Token, Comment } from '../models/token';
import { DirectiveTokens } from '../directives/types';
import { DiagnosticUri } from '../types';
import { Literal } from '../models/types';

export type ITokenMap = Map<string, { type: TokenType; literal?: Literal }>;

export interface Tokenized {
  tokens: Token[];
  diagnostics: DiagnosticUri[];
  directiveTokens: DirectiveTokens[];

  /**
   * Comments after the last token. Every other comment is in the
   * `leadingComments` of the token that follows it.
   */
  trailingComments: Comment[];
}

/**
 * The results kinda from the scanner
 */
export const enum ScanKind {
  /**
   * The scanner encountered whitespace
   */
  Whitespace,

  /**
   * The scanner encountered a token
   */
  Token,

  /**
   * The scanner produced a error diagnostics
   */
  Diagnostic,

  /**
   * The scanner found a directive
   */
  Directive,
}

export type Result<T, S extends ScanKind> = {
  result: T;
  kind: S;
};

/**
 * A token result
 */
export type ScanToken = Result<Token, ScanKind.Token>;

/**
 * A whitespace result
 */
export type ScanWhitespace = Result<null, ScanKind.Whitespace>;

/**
 * A diagnostics result
 */
export type ScanDiagnostic = Result<DiagnosticUri, ScanKind.Diagnostic>;

/**
 * A directive result
 */
export type ScanDirective<T extends TokenType = TokenType> = {
  directive: Token<T>;
  tokens: Token[];
  diagnostics: DiagnosticUri[];
  kind: ScanKind.Directive;
};

export type ScanResult =
  | ScanToken
  | ScanWhitespace
  | ScanDiagnostic
  | ScanDirective;
