import { TokenType } from './tokentypes';
import { Range, Position } from 'vscode-languageserver';
import { Literal, TokenBase } from './types';
import { SymbolTracker } from '../analysis/types';

/**
 * A `//` comment kept by the scanner. It is trivia: the parser never sees
 * it, but it stays attached to the token that follows it.
 */
export interface Comment {
  /**
   * The whole comment, `//` included, without the line break
   */
  readonly text: string;

  /**
   * Where the comment is in the source
   */
  readonly range: Range;

  /**
   * Whether code precedes the comment on its line
   */
  readonly trailing: boolean;
}

/**
 * Represents  an atomic unit of the kerboscript language
 */
export class Token<T extends TokenType = TokenType> implements TokenBase<T> {
  public readonly type: T;
  public readonly lexeme: string;
  public readonly literal: Literal;
  public readonly start: Position;
  public readonly end: Position;
  public readonly uri: string;

  /**
   * What symbol tracker is this token tied too
   */
  public tracker: Maybe<SymbolTracker>;

  /**
   * Comments between the previous token and this one, in source order
   */
  public leadingComments: Maybe<Comment[]>;

  constructor(
    type: T,
    lexeme: string,
    literal: Literal,
    start: Position,
    end: Position,
    uri: string,
  ) {
    this.type = type;
    this.lexeme = lexeme;
    this.literal = literal;
    this.start = start;
    this.end = end;
    this.uri = uri;
    this.tracker = undefined;
    this.leadingComments = undefined;
  }

  /**
   * A lowercase version of the lexeme for case insensitive comparisons
   */
  public get lookup(): string {
    return this.lexeme.toLowerCase();
  }

  public get tag(): 'token' {
    return 'token';
  }

  public get typeString(): string {
    return TokenType[this.type];
  }

  public get range(): Range {
    return {
      start: this.start,
      end: this.end,
    };
  }

  /**
   * Convert the token to a human readable string
   */
  public toString(): string {
    if (this.literal) {
      return `${this.typeString} ${this.lexeme} ${this.literal}`;
    }
    return `${this.typeString} ${this.lexeme}`;
  }
}

/**
 * Is the value a token: `instanceof` alone gives `Token<any>`
 * @param value any value
 */
export const isToken = (value: unknown): value is Token =>
  value instanceof Token;
