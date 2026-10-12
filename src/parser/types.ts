import * as Expr from './models/expr';
import * as Stmt from './models/stmt';
import * as SuffixTerm from './models/suffixTerm';
import { Var, Lock, Func, Param } from './models/declare';
import { Range, Location } from 'vscode-languageserver';
import { TokenType } from '../models/tokentypes';
import { NodeBase } from './models/base';
import { Token } from '../models/token';
import { ParseError } from './models/parserError';
import { DiagnosticUri } from '../types';

export interface RangeSequence extends Range {
  ranges: Range[];
}

export interface IDeclScope extends RangeSequence {
  declare?: Token;
  scope?: Token;
  type: ScopeKind;
  toString(): string;
}

export type NodeDataBuilder<T> = Partial<Writeable<NodeData<T>>>;

export type NodeData<T> = Properties<
  T,
  Token | NodeBase | NodeBase[] | undefined
>;

export type SuffixTermTrailer =
  | SuffixTerm.Call
  | SuffixTerm.BracketIndex
  | SuffixTerm.HashIndex
  | SuffixTerm.Delegate;

export type Atom =
  | SuffixTerm.Literal
  | SuffixTerm.Identifier
  | SuffixTerm.Grouping
  | SuffixTerm.Invalid;

export interface IParameter extends RangeSequence {
  identifier: Token;
  toLines(): string[];
}

export enum SyntaxKind {
  script,
  stmt,
  expr,
  suffixTerm,
}

export interface IScript extends RangeSequence {
  lazyGlobal: boolean;
  stmts: IStmt[];
  runStmts: RunStmtType[];
  uri: string;
  toLocation(): Location;
  toLines(): string[];
  toString(): string;
  tag: SyntaxKind.script;
}

export interface IStmt extends IStmtVisitable, RangeSequence {
  toLocation(uri: string): Location;
  toLines(): string[];
  toString(): string;
  tag: SyntaxKind.stmt;
}

export interface IExpr extends IExprVisitable, RangeSequence {
  toLocation(uri: string): Location;
  toLines(): string[];
  toString(): string;
  tag: SyntaxKind.expr;
}

export interface ISuffixTerm extends ISuffixTermVisitable, RangeSequence {
  toLocation(uri: string): Location;
  toString(): string;
  tag: SyntaxKind.suffixTerm;
}

export interface IStmtClass
  extends Constructor<Stmt.Stmt>, IExprVisitableClass {
  grammar: GrammarNode[];
}

export interface IExprClass<T = Expr.Expr>
  extends Constructor<T>, IExprVisitableClass {
  grammar: GrammarNode[];
}

export interface ISuffixTermClass<T = SuffixTerm.SuffixTermBase>
  extends Constructor<T>, ISuffixTermVisitableClass {
  grammar: GrammarNode[];
}

export interface IGrammarOptional {
  nodes: GrammarNode[];
  dist: Distribution;
  tag: 'optional';
}

export interface IGrammarRepeat {
  nodes: GrammarNode[];
  dist: Distribution;
  tag: 'repeat';
}

export interface IGrammarUnion {
  node: [GrammarNode, Distribution][];
  tag: 'union';
}

export type Distribution =
  | INormalDistribution
  | IGammaDistribution
  | IExponentialDistribution
  | IConstantDistribution;

export interface INormalDistribution {
  mean: number;
  std: number;
  tag: 'normal';
}

export interface IGammaDistribution {
  shape: number;
  scale: number;
  tag: 'gamma';
}

export interface IExponentialDistribution {
  rate: number;
  tag: 'exp';
}

export interface IConstantDistribution {
  value: number;
  tag: 'constant';
}

export interface IParseError extends Range {
  tag: 'parseError';
  token: Token;
  message: string;
  inner: IParseError[];
}

export interface Ast {
  script: IScript;
  diagnostics: DiagnosticUri[];
}

export interface IFindResult {
  node?: TreeNode;
  token: Token;
}

export interface INodeResult<T> {
  errors: ParseError[];
  value: T;
}

export enum ScopeKind {
  local,
  global,
}

export type PartialNode = {
  [key: string]: Token | TreeNode | undefined;
};

export type GrammarNode =
  | IExprClass
  | IStmtClass
  | ISuffixTermClass
  | TokenType
  | IGrammarOptional
  | IGrammarRepeat
  | IGrammarUnion;

export type RunStmtType = Stmt.Run | Stmt.RunPath | Stmt.RunOncePath;
export type ScriptNode = IStmt | IExpr | ISuffixTerm;
export type TreeNode =
  IScript | IStmt | IExpr | ISuffixTerm | IParameter | IDeclScope;

export interface IExprVisitable {
  accept<P extends unknown[], R>(visitor: IExprVisitor<P, R>, parameters: P): R;
}

export interface IExprVisitor<P extends unknown[], R> {
  visitExprInvalid(expr: Expr.Invalid, parameters: P): R;
  visitTernary(expr: Expr.Ternary, parameters: P): R;
  visitBinary(expr: Expr.Binary, parameters: P): R;
  visitUnary(expr: Expr.Unary, parameters: P): R;
  visitFactor(expr: Expr.Factor, parameters: P): R;
  visitSuffix(expr: Expr.Suffix, parameters: P): R;
  visitLambda(expr: Expr.Lambda, parameters: P): R;
}

export interface ISuffixTermVisitable {
  accept<P extends unknown[], R>(
    visitor: ISuffixTermVisitor<P, R>,
    parameters: P,
  ): R;
}

export interface ISuffixTermVisitor<P extends unknown[], R> {
  visitSuffixTermInvalid(suffixTerm: SuffixTerm.Invalid, parameters: P): R;
  visitSuffixTrailer(suffixTerm: SuffixTerm.SuffixTrailer, parameters: P): R;
  visitSuffixTerm(suffixTerm: SuffixTerm.SuffixTerm, parameters: P): R;
  visitCall(suffixTerm: SuffixTerm.Call, parameters: P): R;
  visitHashIndex(suffixTerm: SuffixTerm.HashIndex, parameters: P): R;
  visitBracketIndex(suffixTerm: SuffixTerm.BracketIndex, parameters: P): R;
  visitDelegate(suffixTerm: SuffixTerm.Delegate, parameters: P): R;
  visitLiteral(suffixTerm: SuffixTerm.Literal, parameters: P): R;
  visitIdentifier(suffixTerm: SuffixTerm.Identifier, parameters: P): R;
  visitGrouping(suffixTerm: SuffixTerm.Grouping, parameters: P): R;
}

export interface IExprVisitableClass {
  classAccept<T>(visitor: IExprClassVisitor<T>): T;
}

export interface IExprClassVisitor<T> {
  visitExprInvalid(exprClass: Constructor<Expr.Invalid>): T;
  visitTernary(exprClass: Constructor<Expr.Ternary>): T;
  visitBinary(exprClass: Constructor<Expr.Binary>): T;
  visitUnary(exprClass: Constructor<Expr.Unary>): T;
  visitFactor(exprClass: Constructor<Expr.Factor>): T;
  visitSuffix(exprClass: Constructor<Expr.Suffix>): T;
  visitAnonymousFunction(exprClass: Constructor<Expr.Lambda>): T;
}

export interface ISuffixTermVisitableClass {
  classAccept<T>(visitor: ISuffixTermClassVisitor<T>): T;
}

export interface ISuffixTermClassVisitor<T> {
  visitSuffixTermInvalid(suffixTerm: Constructor<SuffixTerm.Invalid>): T;
  visitSuffixTrailer(termClass: Constructor<SuffixTerm.SuffixTrailer>): T;
  visitSuffixTerm(termClass: Constructor<SuffixTerm.SuffixTerm>): T;
  visitCall(termClass: Constructor<SuffixTerm.Call>): T;
  visitHashIndex(termClass: Constructor<SuffixTerm.HashIndex>): T;
  visitBracketIndex(termClass: Constructor<SuffixTerm.BracketIndex>): T;
  visitDelegate(termClass: Constructor<SuffixTerm.Delegate>): T;
  visitLiteral(termClass: Constructor<SuffixTerm.Literal>): T;
  visitIdentifier(termClass: Constructor<SuffixTerm.Identifier>): T;
  visitGrouping(termClass: Constructor<SuffixTerm.Grouping>): T;
}

export interface IStmtVisitable {
  accept<P extends unknown[], R>(visitor: IStmtVisitor<P, R>, parameters: P): R;
}

export interface IStmtVisitor<P extends unknown[], R> {
  visitDeclVariable(decl: Var, parameters: P): R;
  visitDeclLock(decl: Lock, parameters: P): R;
  visitDeclFunction(decl: Func, parameters: P): R;
  visitDeclParameter(decl: Param, parameters: P): R;

  visitStmtInvalid(stmt: Stmt.Invalid, parameters: P): R;
  visitBlock(stmt: Stmt.Block, parameters: P): R;
  visitExpr(stmt: Stmt.ExprStmt, parameters: P): R;
  visitOnOff(stmt: Stmt.OnOff, parameters: P): R;
  visitCommand(stmt: Stmt.Command, parameters: P): R;
  visitCommandExpr(stmt: Stmt.CommandExpr, parameters: P): R;
  visitUnset(stmt: Stmt.Unset, parameters: P): R;
  visitUnlock(stmt: Stmt.Unlock, parameters: P): R;
  visitSet(stmt: Stmt.Set, parameters: P): R;
  visitChain(stmt: Stmt.Chain, parameters: P): R;
  visitDirective(stmt: Stmt.Directive, parameters: P): R;
  visitIf(stmt: Stmt.If, parameters: P): R;
  visitElse(stmt: Stmt.Else, parameters: P): R;
  visitUntil(stmt: Stmt.Until, parameters: P): R;
  visitFrom(stmt: Stmt.From, parameters: P): R;
  visitWhen(stmt: Stmt.When, parameters: P): R;
  visitReturn(stmt: Stmt.Return, parameters: P): R;
  visitBreak(stmt: Stmt.Break, parameters: P): R;
  visitSwitch(stmt: Stmt.Switch, parameters: P): R;
  visitFor(stmt: Stmt.For, parameters: P): R;
  visitOn(stmt: Stmt.On, parameters: P): R;
  visitToggle(stmt: Stmt.Toggle, parameters: P): R;
  visitWait(stmt: Stmt.Wait, parameters: P): R;
  visitLog(stmt: Stmt.Log, parameters: P): R;
  visitCopy(stmt: Stmt.Copy, parameters: P): R;
  visitRename(stmt: Stmt.Rename, parameters: P): R;
  visitDelete(stmt: Stmt.Delete, parameters: P): R;
  visitRun(stmt: Stmt.Run, parameters: P): R;
  visitRunPath(stmt: Stmt.RunPath, parameters: P): R;
  visitRunPathOnce(stmt: Stmt.RunOncePath, parameters: P): R;
  visitCompile(stmt: Stmt.Compile, parameters: P): R;
  visitList(stmt: Stmt.List, parameters: P): R;
  visitEmpty(stmt: Stmt.Empty, parameters: P): R;
  visitPrint(stmt: Stmt.Print, parameters: P): R;
}
