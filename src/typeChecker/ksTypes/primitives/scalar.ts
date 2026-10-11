import { createType } from '../../utilities/typeCreators';

export const scalarType = createType('Scalar');

// literals are typed as integers or doubles, which kOS calls Scalar
export const integerType = createType('Scalar');
export const doubleType = createType('Scalar');
