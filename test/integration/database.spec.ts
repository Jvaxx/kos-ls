import { TestClient, workspaces } from './harness';
import { join } from 'path';
import { DiagnosticSeverity, MarkupContent } from 'vscode-languageserver';

const root = join(workspaces, 'archive');
const file = 'src/scratch.ks';

/**
 * The text of a hover
 */
const hoverText = async (
  client: TestClient,
  line: number,
  character: number,
) => {
  const hover = await client.hover(file, line, character);
  return (hover?.contents as MarkupContent | { value: string })?.value ?? '';
};

describe('kOS database', () => {
  let client: TestClient;

  beforeEach(async () => {
    client = await TestClient.start(root);
  });

  afterEach(async () => {
    await client?.stop();
  });

  test('scripts written against kOS 1.6 have no diagnostics', async () => {
    client.open(
      file,
      [
        '@lazyglobal off.',
        'if addons:rt:available and addons:rt:hasconnection(ship) { print "rt". }',
        'if addons:tr:available { print addons:tr:impactpos. }',
        'local s is readjson("1:/state.json").',
        'if s:haskey("key") { print s["key"]. }',
        'kuniverse:timewarp:warpto(time:seconds + 60).',
        'for f in open("0:/manifest"):readall:string:split(char(10)) { print f. }',
        'print stage:number + stage:deltav:current.',
        'print ship:stagedeltav(ship:stagenum):vacuum.',
        'local engs is list().',
        'list engines in engs.',
        'for e in engs { print e:ignition and e:flameout. }',
        'print body("Mun"):radius + body:radius.',
        'print heading(90, 45) + " " + heading.',
        'lock steering to ship:prograde:vector.',
        'set ship:control:neutralize to true.',
        'print constant:pi * config:ipu.',
      ].join('\n'),
    );

    expect(await client.messages(file)).toEqual([]);
  });

  test('wrong suffixes are reported with the kOS structure', async () => {
    client.open(
      file,
      ['print ship:foo.', 'print ship:parts[0]:bar.'].join('\n'),
    );

    expect(await client.messages(file)).toEqual([
      '1:12 Unable to find suffix foo on type Vessel',
      '2:21 Unable to find suffix bar on type Part',
    ]);
  });

  test('list targets give typed elements', async () => {
    client.open(
      file,
      [
        'local engs is list().',
        'list engines in engs.',
        'for e in engs { print e. }',
        'list parts in ps.',
        'print ps.',
      ].join('\n'),
    );

    expect(await hoverText(client, 2, 4)).toContain('e: Engine');
    expect(await hoverText(client, 4, 6)).toContain('ps: List<Part>');
  });

  test('a called name is the function, else the variable', async () => {
    client.open(
      file,
      [
        'local a is stage.',
        'local b is time().',
        'local c is time.',
        'print a. print b. print c.',
      ].join('\n'),
    );

    expect(await hoverText(client, 0, 6)).toContain('a: Stage');
    expect(await hoverText(client, 1, 6)).toContain('b: TimeStamp');
    expect(await hoverText(client, 2, 6)).toContain('c: TimeStamp');
    expect(await client.messages(file)).toEqual([]);
  });

  test('user functions, unknown types and optional arguments', async () => {
    client.open(
      file,
      [
        '@lazyglobal off.',
        'local g is gui(200).',
        'local s is g:addhslider(0, 0, 100).',
        'set g:addbutton("go"):onclick to start@.',
        'local d is report@.',
        'd:call().',
        'print_args(2, "a", "b").',
        'function start { print s:value. }',
        'function report { return 1. }',
        'function print_args {',
        '  parameter n.',
        '  from { local i is 0. } until i >= n step { set i to i + 1. } do {',
        '    parameter arg.',
        '    print arg.',
        '  }',
        '}',
        'function f {',
        '  parameter items, offset.',
        '  for item in items { print -item. }',
        '  print -offset.',
        '  print offset * 0.5 + v(1, 0, 0).',
        '  print v(1, 0, 0):normalized * offset - v(0, 1, 0).',
        '}',
      ].join('\n'),
    );

    expect(await client.messages(file)).toEqual([]);
  });

  test('wrong argument counts of user functions are reported', async () => {
    client.open(
      file,
      [
        'function two { parameter a, b. print a + b. }',
        'function opt { parameter a, b is 1. print a + b. }',
        'two(1).',
        'two(1, 2, 3).',
        'opt().',
      ].join('\n'),
    );

    expect(await client.messages(file)).toEqual([
      '3:6 Call expected 2 required parameters but was called with 1 arguments',
      '4:11 Call expected 2 parameters but was called with 3 arguments',
      '5:5 Call expected 1 required parameters but was called with 0 arguments',
    ]);
    const severities = (await client.diagnosticsFor(file)).map(
      (d) => d.severity,
    );
    expect(severities).toEqual([
      DiagnosticSeverity.Warning,
      DiagnosticSeverity.Warning,
      DiagnosticSeverity.Warning,
    ]);
  });

  test('values may be of a derived structure or of any type given', async () => {
    client.open(
      file,
      [
        '@lazyglobal off.',
        'local port is ship:partstagged("port")[0].',
        'port:undock.',
        'for m in ship:modulesnamed("ModuleScienceExperiment") { m:deploy. }',
        'local selected is 0.',
        'pick().',
        'print selected:position.',
        'function pick { set selected to ship:parts[0]. }',
        'print positionat(target, time:seconds + 60).',
        'local items is list(1).',
        'print items#0 + 1.',
        'set items to readjson("1:/x.json").',
        'print items["key"].',
      ].join('\n'),
    );

    expect(await client.messages(file)).toEqual([]);
  });
});
