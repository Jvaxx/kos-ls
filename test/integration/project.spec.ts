import { copyFileSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MarkupContent } from 'vscode-languageserver';
import { TestClient, workspaces } from './harness';

/**
 * Copy a fixture workspace to a temporary folder, so tests can modify it
 * @param name fixture workspace name
 */
const copyWorkspace = (name: string): string => {
  const dir = mkdtempSync(join(tmpdir(), 'kos-ls-'));
  cpSync(join(workspaces, name), dir, { recursive: true });
  return dir;
};

const missing = (messages: string[]) =>
  messages.filter((m) => m.includes('may not exist'));

describe('project model', () => {
  let client: TestClient;
  let root: string;

  beforeEach(() => {
    root = copyWorkspace('archive');
  });

  afterEach(async () => {
    await client?.stop();
    rmSync(root, { recursive: true, force: true });
  });

  test('a file opened right after startup resolves archive paths', async () => {
    client = await TestClient.start(root);
    client.open('src/mission/hello.ks');

    const messages = await client.messages('src/mission/hello.ks');
    expect(messages.filter((m) => m.includes('state_'))).toEqual([]);
  });

  test('preloaded files are visible everywhere', async () => {
    client = await TestClient.start(root);
    client.open('src/mission/hello.ks');

    expect(missing(await client.messages('src/mission/hello.ks'))).toEqual(
      [],
    );
  });

  test('without preload, preloaded symbols are missing', async () => {
    writeFileSync(join(root, 'ksconfig.json'), '{ "volumes": { "1": "src" } }');
    client = await TestClient.start(root);
    client.open('src/mission/hello.ks');

    expect(missing(await client.messages('src/mission/hello.ks'))).toEqual([
      '6:5 Symbol print_status may not exist',
    ]);
  });

  test('volumes map other kOS volumes to directories', async () => {
    writeFileSync(join(root, 'ksconfig.json'), '{ "volumes": { "1": "src" } }');
    client = await TestClient.start(root);
    client.open('src/boot/main.ks');

    // print_status comes from runoncepath("1:/lib/std.ks")
    expect(await client.messages('src/boot/main.ks')).toEqual([]);
  });

  test('unmapped volumes are reported once per path', async () => {
    writeFileSync(join(root, 'ksconfig.json'), '{}');
    client = await TestClient.start(root);
    client.open('src/boot/main.ks');

    expect(await client.messages('src/boot/main.ks')).toEqual([
      '8:5 Volume 1: is not mapped to a directory: add it to "volumes" in ksconfig.json',
      '9:5 Symbol print_status may not exist',
    ]);
  });

  test('ksconfig.json changes on disk are applied', async () => {
    writeFileSync(join(root, 'ksconfig.json'), '{ "volumes": { "1": "src" } }');
    client = await TestClient.start(root);
    client.open('src/mission/hello.ks');
    expect(missing(await client.messages('src/mission/hello.ks'))).toHaveLength(
      1,
    );

    copyFileSync(
      join(workspaces, 'archive/ksconfig.json'),
      join(root, 'ksconfig.json'),
    );
    client.filesChanged(['ksconfig.json', 2]);

    expect(missing(await client.messages('src/mission/hello.ks'))).toEqual(
      [],
    );
  });

  test('editing a dependency updates its dependents', async () => {
    client = await TestClient.start(root);
    client.open('src/mission/hello.ks');
    client.open('src/lib/state.ks');
    expect(missing(await client.messages('src/mission/hello.ks'))).toEqual(
      [],
    );

    // rename state_set: hello.ks now calls a function that does not exist
    client.change(
      'src/lib/state.ks',
      'function state_get { parameter key, default. return default. }\n' +
        'function state_put { parameter key, value. }\n',
    );

    expect(missing(await client.messages('src/mission/hello.ks'))).toEqual([
      '7:5 Symbol state_set may not exist',
    ]);
  });

  test('a dependency changed on disk updates its dependents', async () => {
    client = await TestClient.start(root);
    client.open('src/mission/hello.ks');
    expect(missing(await client.messages('src/mission/hello.ks'))).toEqual(
      [],
    );

    writeFileSync(
      join(root, 'src/lib/state.ks'),
      'function state_get { parameter key, default. return default. }\n',
    );
    client.filesChanged(['src/lib/state.ks', 2]);

    expect(missing(await client.messages('src/mission/hello.ks'))).toEqual([
      '7:5 Symbol state_set may not exist',
    ]);
  });

  test('hover in a dependent sees the current declaration', async () => {
    client = await TestClient.start(root);
    client.open('src/mission/hello.ks');
    client.open('src/lib/state.ks');
    await client.settle();

    client.change(
      'src/lib/state.ks',
      'function state_get { parameter key, default, extra. return default. }\n' +
        'function state_set { parameter key, value. }\n',
    );

    // `state_get` in `local step is state_get("step", 0).`
    const hover = await client.hover('src/mission/hello.ks', 3, 16);
    const contents = hover?.contents as MarkupContent | { value: string };
    expect(contents.value).toContain('state_get');
    expect(contents.value).toContain('(structure, structure, structure)');
  });

  test('excluded files are not reported unless open', async () => {
    writeFileSync(
      join(root, 'ksconfig.json'),
      '{ "volumes": { "1": "src" }, "exclude": ["bin"] }',
    );
    client = await TestClient.start(root);
    expect(await client.messages('bin/mission/hello.ks')).toEqual([]);

    client.open('bin/mission/hello.ks');
    expect(await client.messages('bin/mission/hello.ks')).toEqual([
      '2:1 Unable to load script at 1:/lib/missing',
    ]);
  });

  test('without exclude, all files are reported', async () => {
    client = await TestClient.start(root);
    expect(await client.messages('bin/mission/hello.ks')).toEqual([
      '2:1 Unable to load script at 1:/lib/missing',
    ]);
  });

  test('builtin suffixes from kOS 1.6 type check', async () => {
    client = await TestClient.start(root);
    client.open('src/mission/hello.ks');

    const messages = await client.messages('src/mission/hello.ks');
    expect(messages.filter((m) => m.includes('suffix'))).toEqual([]);
  });
});
