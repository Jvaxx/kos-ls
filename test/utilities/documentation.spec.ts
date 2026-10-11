// the primitives first: the type modules import each other in a cycle that
// only resolves from them
import { scalarType } from '../../src/typeChecker/ksTypes/primitives/scalar';
import { stringType } from '../../src/typeChecker/ksTypes/primitives/string';
import { structureType } from '../../src/typeChecker/ksTypes/primitives/structure';
import { noneType } from '../../src/typeChecker/ksTypes/primitives/none';
import {
  createArgSuffixType,
  createFunctionType,
  createSetSuffixType,
  createUnion,
  createVarFunctionType,
  createVarType,
} from '../../src/typeChecker/utilities/typeCreators';
import { kosType, typeInitializer } from '../../src/typeChecker/initialize';
import {
  formatDocs,
  formatHover,
  formatSignature,
  parameterLabels,
} from '../../src/utilities/documentation';

typeInitializer();

describe('Documentation', () => {
  test('signatures name the parameters from the docs', () => {
    const type = createFunctionType(
      'burn',
      scalarType,
      scalarType,
      createUnion(true, stringType, noneType),
    );
    const docs = { params: [{ name: 'dv', doc: 'delta-v' }, { name: 'label' }] };

    expect(formatSignature('burn', type, docs)).toBe(
      'burn(dv: Scalar, label?: String): Scalar',
    );
    expect(formatSignature('burn', type)).toBe('burn(Scalar, String?): Scalar');
    expect(parameterLabels(type, docs)).toEqual([
      { label: 'dv: Scalar', doc: 'delta-v' },
      { label: 'label?: String', doc: undefined },
    ]);
  });

  test('a variadic parameter and no return', () => {
    const type = createVarFunctionType(
      'show',
      noneType,
      createVarType(structureType),
    );

    expect(formatSignature('show', type, { params: [{ name: 'items' }] })).toBe(
      'show(...items: Structure)',
    );
  });

  test('a property shows its type, access and units', () => {
    const type = createSetSuffixType('power', scalarType);
    const docs = { doc: 'The power.', units: 'kW', url: 'https://x/p' };

    expect(formatSignature('power', type, docs)).toBe('power: Scalar');
    expect(formatDocs(docs, type.access)).toBe(
      '*Access: get, set · Units: kW*\n\nThe power.\n\n[kOS documentation](https://x/p)',
    );
  });

  test('a hover has the signature in a code block, then the docs', () => {
    const type = createArgSuffixType('tune', scalarType, scalarType);
    const docs = { doc: 'Tune it.', params: [{ name: 'hz', doc: 'in Hz' }] };

    expect(formatHover('suffix', 'tune', type, docs, type.access)).toBe(
      '```kerboscript\n(suffix) tune(hz: Scalar): Scalar\n```\n\n' +
        'Tune it.\n\n- `hz`: in Hz',
    );
    expect(formatHover('literal', '1', scalarType)).toBe(
      '```kerboscript\n(literal) 1: Scalar\n```',
    );
  });

  test('suffixes of applied collections keep their docs', () => {
    const list = kosType('List');
    const add = list.getSuffix('add');

    expect(add?.docs?.doc).toBeDefined();
  });
});
