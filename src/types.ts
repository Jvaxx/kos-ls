import { SymbolTable } from './analysis/models/symbolTable';
import { IScript } from './parser/types';
import { Diagnostic, TextDocument } from 'vscode-languageserver';
import { DirectiveContainer } from './directives/directiveContainer';
import { Comment, Token } from './models/token';

export interface DependencyInfo {
  dependencyTables: Set<SymbolTable>;
  diagnostics: DiagnosticUri[];
}

export type Fallible<T extends object> = T & {
  diagnostics: DiagnosticUri[];
};

export interface LexiconLoad {
  lexicon: Map<string, LexicalInfo>;
  diagnostics: DiagnosticUri[];
}

export interface LexicalInfo {
  script: IScript;
  directives: DirectiveContainer;
  diagnostics: DiagnosticUri[];

  /**
   * The tokens of the script, those of the syntax tree: the analysis
   * sets their trackers
   */
  tokens: Token[];

  /**
   * Comments after the last token (the others are in the
   * `leadingComments` of the token that follows them)
   */
  trailingComments: Comment[];
}

export interface SemanticInfo {
  symbolTable: SymbolTable;
  diagnostics: DiagnosticUri[];
}

export interface DocumentInfo {
  lexicalInfo: LexicalInfo;
  semanticInfo: SemanticInfo;
  dependencyInfo: DependencyInfo;
}

export interface LoadedDocuments {
  documents: TextDocument[];
  diagnostics: Diagnostic[];
}

export interface DiagnosticUri extends Diagnostic {
  uri: string;
}

export interface ClientConfiguration {
  completionCase: 'lowercase' | 'uppercase' | 'camelcase' | 'pascalcase';
  kerbalSpaceProgramPath?: string;
  telnetHost: string;
  telnetPort: number;
  lspPort: number;
  trace: {
    server: {
      verbosity: 'off' | 'message' | 'verbose';
      format: 'text' | 'json';
      level: 'verbose' | 'info' | 'log' | 'warn' | 'error' | 'none';
    };
  };
}

export interface IClientCapabilities {
  hasConfiguration: boolean;
  hasWorkspaceFolder: boolean;
  hasWatchedFiles?: boolean;
  hasCodeLensRefresh?: boolean;
}
