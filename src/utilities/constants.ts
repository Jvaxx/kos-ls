import { CompletionItemKind, CompletionItem } from 'vscode-languageserver';
import { toCase } from './stringUtils';

export const builtIn = 'builtIn';
export const iterator = 'iterator';

export const serverName = 'kos-ls';

/**
 * Settings sections read when the client has none for serverName: the
 * one kos-language-server used
 */
export const legacyServerNames = ['kos-vscode'];
export const languageServer = 'kos-language-server';

export const notFoundErrorCode = 'ENOTFOUND';

export const keywords = new Set([
  'add',
  'and',
  'all',
  'at',
  'break',
  'choose',
  'clearscreen',
  'clobberbuiltins',
  'compile',
  'copy',
  'do',
  'declare',
  'defined',
  'delete',
  'edit',
  'else',
  'false',
  'file',
  'for',
  'from',
  'function',
  'global',
  'if',
  'in',
  'is',
  'lazyglobal',
  'list',
  'local',
  'lock',
  'log',
  'not',
  'off',
  'on',
  'or',
  'once',
  'parameter',
  'preserve',
  'print',
  'reboot',
  'remove',
  'rename',
  'return',
  'run',
  'runpath',
  'runoncepath',
  'set',
  'shutdown',
  'stage',
  'step',
  'switch',
  'then',
  'to',
  'true',
  'toggle',
  'unlock',
  'unset',
  'until',
  'volume',
  'wait',
  'when',
]);

const keywordSegments: string[][] = [
  ['add'],
  ['and'],
  ['all'],
  ['at'],
  ['break'],
  ['choose'],
  ['clear', 'screen'],
  ['clobber', 'builtins'],
  ['compile'],
  ['copy'],
  ['do'],
  ['declare'],
  ['defined'],
  ['delete'],
  ['edit'],
  ['else'],
  ['false'],
  ['file'],
  ['for'],
  ['from'],
  ['function'],
  ['global'],
  ['if'],
  ['in'],
  ['is'],
  ['lazy', 'global'],
  ['list'],
  ['local'],
  ['lock'],
  ['log'],
  ['not'],
  ['off'],
  ['on'],
  ['or'],
  ['once'],
  ['parameter'],
  ['preserve'],
  ['print'],
  ['reboot'],
  ['remove'],
  ['rename'],
  ['return'],
  ['run'],
  ['run', 'path'],
  ['run', 'once', 'path'],
  ['set'],
  ['shutdown'],
  ['stage'],
  ['step'],
  ['switch'],
  ['then'],
  ['to'],
  ['true'],
  ['toggle'],
  ['unlock'],
  ['unset'],
  ['until'],
  ['volume'],
  ['wait'],
  ['when'],
];

export const DEFAULT_BODIES: string[] = [
  'kerbol',
  'moho',
  'eve',
  'gilly',
  'kerbin',
  'mun',
  'minmus',
  'duna',
  'ike',
  'dres',
  'jool',
  'laythe',
  'vall',
  'tylo',
  'bop',
  'pol',
  'eeloo',
];

/**
 * Generate a cased set of keyword completion items
 * @param caseKind case of the keyword completions
 */
export const keywordCompletions = (caseKind: CaseKind): CompletionItem[] => {
  const casedKeywords: string[] = [];

  for (const segments of keywordSegments) {
    casedKeywords.push(toCase(caseKind, ...segments));
  }

  return casedKeywords.map(keyword => ({
    kind: CompletionItemKind.Keyword,
    label: keyword,
    data: undefined,
  }));
};
