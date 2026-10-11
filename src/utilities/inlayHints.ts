import { InlayHint, InlayHintKind, Range } from 'vscode-languageserver';
import { IStmt } from '../parser/types';
import * as Decl from '../parser/models/declare';
import * as Stmt from '../parser/models/stmt';
import { Token } from '../models/token';
import { TreeTraverse } from './treeTraverse';
import { tokenTrackedType } from '../typeChecker/utilities/typeUtilities';
import { rangeIntersection } from './positionUtils';
import { cleanPosition } from './clean';

/**
 * Finds the names declared with a value: variables, locks and loop
 * elements
 */
class DeclaredNames extends TreeTraverse {
  private found: Token[] = [];

  public find(stmts: IStmt[]): Token[] {
    this.found = [];
    for (const stmt of stmts) {
      this.stmtAction(stmt);
    }
    return this.found;
  }

  public visitDeclVariable(decl: Decl.Var): void {
    this.found.push(decl.identifier);
    super.visitDeclVariable(decl);
  }

  public visitDeclLock(decl: Decl.Lock): void {
    this.found.push(decl.identifier);
    super.visitDeclLock(decl);
  }

  public visitFor(stmt: Stmt.For): void {
    this.found.push(stmt.element);
    super.visitFor(stmt);
  }
}

/**
 * Inlay hints of the types inferred for the names declared in a range:
 * `local x: Vessel is ship.`. Unknown types (Structure) get none
 * @param stmts statements of the script
 * @param range range shown by the client
 */
export const typeInlayHints = (stmts: IStmt[], range: Range): InlayHint[] => {
  const hints: InlayHint[] = [];

  for (const name of new DeclaredNames().find(stmts)) {
    if (!rangeIntersection(name, range)) {
      continue;
    }

    const type = tokenTrackedType(name);
    if (type === undefined || type.anyType || type.noneType) {
      continue;
    }

    hints.push({
      position: cleanPosition(name.end),
      label: `: ${type.toString()}`,
      kind: InlayHintKind.Type,
    });
  }

  return hints;
};
