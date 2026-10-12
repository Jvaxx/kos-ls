import {
  IType,
  Access,
  TypeKind,
  IParametricType,
  OperatorKind,
  IIndexer,
  ICallSignature,
} from '../../types';
import { TypeTracker } from '../../../analysis/models/typeTracker';
import { Operator } from './operator';
import { KsSymbol } from '../../../analysis/types';
import { KsSuffix } from '../../../models/suffix';
import { empty } from '../../../utilities/typeGuards';
import { createIndexer } from '../../utilities/typeCreators';

/**
 * A class representing a type in Kerboscript
 */
export class UnionType implements IType {
  /**
   * What is the name of this union
   */
  public readonly name: string;

  /**
   * What access level does this union have
   */
  public readonly access: Access;

  /**
   * Is this union the any type
   */
  public readonly anyType: boolean;

  /**
   * Is this union the none type
   */
  public readonly noneType: boolean;

  /**
   * What is the type of this union
   */
  public readonly kind: TypeKind;

  /**
   * The tracker for this type. Should only occur if this is a suffix
   */
  private readonly typeTracker: TypeTracker;

  /**
   * What are the internal type of this union
   */
  public readonly types: IType[];

  /**
   * Is this type parameter for a boolean
   */
  private readonly param: boolean;

  /**
   * Construct a new union type
   * @param isParameter Is this for a call parameter
   * @param types types of the union
   */
  constructor(isParameter: boolean, ...types: IType[]) {
    if (types.length < 2) {
      throw new Error('Union must be at least two types');
    }

    if (!types.every((type) => type.kind === types[0].kind)) {
      throw new Error('Union must be the same type');
    }

    const sortedTypes = this.keepsOrder()
      ? [...types]
      : types.sort((a, b) => {
          if (a.name < b.name) {
            return -1;
          }

          if (a.name > b.name) {
            return 1;
          }

          return 0;
        });

    this.param = isParameter;
    this.types = sortedTypes;
    this.name = 'Union';
    this.anyType = sortedTypes.some((type) => type.anyType);
    this.noneType = sortedTypes.some((type) => type.noneType);
    this.access = {
      get: sortedTypes.every((type) => type.access.get),
      set: sortedTypes.every((type) => type.access.set),
    };
    this.kind = sortedTypes[0].kind;
    this.typeTracker = new TypeTracker(new KsSuffix(this.name), this);
  }

  /**
   * Whether the members keep their order (see FlowUnionType)
   */
  protected keepsOrder(): boolean {
    return false;
  }

  /**
   * Is this union type a subtype of some other type
   * @param type the type to check against
   */
  public isSubtypeOf(type: IParametricType): boolean {
    if (type === this) {
      return true;
    }

    if (type instanceof UnionType) {
      // if every member has a subtype then we're a subtype
      for (const unionType of type.types) {
        if (
          !this.types.some((thisUnionType) =>
            thisUnionType.isSubtypeOf(unionType),
          )
        ) {
          return false;
        }
      }

      return true;
    }

    // a union of subtypes is a subtype: `Vessel or Boolean` is a Structure
    return this.types.every((member) => member.isSubtypeOf(type));
  }

  /**
   * What is the assignment type of this type
   */
  public assignmentType(): IType {
    const assignmentTypes = new Set(
      this.types.map((type) => type.assignmentType()),
    );
    if (assignmentTypes.size > 1) {
      return new UnionType(false, ...assignmentTypes);
    }

    return [...assignmentTypes][0];
  }

  /**
   * Get the super type
   */
  public super(): Maybe<IType> {
    return undefined;
  }

  /**
   * The sub types of this type
   */
  public subTypes(): IType[] {
    return this.types;
  }

  /**
   * Get the type tracker
   */
  public tracker(): TypeTracker<KsSymbol> {
    return this.typeTracker;
  }

  /**
   * Get call signature. TODO could attempt to see if the call signatures could be merged
   * somehow
   */
  public callSignature(): Maybe<ICallSignature> {
    return undefined;
  }

  /**
   * Get indexer of this union type. If all types have an indexer with the same index type
   */
  public indexer(): Maybe<IIndexer> {
    const indexer = this.types[0].indexer();
    if (empty(indexer)) {
      return undefined;
    }
    const callSignature = indexer.callSignature();
    if (empty(callSignature)) {
      return undefined;
    }

    const returns = new Set<IType>();

    const same = this.types.every((type) => {
      const typeIndexer = type.indexer();
      if (empty(typeIndexer)) {
        return false;
      }

      const typeCallSignature = typeIndexer.callSignature();
      if (empty(typeCallSignature)) {
        return false;
      }

      returns.add(typeCallSignature.returns());
      return typeCallSignature.params()[0] === callSignature.params()[0];
    });

    if (!same) {
      return undefined;
    }

    if (returns.size === 1) {
      return indexer;
    }

    return createIndexer(
      callSignature.params()[0],
      new UnionType(false, ...returns),
    );
  }

  /**
   * Get all suffixes present in all members of the union type
   */
  public suffixes(): Map<string, IType> {
    // the suffixes of every member, as getSuffix finds them
    const suffixes = new Map<string, IType>();
    for (const type of this.types) {
      for (const [name, suffix] of type.suffixes()) {
        if (!suffixes.has(name)) {
          suffixes.set(name, suffix);
        }
      }
    }

    return suffixes;
  }

  /**
   * Does this type have the requested suffix TODO this may be an issue where
   * a union has two suffixes of the same name but not the same type
   * @param name name of the suffix
   */
  public hasSuffix(name: string): boolean {
    return this.types.some((type) => type.hasSuffix(name));
  }

  /**
   * Attempt to retrieve a suffix from this type TODO this may be an issue where
   * a union has two suffixes of the same name but not the same type
   * @param name name of the suffix
   */
  public getSuffix(name: string): Maybe<IType> {
    // the suffix of the members that have it: kOS checks at runtime, and
    // scripts test the type first (`open(path)` is a file, a directory
    // or false)
    for (const type of this.types) {
      const suffix = type.getSuffix(name);
      if (!empty(suffix)) {
        return suffix;
      }
    }

    return undefined;
  }

  /**
   * Get an operator for the other type
   * @param kind The operator kind
   * @param other the type of the other type
   */
  public getOperator(
    kind: OperatorKind,
    other?: IType,
  ): Maybe<Operator<IType>> {
    // the operator of the first member that has one: kOS checks at runtime
    for (const type of this.types) {
      const operator = type.getOperator(kind, other);
      if (!empty(operator)) {
        return operator;
      }
    }

    return undefined;
  }

  /**
   * Get all operators. TODO attempt to merge operators
   */
  public operators(): Map<OperatorKind, Operator<IType>[]> {
    return new Map();
  }

  public canCoerceFrom(type: IParametricType): boolean {
    // if type no coercion needed
    if (type === this) {
      return true;
    }

    // if any type can coerce
    if (type.anyType) {
      return true;
    }

    return this.types.some((unionType) => unionType.canCoerceFrom(type));
  }

  /**
   * Get all available coercions
   */
  public coercions(): Set<IParametricType> {
    const coercions = new Set<IParametricType>();
    for (const type of this.types) {
      for (const coercion of type.coercions()) {
        coercions.add(coercion);
      }
    }

    return coercions;
  }

  /**
   * Apply type arguments to this union type
   * @param _ type arguments
   */
  public apply(_: IType | Map<IParametricType, IType>): IType {
    return this;
  }

  /**
   * Get a string representation of this type
   */
  public toString(): string {
    if (this.param) {
      const optional = this.types.some((type) => type.noneType);

      if (optional) {
        if (this.types.length <= 2) {
          return this.types
            .filter((type) => !type.noneType)
            .map((type) => `${type.toString()}?`)
            .join(' or ');
        }

        const typeString = this.types
          .filter((type) => !type.noneType)
          .map((type) => type.toString())
          .join(' or ');

        return `(${typeString})?`;
      }

      return this.types.map((type) => type.toString()).join(' or ');
    }

    return this.types.map((type) => type.toString()).join(' or ');
  }

  /**
   * Get the type parameters of this type
   */
  public getTypeParameters(): IParametricType[] {
    return [];
  }
}
