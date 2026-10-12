import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { TestClient } from './harness';

// builtins live as long as the server: the usages and sets a file records
// on them are taken back when its table is replaced
describe('references and highlights', () => {
  let client: TestClient;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kos-ls-refs-'));
  });

  afterEach(async () => {
    await client?.stop();
    rmSync(root, { recursive: true, force: true });
  });

  const start = async (files: Record<string, string>): Promise<void> => {
    for (const [path, text] of Object.entries(files)) {
      writeFileSync(join(root, path), text);
    }
    client = await TestClient.start(root);
  };

  test('a builtin: each use once, none left after an edit', async () => {
    const text = 'lock steering to up.\nprint steering.\nunlock steering.\n';
    await start({ 'a.ks': text });
    client.open('a.ks', text);

    // the lock is a write of the builtin, the print a read
    expect(await client.highlights('a.ks', 1, 7)).toEqual(['1:6 W', '2:7 R']);
    expect(await client.highlights('a.ks', 0, 6)).toEqual(['1:6 W', '2:7 R']);

    for (let edit = 1; edit <= 3; edit++) {
      client.change('a.ks', 'print 1.\n'.repeat(edit) + text);
      expect(await client.highlights('a.ks', edit + 1, 7)).toEqual([
        `${edit + 1}:6 W`,
        `${edit + 2}:7 R`,
      ]);
    }
    expect(await client.references('a.ks', 4, 7)).toEqual([
      'a.ks 4:6',
      'a.ks 5:7',
    ]);

    // and a set of a settable builtin
    client.change('a.ks', 'set target to "x".\nprint target.\n');
    expect(await client.highlights('a.ks', 1, 7)).toEqual(['1:5 W', '2:7 R']);
  });

  test('a builtin used by two files: each file its own uses', async () => {
    await start({ 'a.ks': 'print ship.\n', 'b.ks': 'print ship.\n' });
    client.open('a.ks');
    client.change('a.ks', '\nprint ship.\n');

    expect(await client.highlights('a.ks', 1, 7)).toEqual(['2:7 R']);
    expect(await client.highlights('b.ks', 0, 7)).toEqual(['1:7 R']);
  });

  test('a global of another file follows edits of the file using it', async () => {
    await start({
      'lib.ks': 'global shared is 1.\n',
      'main.ks': 'run lib.\nprint shared.\n',
    });
    client.open('main.ks');
    client.change('main.ks', 'run lib.\n\nprint shared.\nprint shared.\n');

    expect(await client.references('lib.ks', 0, 8)).toEqual([
      'lib.ks 1:8',
      'main.ks 3:7',
      'main.ks 4:7',
    ]);
  });

  test("kOS names cannot be renamed, the script's can", async () => {
    const text = 'lock steering to up.\nlock x to 1.\nprint x + steering.\n';
    await start({ 'a.ks': text });
    client.open('a.ks', text);

    expect(await client.rename('a.ks', 0, 6, 'dir')).toBeNull();
    expect(await client.rename('a.ks', 2, 17, 'dir')).toBeNull();
    const edit = await client.rename('a.ks', 2, 6, 'y');
    expect(Object.values(edit?.changes ?? {}).flat()).toHaveLength(2);
  });
});
