import { KsSymbolKind } from '../analysis/types';
import { Token } from './token';
import { Range } from 'vscode-languageserver';
import type { TypeDocs } from '../typeChecker/types';

/**
 * A class containing the information of a parameter
 */
export class KsParameter {
  /**
   * A kerboscript parameter constructor
   * @param name the name of this parameter
   * @param range the range of this parameter
   */
  constructor(
    public readonly name: Token,
    public readonly range: Range,
    public readonly docs?: TypeDocs,
  )
  { }

  /**
   * What kind of symbol is represented in this case a parameter
   */
  get tag(): KsSymbolKind.parameter {
    return KsSymbolKind.parameter;
  }
}
