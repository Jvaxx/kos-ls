import {
  SymbolTrackerBase,
  KsSet,
  IKsDeclared,
  TrackerKind,
  KsBaseSymbol,
} from '../types';
import { structureType } from '../../typeChecker/ksTypes/primitives/structure';
import { Location } from 'vscode-languageserver';
import {
  binaryPreviousKey,
  binaryRightKey,
  locationEqual,
} from '../../utilities/positionUtils';
import { builtIn } from '../../utilities/constants';
import { IType } from '../../typeChecker/types';
import { empty } from '../../utilities/typeGuards';
import { flowType } from '../../typeChecker/models/types/flowUnionType';

export class BasicTracker<T extends KsBaseSymbol = KsBaseSymbol>
  implements SymbolTrackerBase {
  public readonly declared: IKsDeclared<T, IType>;

  /**
   * Information about locations where the this symbol was set
   */
  public readonly sets: KsSet[];

  /**
   * Locations where this symbol was used
   */
  public readonly usages: Location[];

  constructor(
    symbol: T,
    public uri: string,
    public type: IType = structureType,
  ) {
    this.declared = {
      symbol,
      type,
      uri: symbol.name.uri,
      range: symbol.name.range,
    };
    this.sets = [];
    this.usages = [];
  }

  /**
   * What kind of tracker is this type
   */
  public get kind(): TrackerKind.basic {
    return TrackerKind.basic;
  }

  /**
   * Set the declared type of this symbol
   * @param type type to declare this symbol
   */
  public declareType(type: IType): void {
    this.declared.type = type;
  }

  /**
   * Get the type at a location
   * @param loc query location
   */
  public getType(loc: Location): Maybe<IType> {
    // if builtin type can't change so just return declared type
    if (this.declared.uri === builtIn) {
      return this.declared.type;
    }

    // Will need to do better this sort of handles the case of
    // local x is 0. set x to x + 1.
    const ranges = this.sets.filter(
      set => set.uri === loc.uri && set.type !== structureType,
    );
    // the last set before the location
    const found = binaryPreviousKey(ranges, loc.range.start, x => x.range);
    const current = (found && found.type) || this.declared.type;
    if (empty(current)) {
      return current;
    }

    // with the other types it is given anywhere, as kOS types at runtime
    const others: IType[] = [];
    for (const type of [this.declared.type, ...this.sets.map(set => set.type)]) {
      if (!empty(type) && type !== structureType && type !== current) {
        others.push(type);
      }
    }
    return others.length === 0 ? current : flowType(current, others);
  }

  /**
   * Set the type at a location
   * @param loc location to set
   * @param type type to set
   */
  public setType(loc: Location, type: IType): void {
    // if builtin type can't change so just return exit
    if (this.declared.uri === builtIn) {
      return;
    }

    const ranges = this.sets.filter(set => set.uri === loc.uri);
    const nearestSet = binaryRightKey(ranges, loc.range.start, x => x.range);

    if (!empty(nearestSet) && locationEqual(nearestSet, loc)) {
      nearestSet.type = type;
    }
  }
}

/**
 * Create a set symbol
 * @param loc location to create the set
 * @param type type of this set
 */
export const createSymbolSet = (
  loc: Location,
  type: IType = structureType,
): KsSet => ({ type, uri: loc.uri, range: loc.range });
