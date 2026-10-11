/**
 * Logging level internal to kos-language-server
 */
export const enum LogLevel {
  verbose,
  info,
  log,
  warn,
  error,
  none,
}

/**
 * This is used by the various completion functionailities
 * to decide how they should be cased
 */
export const enum CaseKind {
  lowerCase,
  upperCase,
  camelCase,
  pascalCase,
}
