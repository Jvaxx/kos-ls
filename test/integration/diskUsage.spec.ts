import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { diskUsageCommand } from '../../src/utilities/constants';
import { TestClient } from './harness';

describe('disk usage', () => {
  let client: TestClient;
  let root: string;

  const write = (path: string, text: string) => {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  };

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kos-ls-size-'));
    write('ksconfig.json', '{ "volumes": { "1": "src" } }\n');
    // 24 bytes, 10 stripped: the comment line is kept, empty
    write('src/lib.ks', '// a library\n  print 1.\n');
    // 23 bytes, 9 stripped
    write('src/util.ks', 'run lib.\n\n// end\n\n    \n');
    // 29 bytes, 19 stripped
    write('src/main.ks', 'run util.\nrun lib. // twice\n\n');
  });

  afterEach(async () => {
    await client?.stop();
    rmSync(root, { recursive: true, force: true });
  });

  const titles = async (path: string) =>
    (await client.codeLenses(path)).map((lens) => lens.command?.title);

  test('a lens with the size of a file and of what it runs', async () => {
    client = await TestClient.start(root);
    client.open('src/main.ks');

    const lenses = await client.codeLenses('src/main.ks');
    expect(lenses).toEqual([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        command: {
          title: '19 B on disk (29 B source) · 38 B with the 2 files it runs',
          command: diskUsageCommand,
          arguments: [client.uri('src/main.ks')],
        },
      },
    ]);
    expect(await titles('src/lib.ks')).toEqual(['10 B on disk (24 B source)']);
  });

  test('the command shows each file', async () => {
    client = await TestClient.start(root);
    client.open('src/main.ks');
    await client.settle();

    await client.executeCommand(diskUsageCommand, client.uri('src/main.ks'));
    expect(client.shown).toEqual([
      '38 B stripped in 3 files:\n' +
        '  src/main.ks: 19 B (29 B source)\n' +
        '  src/util.ks: 9 B (23 B source)\n' +
        '  src/lib.ks: 10 B (24 B source)',
    ]);
  });

  test('the preloaded files are counted, once', async () => {
    write(
      'ksconfig.json',
      '{ "volumes": { "1": "src" }, "preload": ["src/lib.ks"] }\n',
    );
    write('src/other.ks', 'print 2.\n');
    client = await TestClient.start(root);
    client.open('src/other.ks');

    expect(await titles('src/other.ks')).toEqual([
      '9 B on disk (9 B source) · 19 B with the 1 file it runs',
    ]);
    expect(await titles('src/main.ks')).toEqual([
      '19 B on disk (29 B source) · 38 B with the 2 files it runs',
    ]);
  });

  test('runs that cannot be followed are reported', async () => {
    write('src/boot.ks', 'local name is "x".\nrunpath(name).\nrun missing.\n');
    client = await TestClient.start(root);
    client.open('src/boot.ks');

    expect(await titles('src/boot.ks')).toEqual([
      '47 B on disk (47 B source) · 2 runs not followed',
    ]);
  });

  test('the lens follows edits and the files a script runs', async () => {
    client = await TestClient.start(root);
    client.open('src/main.ks');
    client.open('src/lib.ks');
    await client.settle();
    const before = client.codeLensRefreshes;

    client.change('src/lib.ks', 'print 1. print 2.\n');
    expect(await titles('src/lib.ks')).toEqual(['18 B on disk (18 B source)']);
    expect(await titles('src/main.ks')).toEqual([
      '19 B on disk (29 B source) · 46 B with the 2 files it runs',
    ]);
    expect(client.codeLensRefreshes).toBeGreaterThan(before);
  });

  test('an unknown command or document does nothing', async () => {
    client = await TestClient.start(root);
    await client.settle();

    await client.executeCommand('kos-ls.nothing', client.uri('src/main.ks'));
    await client.executeCommand(diskUsageCommand, client.uri('src/none.ks'));
    await client.executeCommand(diskUsageCommand);
    expect(client.shown).toEqual([]);
  });

  test('an unknown document does nothing, with preloaded files', async () => {
    write(
      'ksconfig.json',
      '{ "volumes": { "1": "src" }, "preload": ["src/lib.ks"] }\n',
    );
    client = await TestClient.start(root);
    await client.settle();

    await client.executeCommand(diskUsageCommand, client.uri('src/none.ks'));
    expect(client.shown).toEqual([]);
  });
});
