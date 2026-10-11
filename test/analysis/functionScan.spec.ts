import { parseSource, noParseErrors } from '../utilities/setup';
import * as Decl from '../../src/parser/models/declare';
import { FunctionScan } from '../../src/analysis/functionScan';
import { empty } from '../../src/utilities/typeGuards';

const emptyFunction = `
function empty { }
`;

const returnFunction = `
function returning {
  return 10.
}
`;

const complicatedFunction = `
function complicated {
  parameter first.
  parameter x, y, other is 10.

  if x < 10 {
    return other.
  }

  local total is 0.
  for i in y {
    for j in first {
      set total to total + other + j.

      if total > 1e3 {
        return total.
      }
    }
  }

  local function inner {
    parameter a.
    print(a).

    return a.
  }

  return 10.
}
`;

const variadicFunctions = `
function looping {
  parameter count.
  from { local i is 0. } until i = count step { set i to i + 1. } do {
    parameter next.
  }
}

function branching {
  parameter withName.
  if withName {
    parameter name.
  }
}

function nested {
  parameter a.
  for x in a {
    local function inner {
      parameter b.
    }
  }
}
`;

describe('Function Scan', () => {
  test('empty function', () => {
    const parseResult = parseSource(emptyFunction);
    noParseErrors(parseResult);

    const { script } = parseResult.parse;
    expect(script.stmts).toHaveLength(1);

    const [funcStmt] = script.stmts;
    expect(funcStmt).toBeInstanceOf(Decl.Func);

    const funcScanner = new FunctionScan();

    if (funcStmt instanceof Decl.Func) {
      const scanResult = funcScanner.scan(funcStmt.block);
      expect(scanResult).toBeDefined();

      if (!empty(scanResult)) {
        expect(scanResult.return).toBe(false);
        expect(scanResult.requiredParameters).toBe(0);
        expect(scanResult.optionalParameters).toBe(0);
      }
    }
  });

  test('returning function', () => {
    const parseResult = parseSource(returnFunction);
    noParseErrors(parseResult);

    const { script } = parseResult.parse;
    expect(script.stmts).toHaveLength(1);

    const [funcStmt] = script.stmts;
    expect(funcStmt).toBeInstanceOf(Decl.Func);

    const funcScanner = new FunctionScan();

    if (funcStmt instanceof Decl.Func) {
      const scanResult = funcScanner.scan(funcStmt.block);
      expect(scanResult).toBeDefined();

      if (!empty(scanResult)) {
        expect(scanResult.return).toBe(true);
        expect(scanResult.requiredParameters).toBe(0);
        expect(scanResult.optionalParameters).toBe(0);
      }
    }
  });

  test('complicated function', () => {
    const parseResult = parseSource(complicatedFunction);
    noParseErrors(parseResult);

    const { script } = parseResult.parse;
    expect(script.stmts).toHaveLength(1);

    const [funcStmt] = script.stmts;
    expect(funcStmt).toBeInstanceOf(Decl.Func);

    const funcScanner = new FunctionScan();

    if (funcStmt instanceof Decl.Func) {
      const scanResult = funcScanner.scan(funcStmt.block);
      expect(scanResult).toBeDefined();

      if (!empty(scanResult)) {
        expect(scanResult.return).toBe(true);
        expect(scanResult.requiredParameters).toBe(3);
        expect(scanResult.optionalParameters).toBe(1);
        expect(scanResult.variadic).toBe(false);
      }
    }
  });

  test('function reading parameters in a loop or branch', () => {
    const parseResult = parseSource(variadicFunctions);
    noParseErrors(parseResult);

    const funcScanner = new FunctionScan();
    const results = parseResult.parse.script.stmts.map(stmt =>
      stmt instanceof Decl.Func ? funcScanner.scan(stmt.block) : undefined,
    );

    expect(results.map(result => result?.variadic)).toEqual([true, true, false]);
  });
});
