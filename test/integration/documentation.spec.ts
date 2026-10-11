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
