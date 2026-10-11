import { IFunctionScanResult } from './types';
import * as Decl from '../parser/models/declare';
import * as Expr from '../parser/models/expr';
import * as Stmt from '../parser/models/stmt';
import { TreeTraverse } from '../utilities/treeTraverse';

/**
 * Class to help identify parameters and return statements in
 * a kerboscript function
 */
export class FunctionScan extends TreeTraverse {
  /**
   * result of the scan
   */
  private result: IFunctionScanResult;

  /**
   * How many loops and branches enclose the current node
   */
  private depth = 0;

  /**
   * Function scan constructor
   */
  constructor() {
    super();
    this.result = {
      requiredParameters: 0,
      optionalParameters: 0,
      return: false,
      variadic: false,
    };
  }

  /**
   * Scan the function node for parameters and return statements
   * @param node function body
   */
  public scan(node: Stmt.Block): IFunctionScanResult {
    this.result = {
      requiredParameters: 0,
      optionalParameters: 0,
      return: false,
      variadic: false,
    };
    this.depth = 0;

    this.stmtAction(node);

    return { ...this.result };
  }

  /**
   * Indicate that the function has a return statement
   * @param _ return statement
   */
  public visitReturn(_: Stmt.Return): void {
    this.result.return = true;
  }

  /**
   * Don't proceed further in if enter another function
   * @param _ function declaration
   */
  public visitDeclFunction(_: Decl.Func): void {}

  /**
   * Add required and optional parameters when found
   * @param decl parameter declaration
   */
  public visitDeclParameter(decl: Decl.Param): void {
    this.result.requiredParameters += decl.requiredParameters.length;
    this.result.optionalParameters += decl.optionalParameters.length;
    if (this.depth > 0) {
      this.result.variadic = true;
    }
  }

  /**
   * Parameters read in a loop or branch take a varying number of arguments
   * @param visit visit of the loop or branch
   */
  private enclosed(visit: () => void): void {
    this.depth += 1;
    visit();
    this.depth -= 1;
  }

  public visitIf(stmt: Stmt.If): void {
    this.enclosed(() => super.visitIf(stmt));
  }

  public visitUntil(stmt: Stmt.Until): void {
    this.enclosed(() => super.visitUntil(stmt));
  }

  public visitFrom(stmt: Stmt.From): void {
    this.enclosed(() => super.visitFrom(stmt));
  }

  public visitFor(stmt: Stmt.For): void {
    this.enclosed(() => super.visitFor(stmt));
  }

  /**
   * Don't proceed further if another lambda is encountered
   * @param expr lambda expression
   */
  public visitLambda(_: Expr.Lambda): void {}
}
