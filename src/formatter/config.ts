import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { parse } from 'jsonc-parser';
import { FormatOptions, parseFormatFile, validateOptions } from './options';

/**
 * Options found for a file, and where
 */
export interface FoundOptions {
  options: Partial<FormatOptions>;

  /**
   * Problems in the file the options come from
   */
  errors: string[];

  /**
   * The file the options come from, undefined for the defaults
   */
  file?: string;
}

/**
 * Find the formatter options of a file, like clang-format: the nearest
 * directory, from the file's up to the root, holding a `.kos-format` file
 * or a `ksconfig.json` with a `format` section gives them. In the same
 * directory `.kos-format` wins.
 * @param path path of the file or of its directory
 */
export function findFormatOptions(path: string): FoundOptions {
  let directory = isDirectory(path) ? path : dirname(path);

  for (;;) {
    const formatFile = join(directory, '.kos-format');
    if (existsSync(formatFile)) {
      return { ...parseFormatFile(readText(formatFile)), file: formatFile };
    }

    const configFile = join(directory, 'ksconfig.json');
    if (existsSync(configFile)) {
      const config: unknown = parse(readText(configFile));
      if (
        typeof config === 'object' &&
        config !== null &&
        'format' in config &&
        config.format !== undefined
      ) {
        return { ...validateOptions(config.format), file: configFile };
      }
    }

    const parent = dirname(directory);
    if (parent === directory) {
      return { options: {}, errors: [] };
    }
    directory = parent;
  }
}

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const readText = (path: string): string => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
};
