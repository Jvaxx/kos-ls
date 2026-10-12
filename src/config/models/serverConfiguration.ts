import { ClientConfiguration, IClientCapabilities } from '../../types';
import { URI } from 'vscode-uri';

export class ServerConfiguration {
  /**
   * What system path corresponds to the root of the workspace
   */
  public readonly workspaceFolder?: string;

  /**
   * What Uri corresponds to the root of the workspace
   */
  public readonly workspaceUri?: URI;

  /**
   * The client configurations for the language server
   */
  public readonly clientConfig: ClientConfiguration;

  /**
   * What are the client capabilities in terms of the language
   * server protocol
   */
  public readonly clientCapability: IClientCapabilities;

  /**
   * Construct a new server configuration
   * @param workspaceFolder workspace folder
   * @param workspaceUri workspace uri
   * @param clientConfig client configuration for the server
   * @param clientCapability client lsp configuration
   */
  constructor(
    clientConfig: ClientConfiguration,
    clientCapability: IClientCapabilities,
    workspaceFolder?: string,
    workspaceUri?: URI,
  ) {
    this.workspaceFolder = workspaceFolder;
    this.workspaceUri = workspaceUri;
    this.clientConfig = clientConfig;
    this.clientCapability = clientCapability;
  }

  /**
   * Merge a partial server configuration into this configuration
   * @param config partial server configuration
   */
  public merge(config: Partial<ServerConfiguration>): ServerConfiguration {
    return new ServerConfiguration(
      normalizeClientConfiguration(config.clientConfig || this.clientConfig),
      config.clientCapability || this.clientCapability,
      config.workspaceFolder || this.workspaceFolder,
      config.workspaceUri || this.workspaceUri,
    );
  }

  /**
   * Is this server config equal to another?
   * @param other other configuration
   */
  public equal(other: ServerConfiguration): boolean {
    return JSON.stringify(this) === JSON.stringify(other);
  }
}

/**
 * The default client side kls configuration
 */
const completionCases = ['lowercase', 'uppercase', 'camelcase', 'pascalcase'];
const logLevels = ['verbose', 'info', 'log', 'warn', 'error', 'none'];

/**
 * Complete settings sent by a client with the defaults, ignoring invalid
 * values (case-insensitive enumerations are lowercased)
 * @param settings settings from the client, possibly partial
 */
export function normalizeClientConfiguration(
  settings: Partial<ClientConfiguration> | null | undefined,
): ClientConfiguration {
  const config = settings ?? {};
  const defaults = defaultClientConfiguration;
  const server = { ...defaults.trace.server, ...config.trace?.server };

  const completionCase = String(config.completionCase ?? '').toLowerCase();
  const level = String(server.level).toLowerCase();

  return {
    ...defaults,
    ...config,
    completionCase: completionCases.includes(completionCase)
      ? (completionCase as ClientConfiguration['completionCase'])
      : defaults.completionCase,
    trace: {
      server: {
        ...server,
        level: logLevels.includes(level)
          ? (level as ClientConfiguration['trace']['server']['level'])
          : defaults.trace.server.level,
      },
    },
  };
}

export const defaultClientConfiguration: ClientConfiguration = {
  completionCase: 'camelcase',
  trace: {
    server: {
      level: 'error',
    },
  },
};

/**
 * The default server side kls configuration
 */
export const defaultServerConfiguration = new ServerConfiguration(
  defaultClientConfiguration,
  {
    hasConfiguration: false,
    hasWorkspaceFolder: false,
  },
  '',
  undefined,
);
