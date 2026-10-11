import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { CodeAction } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { TestClient } from './harness';

describe('code actions', () => {
  let client: TestClient;
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'kos-ls-actions-'));
  });

  afterEach(async () => {
    await client?.stop();
    rmSync(root, { recursive: true, force: true });
  });

  /**
   * Start on a workspace of one file, open it and return the code actions
   * for its diagnostics at a line
   */
  const actionsFor = async (
    text: string,
    line?: number,
    file = 'a.ks',
  ): Promise<CodeAction[]> => {
    writeFileSync(join(root, file), text);
    client = await TestClient.start(root);
    client.open(file, text);
    return client.codeActions(file, line);
  };

  const titles = (actions: CodeAction[]) => actions.map((a) => a.title);

  /**
   * The text of a file once an action's edits are applied
   */
  const apply = (action: CodeAction, text: string, file = 'a.ks'): string => {
    const edits = action.edit?.changes?.[client.uri(file)] ?? [];
    return TextDocument.applyEdits(
      TextDocument.create(client.uri(file), 'kerboscript', 1, text),
      edits,
    );
  };

  test('a missing period is inserted', async () => {
    const text = 'print 1\nprint 2.\n';
    const [action] = await actionsFor(text, 1);
    expect(action.title).toBe('Insert "."');
    expect(action.kind).toBe('quickfix');
    expect(action.isPreferred).toBe(true);
    expect(action.diagnostics?.[0].code).toBe('parser-error');
    expect(apply(action, text)).toBe('print 1.\nprint 2.\n');
  });

  describe('a name hiding a builtin', () => {
    test('is renamed everywhere', async () => {
      const text = 'local r is 1.\nprint r + 1.\n';
      const actions = await actionsFor(text, 1);
      expect(titles(actions)).toEqual([
        'Rename r to r_',
        'Allow names that hide builtins in this file (@clobberbuiltins on.)',
      ]);
      expect(actions[0].isPreferred).toBe(true);
      expect(apply(actions[0], text)).toBe('local r_ is 1.\nprint r_ + 1.\n');
    });

    test('is renamed to a free name', async () => {
      const text = 'local r_ is 0.\nlocal r is 1.\nprint r + r_.\n';
      const actions = await actionsFor(text, 2);
      expect(actions[0].title).toBe('Rename r to r_2');
      expect(apply(actions[0], text)).toBe(
        'local r_ is 0.\nlocal r_2 is 1.\nprint r_2 + r_.\n',
      );
    });

    test('is allowed with the directive at the top', async () => {
      const text = '// header\nlocal r is 1.\nprint r.\n';
      const actions = await actionsFor(text, 2);
      expect(apply(actions[1], text)).toBe(
        '@clobberbuiltins on.\n// header\nlocal r is 1.\nprint r.\n',
      );
    });

    test('is allowed after the other directives', async () => {
      const text = '@lazyglobal off.\nlocal r is 1.\nprint r.\n';
      const actions = await actionsFor(text, 2);
      expect(apply(actions[1], text)).toBe(
        '@lazyglobal off.\n@clobberbuiltins on.\nlocal r is 1.\nprint r.\n',
      );
    });

    test('is allowed by turning the directive on', async () => {
      const text = '@clobberbuiltins off.\nlocal r is 1.\nprint r.\n';
      const actions = await actionsFor(text, 2);
      expect(apply(actions[1], text)).toBe(
        '@clobberbuiltins on.\nlocal r is 1.\nprint r.\n',
      );
    });
  });

  describe('misspelled names', () => {
    test('of variables are changed to close ones', async () => {
      const text = 'local targetAltitude is 1.\nprint targetAltitud.\n';
      const actions = await actionsFor(text, 2);
      expect(titles(actions)).toEqual(['Change to targetAltitude']);
      expect(actions[0].isPreferred).toBe(true);
      expect(apply(actions[0], text)).toBe(
        'local targetAltitude is 1.\nprint targetAltitude.\n',
      );
    });

    test('of builtins too', async () => {
      const text = 'print altitud.\n';
      const actions = await actionsFor(text, 1);
      expect(titles(actions)).toContain('Change to altitude');
    });

    test('far from every name get no fix', async () => {
      expect(await actionsFor('print qqqqqqqq.\n', 1)).toEqual([]);
    });

    test('of suffixes are changed to suffixes of the type', async () => {
      const text = 'print ship:altitud.\n';
      const actions = await actionsFor(text, 1);
      expect(titles(actions)).toEqual(['Change to altitude']);
      expect(apply(actions[0], text)).toBe('print ship:altitude.\n');
    });

    test('of types in doc comments are changed to structures', async () => {
      const text =
        '// @param v {List<Vesel>} the ships\n' +
        'function f { parameter v. print v. }\nf(list()).\n';
      const actions = await actionsFor(text, 1);
      expect(titles(actions)).toEqual(['Change to Vessel']);
      expect(apply(actions[0], text)).toMatch(/^\/\/ @param v \{List<Vessel>\}/);
    });
  });

  describe('a variable set with @lazyglobal off', () => {
    test('is declared global at the top level', async () => {
      const text = '@lazyglobal off.\nset x to 1.\nprint x.\n';
      const actions = await actionsFor(text, 2);
      expect(titles(actions)).toEqual([
        'Declare x with global',
        'Declare x with local',
      ]);
      expect(actions[0].isPreferred).toBe(true);
      expect(actions[1].isPreferred).toBeUndefined();
      expect(apply(actions[0], text)).toBe(
        '@lazyglobal off.\nglobal x is 1.\nprint x.\n',
      );
    });

    test('is declared local in a block', async () => {
      const text = '@lazyglobal off.\nif true {\n    set x to 1.\n}\n';
      const actions = await actionsFor(text, 3);
      expect(titles(actions)).toEqual([
        'Declare x with local',
        'Declare x with global',
      ]);
      expect(apply(actions[0], text)).toBe(
        '@lazyglobal off.\nif true {\n    local x is 1.\n}\n',
      );
    });

    test('in a chain gets no fix', async () => {
      const text = '@lazyglobal off.\nglobal y is 0.\nset y to 1, x to 2.\n';
      const actions = await actionsFor(text, 3);
      expect(
        titles(actions).filter((title) => title.startsWith('Declare')),
      ).toEqual([]);
    });
  });

  test('a misplaced directive is moved to the top or removed', async () => {
    const text = 'print 1.\n@lazyglobal off.\nprint 2.\n';
    const actions = await actionsFor(text, 2);
    expect(titles(actions)).toEqual([
      'Move @lazyglobal off. to the top of the file',
      'Remove @lazyglobal off.',
    ]);
    expect(apply(actions[0], text)).toBe(
      '@lazyglobal off.\nprint 1.\nprint 2.\n',
    );
    expect(apply(actions[1], text)).toBe('print 1.\nprint 2.\n');
  });

  test('a global parameter loses its global', async () => {
    const text = 'declare global parameter x.\nprint x.\n';
    const actions = await actionsFor(text, 1);
    expect(titles(actions)).toEqual(['Remove "global"']);
    expect(apply(actions[0], text)).toBe('declare parameter x.\nprint x.\n');
  });

  test('only quick fixes are offered', async () => {
    writeFileSync(join(root, 'a.ks'), 'print 1\n');
    client = await TestClient.start(root);
    client.open('a.ks');
    expect(await client.codeActions('a.ks', 1, ['source'])).toEqual([]);
    expect(await client.codeActions('a.ks', 1, ['quickfix'])).toHaveLength(1);
  });
});
