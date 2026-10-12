import { IFindResult, TreeNode } from './types';
import * as Decl from './models/declare';
import * as Stmt from './models/stmt';
import * as Expr from './models/expr';
import * as SuffixTerm from './models/suffixTerm';
import { Position } from 'vscode-languageserver';
import {
  binarySearch,
  positionEqual,
  rangeContainsPos,
} from '../utilities/positionUtils';
import { empty } from '../utilities/typeGuards';
import { isToken, Token } from '../models/token';
import { TokenType } from '../models/tokentypes';
import { TreeExecute } from '../utilities/treeExecute';

export type AstContext =
  | Constructor<Expr.Expr>
  | Constructor<Stmt.Stmt>
  | Constructor<SuffixTerm.SuffixTermBase>
  | Constructor<Decl.Parameter>;

/**
 * Tokens that give way to the name they touch
 */
const punctuation = new Set([
  TokenType.bracketOpen,
  TokenType.bracketClose,
  TokenType.curlyOpen,
  TokenType.curlyClose,
  TokenType.squareOpen,
  TokenType.squareClose,
  TokenType.comma,
  TokenType.colon,
  TokenType.period,
  TokenType.atSign,
]);

/**
 * Is this token punctuation
 * @param token the token
 */
const isPunctuation = (token: Token): boolean => punctuation.has(token.type);

export class ScriptFind extends TreeExecute<Maybe<IFindResult>> {
  private pos: Position;
  private contexts: AstContext[];

  /**
   * Where two ranges touch, search the one starting at the position
   */
  private next: boolean;

  constructor() {
    super();
    this.pos = {
      line: 0,
      character: 0,
    };
    this.contexts = [];
    this.next = true;
  }

  /**
   * Find a token within a tree node
   * @param syntaxNode node to search in
   * @param pos position to find
   * @param contexts list of contexts to captures
   */
  public find(
    syntaxNode: TreeNode,
    pos: Position,
    ...contexts: AstContext[]
  ): Maybe<IFindResult> {
    this.pos = pos;
    this.contexts = contexts;

    // the character under the cursor: in `ship:mass` the `m` is `mass`
    this.next = true;
    const under = this.nodeAction(syntaxNode);
    if (
      !empty(under) &&
      (!isPunctuation(under.token) || !positionEqual(under.token.start, pos))
    ) {
      return under;
    }

    // punctuation gives way to the token ending there: in `vang(` the
    // `(` is `vang`, the end of a word being completed is the word, and
    // in `ship:)` the position after the colon is the colon. So does the
    // empty suffix of an unfinished `ship:`
    this.next = false;
    const before = this.nodeAction(syntaxNode);
    return !empty(before) && positionEqual(before.token.end, pos)
      ? before
      : under;
  }

  protected nodeAction(node: TreeNode): Maybe<IFindResult> {
    const searchResult = binarySearch(node.ranges, this.pos, this.next);
    if (empty(searchResult)) {
      return searchResult;
    }

    // search expression if expression
    if (searchResult instanceof SuffixTerm.SuffixTermBase) {
      const findResult = this.suffixTermAction(searchResult);

      // add context if not set yet
      if (!empty(findResult) && this.addContext(findResult, node)) {
        findResult.node = node;
      }

      return findResult;
    }

    // search expression if expression
    if (searchResult instanceof Expr.Expr) {
      const findResult = this.exprAction(searchResult);

      // add context if not set yet
      if (!empty(findResult) && this.addContext(findResult, node)) {
        findResult.node = node;
      }

      return findResult;
    }

    // search statement if statement
    if (searchResult instanceof Stmt.Stmt) {
      const findResult = this.stmtAction(searchResult);

      // add context if not set yet
      if (!empty(findResult) && this.addContext(findResult, node)) {
        findResult.node = node;
      }

      return findResult;
    }

    // search an optional parameter
    if (searchResult instanceof Decl.DefaultParam) {
      if (rangeContainsPos(searchResult.identifier, this.pos)) {
        return {
          token: searchResult.identifier,
          node: this.isContext(node)
            ? node
            : this.isContext(searchResult)
            ? searchResult
            : undefined,
        };
      }
      if (rangeContainsPos(searchResult.value, this.pos)) {
        return this.exprAction(searchResult.value);
      }

      return undefined;
    }

    // search a normal parameter
    if (searchResult instanceof Decl.Parameter) {
      return {
        node: this.isContext(node)
          ? node
          : this.isContext(searchResult)
          ? searchResult
          : undefined,
        token: searchResult.identifier,
      };
    }

    // return result if token found
    if (isToken(searchResult)) {
      return {
        node: this.isContext(node) ? node : undefined,
        token: searchResult,
      };
    }

    // return result if token found
    if (searchResult instanceof Decl.Scope) {
      if (
        !empty(searchResult.scope) &&
        rangeContainsPos(searchResult.scope, this.pos)
      ) {
        return {
          node: undefined,
          token: searchResult.scope,
        };
      }

      if (
        !empty(searchResult.declare) &&
        rangeContainsPos(searchResult.declare, this.pos)
      ) {
        return {
          node: undefined,
          token: searchResult.declare,
        };
      }
    }

    throw new Error('Unexpected result found.');
  }

  private addContext(findResult: IFindResult, node: TreeNode): boolean {
    return empty(findResult.node) && this.isContext(node);
  }

  // is the correct context
  private isContext(node: TreeNode): boolean {
    return this.contexts.some(context => node instanceof context);
  }
}
