import { TestClient, workspaces } from './harness';
import { join } from 'path';

const root = join(workspaces, 'archive');
const text = 'local x is ship:stagenum.\n';

describe('completion case', () => {
  let client: TestClient;

  afterEach(async () => {
    await client?.stop();
  });

  test.each([
    ['uppercase', 'SHIP', 'STAGEDELTAV'],
    ['lowercase', 'ship', 'stagedeltav'],
    ['camelcase', 'ship', 'stageDeltaV'],
    ['pascalcase', 'Ship', 'StageDeltaV'],
  ])('%s applies to symbols and suffixes', async (completionCase, symbol, suffix) => {
    client = await TestClient.start(root, { settings: { completionCase } });
    client.open('src/scratch.ks', text);

    // after `local x is `
    expect(await client.completionLabels('src/scratch.ks', 0, 11)).toContain(
      symbol,
    );
    // after `ship:`
    expect(await client.completionLabels('src/scratch.ks', 0, 16)).toContain(
      suffix,
    );
  });

  test('settings are read from the legacy kos-vscode section', async () => {
    client = await TestClient.start(root, {
      section: 'kos-vscode',
      settings: { completionCase: 'uppercase' },
    });
    client.open('src/scratch.ks', text);
    expect(await client.completionLabels('src/scratch.ks', 0, 16)).toContain(
      'STAGEDELTAV',
    );
  });

  test('invalid or differently cased values are tolerated', async () => {
    client = await TestClient.start(root, {
      settings: {
        completionCase: 'PascalCase',
        trace: { server: { level: 'loud' } },
      },
    });
    client.open('src/scratch.ks', text);
    expect(await client.completionLabels('src/scratch.ks', 0, 16)).toContain(
      'StageDeltaV',
    );
  });
});
