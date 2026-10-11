// the primitives first: the type modules import each other in a cycle that
// only resolves from them
import { scalarType } from '../../src/typeChecker/ksTypes/primitives/scalar';
import { loadDatabase } from '../../src/typeChecker/database/loader';
import { KosDatabase } from '../../src/typeChecker/database/schema';
import { stringType } from '../../src/typeChecker/ksTypes/primitives/string';
import { booleanType } from '../../src/typeChecker/ksTypes/primitives/boolean';
import { structureType } from '../../src/typeChecker/ksTypes/primitives/structure';
import { vectorType } from '../../src/typeChecker/ksTypes/collections/vector';
import { flowType, FlowUnionType } from '../../src/typeChecker/models/types/flowUnionType';
import { derivedSuffix } from '../../src/typeChecker/utilities/typeHelpers';
import { OperatorKind } from '../../src/typeChecker/types';
import { createUnion } from '../../src/typeChecker/utilities/typeCreators';
import { typeInitializer } from '../../src/typeChecker/initialize';

/**
 * A small database: a hierarchy of generated structures, a core
 * structure with documentation and a suffix it lacks, and builtins
 */
const database: KosDatabase = {
  kos: '0.0.0',
  docsBase: 'https://docs.example/',
  structures: {
    Scalar: {
      doc: 'A number.',
      url: 'math/scalar.html',
      suffixes: { gadgetCount: { access: 'get', type: 'Scalar' } },
    },
    Machine: {
      doc: 'Any machine.',
      suffixes: { mass: { access: 'get', type: 'Scalar', units: 't' } },
    },
    Gadget: {
      inherits: 'Machine',
      doc: 'A gadget.',
      url: 'gadget.html',
      suffixes: {
        power: {
          access: 'getset',
          type: 'Scalar',
          units: 'kW',
          doc: 'The power.',
          url: 'gadget.html#attribute:GADGET:POWER',
          aliases: ['pow'],
        },
        tune: {
          access: 'call',
          type: 'Boolean',
          params: [
            { name: 'frequency', type: 'Scalar', doc: 'in Hz' },
            { name: 'label', type: 'String', optional: true },
          ],
        },
        parts: { access: 'get', type: 'List<Gadget>' },
        target: { access: 'get', type: 'Gadget | Vector' },
      },
    },
    Bag: { dynamic: true, suffixes: {} },
  },
  functions: {
    makeGadget: {
      returns: 'Gadget',
      aliases: ['newGadget'],
      doc: 'Make a gadget.',
      params: [{ name: 'name', type: 'String' }],
    },
    printAll: {
      returns: 'None',
      params: [{ type: 'Structure', optional: true, variadic: true }],
    },
  },
  variables: {
    myGadget: { type: 'Gadget', access: 'get', doc: 'The gadget.' },
    gadgetPower: { type: 'Scalar', access: 'getset', lock: true },
  },
};

// the operators of the primitives
typeInitializer();
const types = loadDatabase(database);
const gadget = types.structure('gadget')!;
const machine = types.structure('Machine')!;

describe('kOS database loader', () => {
  test('builds structures with their base and suffixes', () => {
    expect(gadget.toString()).toBe('Gadget');
    expect(gadget.super()).toBe(machine);
    expect(machine.super()).toBe(structureType);
    expect(types.structure('Unknown')).toBeUndefined();

    // inherited and aliased suffixes
    expect(gadget.getSuffix('mass')).toBe(machine.getSuffix('mass'));
    expect(gadget.getSuffix('pow')).toBeDefined();
    expect(gadget.getSuffix('power')!.access).toEqual({ get: true, set: true });
    expect(gadget.getSuffix('mass')!.access).toEqual({ get: true, set: false });

    // element types and unions
    const parts = gadget.getSuffix('parts')!.assignmentType();
    expect(parts.toString()).toBe('List<Gadget>');
    expect(parts.indexer()!.assignmentType()).toBe(gadget);
    expect(gadget.getSuffix('target')!.assignmentType().toString()).toContain('Vector');
  });

  test('builds call suffixes with optional parameters', () => {
    const signature = gadget.getSuffix('tune')!.callSignature()!;
    expect(signature.params()).toHaveLength(2);
    expect(signature.requiredParams()).toBe(1);
    expect(signature.returns()).toBe(booleanType);
  });

  test('documents structures, suffixes and parameters', () => {
    expect(gadget.docs).toEqual({ doc: 'A gadget.', url: 'https://docs.example/gadget.html' });
    expect(gadget.getSuffix('power')!.docs).toEqual({
      doc: 'The power.',
      url: 'https://docs.example/gadget.html#attribute:GADGET:POWER',
      units: 'kW',
    });
    // aliases share the documentation
    expect(gadget.getSuffix('pow')!.docs).toEqual(gadget.getSuffix('power')!.docs);
    expect(gadget.getSuffix('tune')!.docs!.params).toEqual([
      { name: 'frequency', doc: 'in Hz' },
      { name: 'label', doc: undefined },
    ]);
  });

  test('documents core structures and adds the suffixes they lack', () => {
    expect(types.structure('scalar')).toBe(scalarType);
    expect(scalarType.docs).toEqual({
      doc: 'A number.',
      url: 'https://docs.example/math/scalar.html',
    });
    expect(scalarType.getSuffix('gadgetcount')).toBeDefined();
  });

  test('marks dynamic structures', () => {
    expect(types.structure('Bag')!.dynamic).toBe(true);
    expect(gadget.dynamic).toBeFalsy();
  });

  test('records derived structures', () => {
    expect(machine.derived).toContain(gadget);
    expect(derivedSuffix(machine, 'power')).toBe(gadget.getSuffix('power'));
    expect(derivedSuffix(machine, 'nothing')).toBeUndefined();
  });

  test('builds functions with aliases and variables with locks', () => {
    const names = types.functions.map(f => f.name);
    expect(names).toEqual(['makeGadget', 'newGadget', 'printAll']);

    const [make, alias, printAll] = types.functions;
    expect(make.segments).toEqual(['make', 'gadget']);
    expect(make.type.callSignature()!.returns()).toBe(gadget);
    expect(make.type.callSignature()!.params()).toEqual([stringType]);
    expect(make.docs.doc).toBe('Make a gadget.');
    expect(alias.type.callSignature()!.returns()).toBe(gadget);
    expect(printAll.type.callSignature()!.requiredParams()).toBe(0);

    const [myGadget, power] = types.variables;
    expect(myGadget.type).toBe(gadget);
    expect(myGadget.lock).toBe(false);
    expect(myGadget.docs.doc).toBe('The gadget.');
    expect(power.lock).toBe(true);
    expect(power.segments).toEqual(['gadget', 'power']);
  });

  test('makes every structure comparable', () => {
    expect(gadget.getOperator(OperatorKind.equal, machine)).toBeDefined();
  });
});

describe('Flow union type', () => {
  test('keeps one member per type, the current first', () => {
    expect(flowType(scalarType, [])).toBe(scalarType);
    expect(flowType(scalarType, [scalarType])).toBe(scalarType);

    const type = flowType(gadget, [scalarType, gadget]);
    expect(type).toBeInstanceOf(FlowUnionType);
    expect((type as FlowUnionType).types).toEqual([gadget, scalarType]);
    expect(type.toString()).toBe('Gadget or Scalar');

    // cached by members and order
    expect(flowType(gadget, [scalarType])).toBe(type);
    expect(flowType(scalarType, [gadget])).not.toBe(type);
  });

  test('is lenient: one member allowing is enough', () => {
    const type = flowType(gadget, [scalarType]);

    expect(type.getSuffix('power')).toBe(gadget.getSuffix('power'));
    expect(type.getSuffix('gadgetcount')).toBeDefined();
    expect(type.getSuffix('nothing')).toBeUndefined();
    expect(type.isSubtypeOf(scalarType)).toBe(true);
    expect(type.isSubtypeOf(machine)).toBe(true);
    expect(type.isSubtypeOf(vectorType)).toBe(false);
    expect(type.getOperator(OperatorKind.plus, scalarType)).toBeDefined();
    expect(type.assignmentType()).toBe(type);

    // a static union is a subtype only when every member is
    expect(createUnion(false, gadget, scalarType).isSubtypeOf(scalarType)).toBe(false);
  });

  test('is unknown with an unknown member', () => {
    expect(flowType(scalarType, [structureType]).anyType).toBe(true);
    expect(flowType(scalarType, [gadget]).anyType).toBe(false);
  });
});
