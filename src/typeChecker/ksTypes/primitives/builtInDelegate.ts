import { createType, noMap } from '../../utilities/typeCreators';
import { delegateType } from './delegate';

export const builtInDelegateType = createType('BuiltinDelegate');
builtInDelegateType.addSuper(noMap(delegateType));
