import { TestClient, workspaces } from './harness';
import { join } from 'path';
import { TextDocument } from 'vscode-languageserver-textdocument';

const root = join(workspaces, 'archive');
const file = 'src/scratch.ks';

describe('formatting', () => {
  let client: TestClient;

  beforeEach(async () => {
    client = await TestClient.start(root);
  });

  afterEach(async () => {
    await client?.stop();
  });

  const apply = (text: string, edits: any) =>
    TextDocument.applyEdits(
      TextDocument.create('file:///a.ks', 'kos', 1, text),
      edits,
    );

  test('a document is formatted with the defaults, not the editor tabs', async () => {
    const text = 'IF x>1 { PRINT x. } // big\nfunction f{return 1.}';
    client.open(file, text);

    const edits = await client.formatting(file);
    expect(apply(text, edits)).toBe(
      'if x > 1 {\n    print x.\n} // big\nfunction f {\n    return 1.\n}\n',
    );
  });

  test('a range formats its lines only', async () => {
    const text = 'print  1.\nprint  2.\nprint  3.\n';
    client.open(file, text);

    const edits = await client.rangeFormatting(file, {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 0 },
    });
    expect(apply(text, edits)).toBe('print  1.\nprint 2.\nprint  3.\n');
  });

  test('a document with syntax errors is left alone', async () => {
    client.open(file, 'print (1.\n');
    expect(await client.formatting(file)).toBeNull();
  });
});
