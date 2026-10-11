import {
  extractClasses,
  parseConstruction,
  parseNames,
  splitTopLevel,
  stripComments,
} from '../../tools/kos-db/csharp';

describe('C# extraction helpers', () => {
  test('strips comments but not strings', () => {
    const source = 'a // AddSuffix("X")\n"// kept" /* b\nc */ d';
    const stripped = stripComments(source);
    expect(stripped).not.toContain('AddSuffix');
    expect(stripped).toContain('"// kept"');
    expect(stripped.split('\n')).toHaveLength(3);
    expect(stripped.length).toBe(source.length);
  });

  test('splits at top level commas only', () => {
    expect(
      splitTopLevel('"A", new OneArgsSuffix<ListValue, StringValue>(f, "x,y")'),
    ).toEqual(['"A"', 'new OneArgsSuffix<ListValue, StringValue>(f, "x,y")']);
    expect(splitTopLevel('() => a < b, "desc"')).toEqual([
      '() => a < b',
      '"desc"',
    ]);
  });

  test('parses names', () => {
    expect(parseNames('"READY"')).toEqual(['READY']);
    expect(parseNames('new[] { "R", "RED" }')).toEqual(['R', 'RED']);
    expect(parseNames('new string[] {"A","B"}')).toEqual(['A', 'B']);
    expect(parseNames('new []{"A"}')).toEqual(['A']);
    expect(parseNames('id')).toBeUndefined();
    expect(parseNames('code.ToString()')).toBeUndefined();
  });

  test('parses constructions', () => {
    expect(
      parseConstruction(
        'new TwoArgsSuffix<ListValue<PartValue>, StringValue, BooleanValue>(f)',
      ),
    ).toEqual({
      kind: 'TwoArgsSuffix',
      generics: ['ListValue<PartValue>', 'StringValue', 'BooleanValue'],
      args: ['f'],
    });
    expect(parseConstruction('new NoArgsVoidSuffix(() => x())')).toEqual({
      kind: 'NoArgsVoidSuffix',
      generics: [],
      args: ['() => x()'],
    });
  });
});

describe('C# class extraction', () => {
  test('reads nomenclature, base class and suffixes', () => {
    const [stage] = extractClasses(
      `
namespace kOS.Suffixed
{
    [kOS.Safe.Utilities.KOSNomenclature("Stage")]
    public class StageValues : Structure, IFoo
    {
        private void InitializeSuffixes()
        {
            AddSuffix("NUMBER", new Suffix<ScalarValue>(() => shared.Vessel.currentStage));
            AddSuffix(new string[] { "NEXTDECOUPLER", "NEXTSEPARATOR" },
                new Suffix<Structure>(() => x ?? (Structure)StringValue.None));
            // AddSuffix("OLD", new Suffix<ScalarValue>(() => 0));
            AddSuffix("RATE", new ClampSetSuffix<ScalarValue>(() => r, v => r = v, 0, 1, "Rate, 0 to 1"));
            foreach (var id in ids) AddSuffix(id, new Suffix<Addon>(() => all[id]));
        }
    }
}`,
      'StageValues.cs',
    );

    expect(stage.name).toBe('StageValues');
    expect(stage.base).toBe('Structure');
    expect(stage.kosNames).toEqual([{ name: 'Stage', csharpToKos: true }]);
    expect(
      stage.suffixes.map((s) => [s.names, s.kind, s.generics, s.description]),
    ).toEqual([
      [['NUMBER'], 'Suffix', ['ScalarValue'], undefined],
      [['NEXTDECOUPLER', 'NEXTSEPARATOR'], 'Suffix', ['Structure'], undefined],
      [['RATE'], 'ClampSetSuffix', ['ScalarValue'], 'Rate, 0 to 1'],
      [undefined, 'Suffix', ['Addon'], undefined],
    ]);
    expect(stage.suffixes[0].line).toBe(9);
  });

  test('reads the default values of optional-argument suffixes', () => {
    const [box] = extractClasses(
      `
    [kOS.Safe.Utilities.KOSNomenclature("Box")]
    public class Box : Widget
    {
        private void InitializeSuffixes()
        {
            AddSuffix("ADDLABEL", new OptionalArgsSuffix<Label>(AddLabel, new Structure[] { new StringValue ("") }));
            AddSuffix("ADDCHECKBOX", new OptionalArgsSuffix<Button>(AddCheckbox, new Structure [] { new StringValue(""), new BooleanValue(false) }));
            AddSuffix("CLEAR", new NoArgsVoidSuffix(Clear));
        }
    }`,
      'Box.cs',
    );

    expect(box.suffixes.map((s) => [s.names, s.defaults])).toEqual([
      [['ADDLABEL'], ['StringValue']],
      [['ADDCHECKBOX'], ['StringValue', 'BooleanValue']],
      [['CLEAR'], undefined],
    ]);
  });

  test('reads generic classes and multiple names', () => {
    const classes = extractClasses(
      `
    [kOS.Safe.Utilities.KOSNomenclature("List")]
    public class ListValue<T> : CollectionValue<T, List<T>>, IList<T>, IIndexable
        where T : Structure
    {
        [Function("list")]
        public class FunctionList : SafeFunctionBase { }
    }
    [KOSNomenclature("Lexicon")]
    [KOSNomenclature("Lex", CSharpToKOS = false)]
    public class Lexicon : SerializableStructure { }
    [kOSAddon("RT")]
    public class Addon : Suffixed.Addon { }`,
      'x.cs',
    );

    expect(classes.map((c) => [c.name, c.generics, c.base])).toEqual([
      ['ListValue', ['T'], 'CollectionValue<T, List<T>>'],
      ['FunctionList', [], 'SafeFunctionBase'],
      ['Lexicon', [], 'SerializableStructure'],
      ['Addon', [], 'Suffixed.Addon'],
    ]);
    expect(classes[1].functionNames).toEqual(['list']);
    expect(classes[2].kosNames).toEqual([
      { name: 'Lexicon', csharpToKos: true },
      { name: 'Lex', csharpToKos: false },
    ]);
    expect(classes[3].addon).toBe('RT');
  });

  test('assigns registrations to the innermost class and global owners', () => {
    const classes = extractClasses(
      `
    [KOSNomenclature("Constant")]
    public class ConstantValue : Structure
    {
        static ConstantValue()
        {
            AddGlobalSuffix<ConstantValue>("C", new StaticSuffix<ScalarValue>(() => 1, "Speed of light in m/s"));
        }
        protected void AddSuffix(string suffixName, ISuffix suffixToAdd) { }
    }`,
      'x.cs',
    );

    expect(classes[0].suffixes).toMatchObject([
      {
        names: ['C'],
        kind: 'StaticSuffix',
        owner: 'ConstantValue',
        description: 'Speed of light in m/s',
      },
    ]);
  });

  test('reads bound variables', () => {
    const [binding] = extractClasses(
      `
    [Binding("ksp")]
    public class BindingsUniverse : Binding
    {
        public override void AddTo(SharedObjects shared)
        {
            shared.BindingMgr.AddGetter("WARP", () => TimeWarp.CurrentRateIndex);
            shared.BindingMgr.AddSetter("WARP", val => Set(val));
            shared.BindingMgr.AddGetter(new [] {"MAGENTA","PURPLE"}, () => c);
            shared.BindingMgr.AddGetter("AG" + i, () => g);
        }
    }`,
      'x.cs',
    );

    expect(binding.binding).toBe(true);
    expect(binding.getters.map((g) => [g.names, g.setter])).toEqual([
      [['WARP'], false],
      [['WARP'], true],
      [['MAGENTA', 'PURPLE'], false],
      [undefined, false],
    ]);
  });
});
