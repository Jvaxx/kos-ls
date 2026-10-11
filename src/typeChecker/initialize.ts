import { primitiveInitializer } from './ksTypes/primitives/initialize';
import { collectionInitializer } from './ksTypes/collections/initialize';
import { timeInitializer } from './ksTypes/time/initalize';
import { kosDatabase, KosTypes, loadDatabase } from './database/loader';

let types: Maybe<KosTypes>;

/**
 * The types of the kOS database, built on first use over the
 * hand-written primitives and collections
 */
export const kosTypes = (): KosTypes => {
  if (types === undefined) {
    primitiveInitializer();
    collectionInitializer();
    timeInitializer();
    types = loadDatabase(kosDatabase);
  }
  return types;
};

/**
 * A structure of the kOS database, by kOS name
 * @param name kOS name in any case, e.g. `Vessel`
 * @throws if kOS has no such structure
 */
export const kosType = (name: string) => {
  const type = kosTypes().structure(name);
  if (type === undefined) {
    throw new Error(`kOS has no structure ${name}`);
  }
  return type;
};

export const typeInitializer = () => {
  kosTypes();
};
