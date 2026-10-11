import { TestClient, workspaces } from './harness';
import { join } from 'path';
import { MarkupContent } from 'vscode-languageserver';

const root = join(workspaces, 'archive');
const file = 'src/scratch.ks';

describe('documentation', () => {
  let client: TestClient;

  beforeEach(async () => {
    client = await TestClient.start(root);
  });

  afterEach(async () => {
    await client?.stop();
  });

  test('hover shows the signature and the kOS documentation', async () => {
    client.open(file, 'print vang(v(1, 0, 0), v(0, 1, 0)) + altitude.\n');

    const hover = await client.hover(file, 0, 7);
    const { kind, value } = hover!.contents as MarkupContent;
    expect(kind).toBe('markdown');
    expect(value).toMatch(
      /^```kerboscript\n\(function\) vAng\(v1: Vector, v2: Vector\): Scalar\n```/,
    );
    expect(value).toContain('[kOS documentation](https://ksp-kos.github.io/');

    // a builtin variable, its access and units
    const variable = (await client.hover(file, 0, 40))!.contents as MarkupContent;
    expect(variable.value).toContain('(variable) altitude: Scalar');
    expect(variable.value).toContain('*Access: get · Units: m*');
  });

  test('signature help while a call is typed', async () => {
    client.open(file, 'local p is ship:partsnamed("x").\nprint heading(90, ');

    const suffix = await client.signatureHelp(file, 0, 27);
    expect(suffix?.signatures[0].label).toBe(
      'partsNamed(name: String): List<Part>',
    );
    expect(suffix?.signatures[0].parameters?.[0].documentation).toEqual({
      kind: 'markdown',
      value: 'Name of the parts',
    });

    // the second line does not parse yet
    const help = await client.signatureHelp(file, 1, 18);
    expect(help?.signatures[0].label).toBe(
      'heading(dir: Scalar, pitch: Scalar, roll?: Scalar): Direction',
    );
    expect(help?.activeParameter).toBe(1);
    expect(help?.signatures[0].parameters?.[1].label).toEqual([21, 34]);
  });

  test('no signature help outside a call', async () => {
    client.open(file, 'local y is (1 + 2).\nprint v(1, 2, 3).\n');

    expect(await client.signatureHelp(file, 0, 13)).toBeNull();
    expect(await client.signatureHelp(file, 1, 17)).toBeNull();
  });

  test('completion items are documented when resolved', async () => {
    client.open(file, 'local x is ship:stagenum.\n');

    const items = await client.completion(file, 0, 16);
    const item = items.find((i) => i.label === 'partsNamed')!;
    expect(item.detail).toBe('partsNamed(name: String): List<Part>');
    expect(item.documentation).toBeUndefined();

    const resolved = await client.resolve(item);
    expect((resolved.documentation as MarkupContent).value).toContain(
      '- `name`: Name of the parts',
    );
  });
});

describe('doc comments', () => {
  let client: TestClient;

  beforeEach(async () => {
    client = await TestClient.start(root);
  });

  afterEach(async () => {
    await client?.stop();
  });

  const source = [
    '// Burn time for a maneuver.',
    '// @param dv {Scalar} delta-v in m/s',
    '// @param ves the vessel',
    '// @return {Scalar} seconds',
    'function burnTime {',
    '    parameter dv, ves is ship.',
    '    return dv / ves:availablethrust.',
    '}',
    '',
    '// Target altitude',
    'parameter target.',
    'print burnTime(10, ship) + target.',
  ].join('\n');

  test('document functions and parameters in hover', async () => {
    client.open(file, source);

    const fn = (await client.hover(file, 11, 8))!.contents as MarkupContent;
    expect(fn.value).toBe(
      '```kerboscript\n' +
        '(function) burnTime(dv: Scalar, ves?: Structure): Scalar\n' +
        '```\n\n' +
        'Burn time for a maneuver.\n\n' +
        '- `dv`: delta-v in m/s\n- `ves`: the vessel\n\n' +
        'Returns: seconds',
    );

    const dv = (await client.hover(file, 5, 15))!.contents as MarkupContent;
    expect(dv.value).toContain('delta-v in m/s');

    const target = (await client.hover(file, 11, 28))!.contents as MarkupContent;
    expect(target.value).toContain('Target altitude');
  });

  test('document functions in signature help and completion', async () => {
    client.open(file, source);

    const help = await client.signatureHelp(file, 11, 19);
    expect(help?.activeParameter).toBe(1);
    expect(help?.signatures[0].parameters?.[1].documentation).toEqual({
      kind: 'markdown',
      value: 'the vessel',
    });

    const item = (await client.completion(file, 11, 6)).find(
      (i) => i.label === 'burnTime',
    )!;
    const resolved = await client.resolve(item);
    expect((resolved.documentation as MarkupContent).value).toContain(
      'Burn time for a maneuver.',
    );
  });
});

describe('types in doc comment tags', () => {
  let client: TestClient;

  beforeEach(async () => {
    client = await TestClient.start(root);
  });

  afterEach(async () => {
    await client?.stop();
  });

  test('type the parameters, the calls and the arguments', async () => {
    client.open(
      file,
      [
        '// @param dv {Scalar} delta-v',
        '// @param ves {vessel} the vessel',
        '// @return {Scalar} seconds',
        'function burnTime {',
        '    parameter dv, ves is ship.',
        '    return dv / ves:availablethrust.',
        '}',
        'print burnTime(10, ship) + 1.',
        'print burnTime("a", 3):foo.',
      ].join('\n'),
    );

    expect(await client.messages(file)).toEqual([
      '9:16 String cannot be converted to a Scalar',
      '9:21 Scalar cannot be converted to a Vessel?',
      '9:24 Unable to find suffix foo on type Scalar',
    ]);

    const fn = (await client.hover(file, 7, 8))!.contents as MarkupContent;
    expect(fn.value).toContain('burnTime(dv: Scalar, ves?: Vessel): Scalar');

    // suffixes of the tagged type
    const labels = await client.completionLabels(file, 5, 20);
    expect(labels).toContain('availableThrust');
  });

  test('unknown and malformed types are reported on the tag', async () => {
    client.open(
      file,
      [
        '// Where a parameter is documented',
        '// @param p {Vesel} typo',
        '// @return {List<} broken',
        'function f {',
        '    parameter p.',
        '    return p.',
        '}',
        '// @param x {List<Part> | Scalar} parts or a count',
        'parameter x.',
        'print f(x).',
      ].join('\n'),
    );

    expect(await client.messages(file)).toEqual([
      '2:13 Unknown type Vesel: no kOS structure has this name',
      '3:12 Malformed type List<',
    ]);
  });

  test('untagged parameters stay Structure', async () => {
    client.open(
      file,
      [
        '// Just a description',
        'function g {',
        '    parameter a, b is 1.',
        '    return a:anything + b.',
        '}',
        'print g("x", ship):whatever.',
      ].join('\n'),
    );

    expect(await client.messages(file)).toEqual([]);
  });
});

describe('inlay hints', () => {
  let client: TestClient;

  beforeEach(async () => {
    client = await TestClient.start(root);
  });

  afterEach(async () => {
    await client?.stop();
  });

  test('the inferred types of declared names in the range', async () => {
    client.open(
      file,
      [
        'local v is ship.',
        'local u is v:unknownsuffix.',
        'lock alt to ship:altitude.',
        'for p in ship:parts { print p. }',
        'local far is 1.',
      ].join('\n'),
    );

    const hints = await client.inlayHints(file, {
      start: { line: 0, character: 0 },
      end: { line: 3, character: 40 },
    });
    expect(hints?.map((h) => [h.position, h.label])).toEqual([
      [{ line: 0, character: 7 }, ': Vessel'],
      [{ line: 2, character: 8 }, ': Scalar'],
      [{ line: 3, character: 5 }, ': Part'],
    ]);
  });
});
