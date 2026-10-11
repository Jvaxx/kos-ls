import { parseTree, Node } from 'jsonc-parser';
import { WorkspaceConfiguration } from './models/workspaceConfiguration';
import { LintRule, lintRules } from './models/lintRules';
import { empty } from '../utilities/typeGuards';
import {
  TextDocument,
  DiagnosticSeverity,
  DiagnosticRelatedInformation,
  Position,
  Range,
} from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { Fallible, DiagnosticUri } from '../types';
import {
  createDiagnostic,
  CONFIG_DIAGNOSTICS,
} from '../utilities/diagnosticsUtils';

const VALID_PROPERTIES = ['archive', 'bodies', 'linting', 'volumes', 'preload', 'exclude'];

/**
 * Parse the configuration from the provided text document
 * @param document text document containing the configuration
 */
export function parseWorkspaceConfiguration(
  document: TextDocument,
): Fallible<{ config: WorkspaceConfiguration }> {
  const text = document.getText();
  const root = parseTree(text);

  let rootVolumePath: Maybe<string> = undefined;
  let bodies: Maybe<string[]> = undefined;
  let lintRules = new Map<string, LintRule>();
  let volumes: Maybe<Map<string, string>> = undefined;
  let preload: Maybe<string[]> = undefined;
  let exclude: Maybe<string[]> = undefined;
  const diagnostics: DiagnosticUri[] = [];
  const uri = document.uri;

  switch (root?.type) {
    case 'object':
      if (empty(root.children)) {
        break;
      }

      for (const prop of root.children) {
        switch (prop.type) {
          case 'property':
            if (empty(prop.children)) {
              break;
            }

            const [key, value] = prop.children;
            switch (key.value) {
              case 'archive':
                const volumeResult = parseArchive(value, text, uri);
                rootVolumePath = volumeResult.archive;
                diagnostics.push(...volumeResult.diagnostics);
                break;
              case 'bodies':
                const bodiesResult = parseBodies(value, text, uri);
                bodies = bodiesResult.bodies;
                diagnostics.push(...bodiesResult.diagnostics);
                break;
              case 'volumes':
                const volumesResult = parseVolumes(value, text, uri);
                volumes = volumesResult.volumes;
                diagnostics.push(...volumesResult.diagnostics);
                break;
              case 'preload':
                const preloadResult = parseStringArray(
                  value,
                  text,
                  uri,
                  'Expected an array of file paths for preload.',
                );
                preload = preloadResult.values;
                diagnostics.push(...preloadResult.diagnostics);
                break;
              case 'exclude':
                const excludeResult = parseStringArray(
                  value,
                  text,
                  uri,
                  'Expected an array of file or directory paths for exclude.',
                );
                exclude = excludeResult.values;
                diagnostics.push(...excludeResult.diagnostics);
                break;
              case 'linting':
                const lintResult = parseLintRules(value, text, uri);
                lintRules = lintResult.rules;
                diagnostics.push(...lintResult.diagnostics);
                break;
              default:
                // invalid property diagnostic
                diagnostics.push(
                  createConfigDiagnostic(
                    nodeRange(key, text),
                    uri,
                    `${key.value} is not a valid property in \`ksconfig.json\`.`,
                    CONFIG_DIAGNOSTICS.INVALID_PROPERTY,
                    [
                      {
                        location: { uri, range: nodeRange(key, text) },
                        message: `Valid options are ${VALID_PROPERTIES.join(
                          ', ',
                        )}.`,
                      },
                    ],
                  ),
                );
                break;
            }

            break;
          default:
            break;
        }
      }
  }

  return {
    config: new WorkspaceConfiguration(
      URI.parse(document.uri),
      rootVolumePath,
      bodies,
      lintRules,
      volumes,
      preload,
      exclude,
    ),
    diagnostics,
  };
}

/**
 * Parse the volume directories: an object from volume number or name to
 * a directory, e.g. `{ "1": "src" }`. Volume 0 is the archive.
 * @param node representing the volumes section of the configuration
 * @param text `ksconfig.json` text
 * @param uri uri of the `ksconfig.json` file
 */
function parseVolumes(
  node: Node,
  text: string,
  uri: string,
): Fallible<{ volumes: Maybe<Map<string, string>> }> {
  const diagnostics: DiagnosticUri[] = [];
  if (node.type !== 'object') {
    diagnostics.push(
      createConfigDiagnostic(
        nodeRange(node, text),
        uri,
        'Expected an object from volume to directory for volumes, e.g. { "1": "src" }.',
        CONFIG_DIAGNOSTICS.INVALID_VALUE,
      ),
    );
    return { diagnostics, volumes: undefined };
  }

  const volumes = new Map<string, string>();
  for (const prop of node.children ?? []) {
    const [key, value] = prop.children ?? [];
    if (empty(key) || empty(value)) {
      continue;
    }

    const volume = String(key.value).toLowerCase().replace(/:$/, '');
    if (!/^[a-z0-9_]+$/.test(volume)) {
      diagnostics.push(
        createConfigDiagnostic(
          nodeRange(key, text),
          uri,
          `${key.value} is not a volume number or name.`,
          CONFIG_DIAGNOSTICS.INVALID_PROPERTY,
        ),
      );
    } else if (value.type !== 'string') {
      diagnostics.push(
        createConfigDiagnostic(
          nodeRange(value, text),
          uri,
          'Expected a directory path for the volume.',
          CONFIG_DIAGNOSTICS.INVALID_VALUE,
        ),
      );
    } else {
      volumes.set(volume, value.value);
    }
  }

  return { diagnostics, volumes };
}

/**
 * Parse an array of strings
 * @param node json node
 * @param text `ksconfig.json` text
 * @param uri uri of the `ksconfig.json` file
 * @param message diagnostic message for a wrong value
 */
function parseStringArray(
  node: Node,
  text: string,
  uri: string,
  message: string,
): Fallible<{ values: Maybe<string[]> }> {
  const diagnostics: DiagnosticUri[] = [];
  if (node.type !== 'array') {
    diagnostics.push(
      createConfigDiagnostic(
        nodeRange(node, text),
        uri,
        message,
        CONFIG_DIAGNOSTICS.INVALID_VALUE,
      ),
    );
    return { diagnostics, values: undefined };
  }

  const values: string[] = [];
  for (const item of node.children ?? []) {
    if (item.type === 'string') {
      values.push(item.value);
    } else {
      diagnostics.push(
        createConfigDiagnostic(
          nodeRange(item, text),
          uri,
          message,
          CONFIG_DIAGNOSTICS.INVALID_VALUE,
        ),
      );
    }
  }

  return { diagnostics, values };
}

/**
 * Parse the archive directory for use in a workspace configuration
 * @param node representing the bodies section of the configuration
 * @param text `ksconfig.json` text
 * @param uri uri of the `ksconfig.json` file
 */
function parseArchive(
  node: Node,
  text: string,
  uri: string,
): Fallible<{ archive: Maybe<string> }> {
  const diagnostics: DiagnosticUri[] = [];

  if (node.type === 'string' && typeof node.value === 'string') {
    return { archive: node.value, diagnostics };
  }

  // expect string for archive value
  diagnostics.push(
    createConfigDiagnostic(
      nodeRange(node, text),
      uri,
      'Expected a string to the archive folder',
      CONFIG_DIAGNOSTICS.INVALID_VALUE,
    ),
  );

  return { diagnostics, archive: undefined };
}

/**
 * Parse a set of custom bodies for use in a workspace configuration
 * @param node representing the bodies section of the configuration
 * @param text `ksconfig.json` text
 * @param uri uri of the `ksconfig.json` file
 */
function parseBodies(
  node: Node,
  text: string,
  uri: string,
): Fallible<{ bodies: Maybe<string[]> }> {
  const diagnostics: DiagnosticUri[] = [];
  if (node.type !== 'array') {
    // bodies expects an array diagnostics
    diagnostics.push(
      createConfigDiagnostic(
        nodeRange(node, text),
        uri,
        `Expected an array of strings for bodies.`,
        CONFIG_DIAGNOSTICS.INVALID_VALUE,
      ),
    );

    return { diagnostics, bodies: undefined };
  }

  const bodies: string[] = [];
  if (node.type === 'array') {
    for (const item of node.children!) {
      if (item.type === 'string' && typeof item.value === 'string') {
        bodies.push(item.value);
      } else {
        // diagnostic for elements that aren't strings
        diagnostics.push(
          createConfigDiagnostic(
            nodeRange(item, text),
            uri,
            `Expected an array of strings for bodies.`,
            CONFIG_DIAGNOSTICS.INVALID_VALUE,
          ),
        );
      }
    }
  }

  return { diagnostics, bodies };
}

/**
 * Parse a set of lint rules for use in a workspace configuration
 * @param node representing the lint section of the configuration
 * @param text `ksconfig.json` text
 * @param uri uri of the `ksconfig.json` file
 */
function parseLintRules(
  node: Node,
  text: string,
  uri: string,
): Fallible<{ rules: Map<string, LintRule> }> {
  const diagnostics: DiagnosticUri[] = [];
  const rules = new Map<string, LintRule>();

  if (node.type === 'object') {
    for (const prop of node.children!) {
      if (prop.type === 'property') {
        const [key, value] = prop.children!;

        // check if rule exists
        const rule = lintRules.get(key.value);
        if (!empty(rule)) {
          if (value.type === 'string' && typeof value.value === 'string') {
            // check if correct level was provided
            switch (value.value) {
              case 'error':
              case 'warning':
              case 'info':
              case 'hint':
              case 'off':
                rules.set(
                  key.value,
                  LintRule.from({ ...rule, level: value.value }),
                );
                break;
              default:
                // incorrect level diagnostic
                diagnostics.push(
                  createConfigDiagnostic(
                    nodeRange(value, text),
                    uri,
                    `${value.value} is not a lint level`,
                    CONFIG_DIAGNOSTICS.INVALID_VALUE,
                    [
                      {
                        location: { uri, range: nodeRange(value, text) },
                        message:
                          'These are the valid lint level "error", "warning", "info", "hint", "off"',
                      },
                    ],
                  ),
                );
                break;
            }
          } else {
            diagnostics.push(
              createConfigDiagnostic(
                nodeRange(value, text),
                uri,
                `${value.value} is not a lint level`,
                CONFIG_DIAGNOSTICS.INVALID_VALUE,
                [
                  {
                    location: { uri, range: nodeRange(value, text) },
                    message:
                      'These are the valid lint level "error", "warning", "info", "hint", "off"',
                  },
                ],
              ),
            );
          }
        } else {
          // invalid rule diagnostic
          diagnostics.push(
            createConfigDiagnostic(
              nodeRange(key, text),
              uri,
              `${key.value} is not a valid rule`,
              CONFIG_DIAGNOSTICS.INVALID_PROPERTY,
              [
                {
                  location: { uri, range: nodeRange(key, text) },
                  message: `These are the valid lint rules ${[
                    ...lintRules.keys(),
                  ].join(', ')}`,
                },
              ],
            ),
          );
        }
      }
    }
  } else {
    // linting takes an object diagnostics
    diagnostics.push(
      createConfigDiagnostic(
        nodeRange(node, text),
        uri,
        'Expected object for linting',
        CONFIG_DIAGNOSTICS.INVALID_VALUE,
      ),
    );
  }

  return { rules, diagnostics };
}

/**
 * Create a diagnostics for the `ksconfig.json` file
 * @param range range of the json node the error occurred on
 * @param uri uri of the `ksconfig.json` file
 * @param message error message
 * @param code error code
 * @param relatedInformation related information to the diagnostics
 */
function createConfigDiagnostic(
  range: Range,
  uri: string,
  message: string,
  code: ValueOf<typeof CONFIG_DIAGNOSTICS>,
  relatedInformation?: DiagnosticRelatedInformation[],
): DiagnosticUri {
  return {
    ...createDiagnostic(
      range,
      message,
      DiagnosticSeverity.Information,
      code,
      relatedInformation,
    ),
    uri,
  };
}

/**
 * Get the range for a node in the json file
 * @param node json node
 */
function nodeRange(node: Node, text: string) {
  return {
    start: offsetPosition(node.offset, text),
    end: offsetPosition(node.offset + node.length, text),
  };
}

/**
 * Get the position of a given offset in the json document
 * @param offset json character offset
 * @param text `ksconfig.json` text
 */
function offsetPosition(offset: number, text: string): Position {
  let line = 0;
  let lineOffset = 0;
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\n') {
      line++;
      lineOffset = i + 1;
    }
  }

  return { line, character: offset - lineOffset };
}
