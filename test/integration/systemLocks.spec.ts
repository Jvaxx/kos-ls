import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MarkupContent } from 'vscode-languageserver';
import { TestClient } from './harness';

// throttle, steering, wheelThrottle and wheelSteering are kOS's system
// locks: a lock of one is the builtin, and a refused set is reported once
describe('system locks and refused sets', () => {
  let client: TestClient;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kos-ls-locks-'));
  });

  afterEach(async () => {
    await client?.stop();
    rmSync(root, { recursive: true, force: true });
  });

  const open = async (lines: string[]): Promise<void> => {
    const text = lines.join('\n') + '\n';
    writeFileSync(join(root, 'a.ks'), text);
    client = await TestClient.start(root);
    client.open('a.ks', text);
    await client.settle();
  };

  const hover = async (line: number, character: number): Promise<string> =>
    ((await client.hover('a.ks', line, character))?.contents as MarkupContent)
      ?.value ?? '';

  test('a lock of a system lock is the builtin', async () => {
    await open([
      'lock steering to heading(90, 90).',
      'lock throttle to 1.',
      'print throttle + steering:pitch.',
      'unlock steering.',
      'local function f { local lock wheelSteering to 90. }',
      'f().',
    ]);

    for (const [line, character] of [
      [0, 6],
      [1, 6],
      [2, 7],
      [2, 18],
      [3, 8],
      [4, 32],
    ]) {
      expect(await hover(line, character)).toMatch(/^```kerboscript\n\(lock\) /);
      expect(await hover(line, character)).toContain('[kOS documentation]');
    }
    expect(await hover(0, 6)).toContain(
      '(lock) steering: Direction or String or Vector',
    );
    expect(await client.messages('a.ks')).toEqual([]);

    const tokens = await client.semanticTokens('a.ks');
    expect(tokens).toContain('steering variable defaultLibrary');
    expect(tokens).toContain('throttle variable defaultLibrary');
    expect(tokens).toContain('wheelSteering variable defaultLibrary');
    expect(tokens.filter((t) => t.includes('declaration'))).toEqual([
      'f function declaration',
    ]);

    // their type is kOS's, not inferred
    const hints = await client.inlayHints('a.ks', {
      start: { line: 0, character: 0 },
      end: { line: 5, character: 0 },
    });
    expect(hints).toEqual([]);
  });

  test('a system lock checks the type of its value', async () => {
    await open([
      'lock throttle to "full".',
      'lock steering to "kill".',
      'lock steering to ship:facing.',
      'lock wheelThrottle to 0.5.',
    ]);

    expect(await client.messages('a.ks')).toEqual([
      '1:18 Cannot lock throttle of type Scalar to String',
    ]);
  });

  test('a lock locked again is set, not declared again', async () => {
    await open(['lock x to 1.', 'print x.', 'lock x to "a".', 'print x.']);

    // typed as a variable set twice: its type there, then the others
    expect(await hover(2, 6)).toContain('(lock) x: String or Scalar\n');
    expect(await hover(1, 7)).toContain('(lock) x: Scalar or String\n');
    expect(await client.messages('a.ks')).toEqual([]);

    const hints = await client.inlayHints('a.ks', {
      start: { line: 0, character: 0 },
      end: { line: 3, character: 0 },
    });
    expect(hints?.map((h) => h.label)).toEqual([
      ': Scalar or String',
      ': String or Scalar',
    ]);
  });

  test('a refused set is reported once', async () => {
    await open([
      'set throttle to 1.',
      'set r to 1.',
      'list engines in v.',
      'toggle ship.',
      'altitude on.',
      'set q to queue().',
      'q:push(1).',
      'print r + v:length.',
    ]);

    expect(await client.messages('a.ks')).toEqual([
      '1:5 Not allowed to SET a name that hides the builtin system lock ' +
        'throttle. Rename it, or allow it with @clobberbuiltins on.',
      '2:5 Not allowed to SET a name that hides the builtin function r. ' +
        'Rename it, or allow it with @clobberbuiltins on.',
      '3:17 Not allowed to SET a name that hides the builtin function v. ' +
        'Rename it, or allow it with @clobberbuiltins on.',
      '4:8 Not allowed to SET a name that hides the builtin read-only ' +
        'variable ship. Rename it, or allow it with @clobberbuiltins on.',
      '5:1 Not allowed to SET a name that hides the builtin read-only ' +
        'variable altitude. Rename it, or allow it with @clobberbuiltins on.',
      '6:5 Not allowed to SET a name that hides the builtin function q. ' +
        'Rename it, or allow it with @clobberbuiltins on.',
    ]);

    // meant for kOS's throttle: the name stays the builtin's
    expect(await hover(0, 6)).toContain('(lock) throttle: Scalar');
    // meant as a new variable: declared, the rest of the script uses it
    expect(await hover(5, 5)).toContain('(variable) q: Queue');
    expect(await hover(7, 7)).toContain('(variable) r: Scalar');
  });

  test('with @clobberbuiltins on, a set declares a variable', async () => {
    await open([
      '@clobberbuiltins on.',
      'set throttle to 1.',
      'set r to 1.',
      'print throttle + r.',
      'lock throttle to 0.',
    ]);

    expect(await client.messages('a.ks')).toEqual([]);
    expect(await hover(1, 6)).toContain('(variable) throttle: Scalar');
    expect(await hover(3, 7)).toContain('(variable) throttle: Scalar');
    // a lock of it is still kOS's
    expect(await hover(4, 6)).toContain('[kOS documentation]');
  });
});
