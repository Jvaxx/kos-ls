import {
  csharpType,
  documentationType,
  splitGeneric,
} from '../../tools/kos-db/types';
import { CamelCase, deepMerge } from '../../tools/kos-db/merge';

/**
 * A resolver over a few structures, by C# class or kOS name, in any case
 * as the generator's
 */
const structures: Record<string, string> = {
  ListValue: 'List',
  PartValue: 'Part',
  ScalarValue: 'Scalar',
  StringValue: 'String',
  Lexicon: 'Lexicon',
  TimeStamp: 'TimeStamp',
  VesselTarget: 'Vessel',
  BooleanValue: 'Boolean',
  List: 'List',
  Part: 'Part',
  Scalar: 'Scalar',
  String: 'String',
  Vessel: 'Vessel',
  Boolean: 'Boolean',
  Vector: 'Vector',
  DockingPort: 'DockingPort',
};
const lowerCase = new Map(
  Object.entries(structures).map(([name, kos]) => [name.toLowerCase(), kos]),
);
const resolve = (name: string) => lowerCase.get(name.toLowerCase());

describe('kOS database types', () => {
  test('splits generic arguments at top level', () => {
    expect(splitGeneric('ListValue<PartValue>')).toEqual({
      name: 'ListValue',
      args: ['PartValue'],
    });
    expect(splitGeneric('Lexicon<ListValue<A>, B>')).toEqual({
      name: 'Lexicon',
      args: ['ListValue<A>', 'B'],
    });
    expect(splitGeneric(' Vector ')).toEqual({ name: 'Vector', args: [] });
  });

  describe('C# types', () => {
    test('maps classes and primitives to kOS structures', () => {
      expect(csharpType('ListValue<PartValue>', resolve)).toEqual({
        type: 'List<Part>',
      });
      expect(csharpType('kOS.Suffixed.TimeStamp', resolve)).toEqual({
        type: 'TimeStamp',
      });
      expect(csharpType('double', resolve)).toEqual({ type: 'Scalar' });
      expect(csharpType('bool', resolve)).toEqual({ type: 'Boolean' });
      expect(csharpType('object', resolve)).toEqual({ type: 'Structure' });
    });

    test('keeps generic parameters in scope and only element types', () => {
      expect(csharpType('ListValue<T>', resolve, ['T'])).toEqual({
        type: 'List<T>',
      });
      // CollectionValue<T, C>: the container type is left out
      expect(
        csharpType('ListValue<PartValue, List<PartValue>>', resolve),
      ).toEqual({
        type: 'List<Part>',
      });
    });

    test('reports unknown names, except generic method parameters', () => {
      expect(csharpType('Widget', resolve)).toEqual({ unknown: 'Widget' });
      expect(csharpType('ListValue<Widget>', resolve)).toEqual({
        unknown: 'Widget',
      });
      expect(csharpType('TValue', resolve)).toEqual({ type: 'Structure' });
    });
  });

  describe('documentation types', () => {
    test('reads roles, plurals and element types', () => {
      expect(documentationType(':struct:`Vessel`', resolve)).toEqual({
        type: 'Vessel',
        unknown: [],
      });
      expect(
        documentationType(':struct:`List` of :struct:`Part` objects', resolve)
          .type,
      ).toBe('List<Part>');
      expect(
        documentationType(':struct:`List <list>` of strings', resolve).type,
      ).toBe('List<String>');
      expect(documentationType('List<Scalar>', resolve).type).toBe(
        'List<Scalar>',
      );
      expect(documentationType('number', resolve).type).toBe('Scalar');
    });

    test('reads alternatives and units', () => {
      expect(
        documentationType(':struct:`Vessel` or :struct:`Boolean`', resolve)
          .type,
      ).toBe('Vessel | Boolean');
      expect(
        documentationType(
          ':struct:`DockingPort`, or the :struct:`String` "None" if none',
          resolve,
        ).type,
      ).toBe('DockingPort | String');
      expect(documentationType(':struct:`Scalar` (m/s)', resolve)).toEqual({
        type: 'Scalar',
        units: 'm/s',
        unknown: [],
      });
      expect(documentationType(':struct:`Scalar` (deg)', resolve).units).toBe(
        'deg',
      );
      expect(documentationType('Scalar in seconds', resolve).units).toBe('s');
    });

    test('ignores prose around the type', () => {
      expect(
        documentationType('A position :struct:`Vector`', resolve).type,
      ).toBe('Vector');
      expect(
        documentationType(':struct:`Scalar`. range = [0,1]', resolve).type,
      ).toBe('Scalar');
      expect(
        documentationType(':struct:`Vector` - the position', resolve).type,
      ).toBe('Vector');
    });

    test('reports unknown structures without guessing', () => {
      expect(documentationType(':struct:`Gadget`', resolve)).toEqual({
        type: undefined,
        units: undefined,
        unknown: ['Gadget'],
      });
      expect(documentationType('varies', resolve).type).toBeUndefined();
    });
  });

  describe('camel case', () => {
    test('uses learned spellings, then splits into learned words', () => {
      const camel = new CamelCase();
      camel.learn('stageDeltaV');
      camel.learn('maxThrust');
      camel.learnText('The current stage and the number of parts.');

      expect(camel.of('STAGEDELTAV')).toBe('stageDeltaV');
      expect(camel.of('MAXTHRUST')).toBe('maxThrust');
      // the learned words, with the one-letter word seen last in deltaV
      expect(camel.of('CURRENTSTAGE')).toBe('currentStage');
      expect(camel.of('STAGEPARTS')).toBe('stageParts');
      expect(camel.of('DELTAV')).toBe('deltaV');
      // digits stick to the word before them
      expect(camel.of('STAGE2')).toBe('stage2');
      // unknown words stay lower case
      expect(camel.of('FROBNICATE')).toBe('frobnicate');
    });

    test('keeps the corrections of known misspellings', () => {
      const camel = new CamelCase();
      camel.learn('partsTAgged');
      expect(camel.of('PARTSTAGGED')).toBe('partsTagged');
      expect(camel.of('REBOOT')).toBe('reboot');
    });

    test('learns nothing from single-case names', () => {
      const camel = new CamelCase();
      camel.learn('ALTITUDE');
      camel.learn('altitude');
      expect(camel.of('ALTITUDE')).toBe('altitude');
    });
  });

  describe('overrides', () => {
    test('merge objects, replace other values and remove with null', () => {
      const base = {
        functions: {
          body: { returns: 'Structure', params: [{ type: 'Structure' }] },
          stage: { returns: 'None', params: [] },
        },
        kos: '1.6.0.1',
      };
      const override = {
        $comment: 'ignored',
        functions: {
          body: { returns: 'Body', params: [{ type: 'String', name: 'name' }] },
          stage: null,
          extra: { returns: 'Scalar', params: [] },
        },
      };

      expect(deepMerge(base, override)).toEqual({
        functions: {
          body: { returns: 'Body', params: [{ type: 'String', name: 'name' }] },
          extra: { returns: 'Scalar', params: [] },
        },
        kos: '1.6.0.1',
      });
      // the base is not changed
      expect(base.functions.stage).toBeDefined();
    });

    test('match keys case-insensitively', () => {
      expect(
        deepMerge(
          { suffixes: { reBoot: { access: 'call', type: 'None' } } },
          {
            suffixes: { reboot: { type: 'Boolean' } },
          },
        ),
      ).toEqual({ suffixes: { reBoot: { access: 'call', type: 'Boolean' } } });
    });
  });
});
