import {
  createSuffixType,
  createArgSuffixType,
  createFunctionType,
  noMap,
  createIndexer,
} from './typeCreators';
import { structureType } from '../ksTypes/primitives/structure';
import { IType, TypeKind } from '../types';
import { DelegateType } from '../models/types/delegateType';

export const delegateError = createFunctionType(
  'Unknown function',
  structureType,
);

export const delegateCreation = (type: IType) => {
  const delegate = type.kind === TypeKind.function ? type : delegateError;

  return createArgSuffixType('delegate creation', new DelegateType(delegate));
};

export const indexerError = createIndexer(structureType, structureType);
export const callableError = createSuffixType('Unknown callable', structureType);
export const suffixError = createSuffixType('Unknown suffix', structureType);

export const functionError = createFunctionType(
  'Unknown function',
  structureType,
);

export const defaultSuffix = (name: string) =>
  noMap(createSuffixType(name, structureType));

/**
 * Find a suffix on the types derived from a type, nearest first: a value
 * typed Part may be an Engine at runtime
 * @param type the type without the suffix
 * @param name name of the suffix
 */
export const derivedSuffix = (type: IType, name: string): Maybe<IType> => {
  const queue = [...(type.derived ?? [])];
  for (let i = 0; i < queue.length; i += 1) {
    const suffix = queue[i].getSuffix(name);
    if (suffix !== undefined) {
      return suffix;
    }
    queue.push(...(queue[i].derived ?? []));
  }
  return undefined;
};
