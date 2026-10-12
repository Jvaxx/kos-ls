import { ICallSignature, IIndexer, IParametricType, IType } from '../../types';
import { UnionType } from './unionType';
import { empty } from '../../../utilities/typeGuards';
import { typeId } from '../../utilities/typeCreators';

/**
 * The types a variable is given over a script: its type where it is used
 * first, then the others (`local port is 0.` then `set port to target.`).
 *
 * kOS checks types at runtime, so it is used leniently: a suffix, an
 * operator, an indexer or a coercion is valid when one of the types
 * allows it.
 */
export class FlowUnionType extends UnionType {
  /**
   * Members in order: the type at the use comes first
   */
  protected keepsOrder(): boolean {
    return true;
  }

  /**
   * A subtype when one of its types is
   * @param type the type to check against
   */
  public isSubtypeOf(type: IParametricType): boolean {
    return (
      type === this || this.types.some((member) => member.isSubtypeOf(type))
    );
  }

  /**
   * The indexer of the first type that has one
   */
  public indexer(): Maybe<IIndexer> {
    for (const type of this.types) {
      const indexer = type.indexer();
      if (!empty(indexer)) {
        return indexer;
      }
    }
    return undefined;
  }

  /**
   * The call signature of the first type that has one
   */
  public callSignature(): Maybe<ICallSignature> {
    for (const type of this.types) {
      const signature = type.callSignature();
      if (!empty(signature)) {
        return signature;
      }
    }
    return undefined;
  }

  /**
   * The type at the use
   */
  public assignmentType(): IType {
    return this;
  }

  /**
   * The types, the one at the use first
   */
  public toString(): string {
    return this.types.map((type) => type.toString()).join(' or ');
  }
}

const flowCache = new Map<string, IType>();

/**
 * The type of a variable given several types
 * @param current its type at the use
 * @param others the other types it is given
 */
export const flowType = (current: IType, others: IType[]): IType => {
  // members of the same kind only (no functions with values)
  const types = [current];
  for (const type of others) {
    if (!types.includes(type) && type.kind === current.kind) {
      types.push(type);
    }
  }
  if (types.length === 1) {
    return current;
  }

  const key = types.map(typeId).join(',');
  let type = flowCache.get(key);
  if (type === undefined) {
    type = new FlowUnionType(false, ...types);
    flowCache.set(key, type);
  }
  return type;
};
