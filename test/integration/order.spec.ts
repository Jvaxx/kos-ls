import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, relative } from 'path';
import { TestClient } from './harness';

// scripts of many authors: runs through .ksm names and cycles of scripts
// sharing globals (q.ks, quad.ks, quad_loop.ks, turret.ks, lib_quad.ks)
const parserValid = join(__dirname, '../fixtures/parser_valid');

const scripts = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? scripts(join(dir, entry.name))
      : entry.name.endsWith('.ks')
        ? [relative(parserValid, join(dir, entry.name))]
        : [],
  );

describe('analysis order', () => {
  let client: TestClient;

  afterEach(async () => {
    await client?.stop();
  });

  // the diagnostics are a function of the files, not of the order in
  // which the client opened them
  test('opening an unchanged file changes nothing', async () => {
    client = await TestClient.start(parserValid);
    const loaded = await client.allMessages();
    expect(loaded.length).toBeGreaterThan(1000);

    client.open('turret.ks');
    expect(await client.allMessages()).toEqual(loaded);
    client.open('quad.ks');
    client.open('Good Files/Errors and UI/lib_menulist1.ks');
    expect(await client.allMessages()).toEqual(loaded);
  });

  test('opening every file before the load gives the same result', async () => {
    client = await TestClient.start(parserValid);
    const loaded = await client.allMessages();
    await client.stop();

    client = await TestClient.start(parserValid);
    for (const path of scripts(parserValid)) {
      client.open(path);
    }
    expect(await client.allMessages()).toEqual(loaded);
  });
});

describe('globals of other files', () => {
  let client: TestClient;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kos-ls-order-'));
  });

  afterEach(async () => {
    await client?.stop();
    rmSync(root, { recursive: true, force: true });
  });

  // the run order decides, which the analysis does not know: lines of
  // two files are not comparable
  test('are not declared after a use in another file', async () => {
    writeFileSync(join(root, 'lib.ks'), 'print shared.\n');
    writeFileSync(
      join(root, 'main.ks'),
      '\n\n\nglobal shared is 1.\nrun lib.\nprint shared.\n',
    );
    client = await TestClient.start(root);
    expect(await client.messages('lib.ks')).toEqual([]);
  });

  test('in the same file, a use before the declaration is reported', async () => {
    writeFileSync(
      join(root, 'main.ks'),
      'function f { print later. }\nf().\nglobal later is 1.\n',
    );
    client = await TestClient.start(root);
    expect(await client.messages('main.ks')).toEqual([
      '1:20 Variable later may not exist at script runtime.',
    ]);
  });
});
