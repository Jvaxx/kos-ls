import { TypeKind } from '../../types';
import { Type } from '../../models/types/type';

export const noneType = new Type(
  'None',
  { get: false, set: false },
  new Map(),
  TypeKind.basic,
  undefined,
  undefined,
  false,
  true,
);
