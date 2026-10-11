import { LintRule, lintRules } from './lintRules';
import { empty } from '../../utilities/typeGuards';
import { URI } from 'vscode-uri';
import { join, dirname, relative, isAbsolute } from 'path';
import { existsSync } from 'fs';
import { DEFAULT_BODIES } from '../../utilities/constants';

/**
 * Class representing a ksconfig.json file. This is used to specify
 * configurations for this workspace
 */
export class WorkspaceConfiguration {
  /**
   * The location of the workspace config
   */
  public configDirectoryUri?: URI;

  /**
   * The location of the root volume (volume 0)
   */
  public readonly rootVolumePath?: string;

  /**
   * The name of any custom bodies used i.e. modded
   */
  public readonly bodies?: string[];

  /**
   * These are the lint rules enabled and at what level
   */
  public readonly lintRules?: Map<string, LintRule>;

  /**
   * Directories of other kOS volumes, relative to the config, by volume
   * number or name (lower case, without the colon)
   */
  public readonly volumes?: Map<string, string>;

  /**
   * Files run at runtime before every script (e.g. by a boot file through
   * a path computed at runtime), relative to the config. Their globals are
   * visible in every file of the workspace.
   */
  public readonly preload?: string[];

  /**
   * Files and directories, relative to the config, that are not analysed
   * unless opened or run by another file, e.g. generated copies
   */
  public readonly exclude?: string[];

  /**
   * May declarations hide kOS builtins without `@clobberbuiltins on.`
   * (kOS's `Config:CLOBBERBUILTINS`, off by default)
   */
  public readonly clobberBuiltins?: boolean;

  /**
   * Construct a new configuration
   * @param rootVolumePath root volume
   * @param bodies custom bodies
   * @param lintRules lint rules in place
   * @param volumes directories of other volumes
   * @param preload files run before every script
   * @param exclude files and directories not analysed
   * @param clobberBuiltins may declarations hide builtins
   */
  constructor(
    configDirectoryUri?: URI,
    rootVolumePath?: string,
    bodies?: string[],
    lintRules?: Map<string, LintRule>,
    volumes?: Map<string, string>,
    preload?: string[],
    exclude?: string[],
    clobberBuiltins?: boolean,
  ) {
    this.configDirectoryUri = configDirectoryUri;
    this.rootVolumePath = rootVolumePath;
    this.bodies = bodies;
    this.lintRules = lintRules;
    this.volumes = volumes;
    this.preload = preload;
    this.exclude = exclude;
    this.clobberBuiltins = clobberBuiltins;
  }

  /**
   * What is the location of the root volume
   */
  public rootVolumeUri(): Maybe<URI> {
    if (empty(this.configDirectoryUri)) {
      return undefined;
    }

    const configDirectory = dirname(this.configDirectoryUri.fsPath);
    const rootVolume = join(configDirectory, this.rootVolumePath ?? '.');

    return existsSync(rootVolume)
      ? URI.file(rootVolume)
      : URI.file(configDirectory);
  }

  /**
   * Directories of the other volumes, by volume number or name
   */
  public volumeUris(): Map<string, URI> {
    const uris = new Map<string, URI>();
    if (empty(this.configDirectoryUri) || empty(this.volumes)) {
      return uris;
    }

    const configDirectory = dirname(this.configDirectoryUri.fsPath);
    for (const [volume, path] of this.volumes) {
      uris.set(volume, URI.file(join(configDirectory, path)));
    }
    return uris;
  }

  /**
   * Files run before every script
   */
  public preloadUris(): URI[] {
    if (empty(this.configDirectoryUri) || empty(this.preload)) {
      return [];
    }

    const configDirectory = dirname(this.configDirectoryUri.fsPath);
    return this.preload.map((path) => URI.file(join(configDirectory, path)));
  }

  /**
   * Is a file excluded from analysis
   * @param uri file uri
   */
  public isExcluded(uri: URI): boolean {
    if (empty(this.configDirectoryUri) || empty(this.exclude)) {
      return false;
    }

    const configDirectory = dirname(this.configDirectoryUri.fsPath);
    return this.exclude.some((path) => {
      const inside = relative(join(configDirectory, path), uri.fsPath);
      return !inside.startsWith('..') && !isAbsolute(inside);
    });
  }

  /**
   * Merge this configuration with another
   * @param config config to merge into this one
   */
  public merge(config: WorkspaceConfiguration): WorkspaceConfiguration {
    const configUri = config.configDirectoryUri || this.configDirectoryUri;
    const rootVolume = config.rootVolumePath || this.rootVolumePath;
    const bodies = config.bodies || this.bodies;
    const lintRules =
      !empty(config.lintRules) && !empty(this.lintRules)
        ? new Map([...this.lintRules, ...config.lintRules])
        : config.lintRules || this.lintRules;

    return new WorkspaceConfiguration(
      configUri,
      rootVolume,
      bodies,
      lintRules,
      config.volumes || this.volumes,
      config.preload || this.preload,
      config.exclude || this.exclude,
      config.clobberBuiltins ?? this.clobberBuiltins,
    );
  }

  /**
   * Is this workspace configuration equal to another
   * @param other other workspace configuration to compare to
   */
  public equal(other: WorkspaceConfiguration): boolean {
    return serialize(this) === serialize(other);
  }
}

/**
 * Serialize a configuration for comparison. Maps are written as entry
 * lists, which JSON.stringify alone would turn into empty objects.
 * @param config configuration to serialize
 */
function serialize(config: WorkspaceConfiguration): string {
  return JSON.stringify(config, (_, value) =>
    value instanceof Map ? [...value] : value,
  );
}

/**
 * The default configuration workspace configuration
 */
export const defaultWorkspaceConfiguration = new WorkspaceConfiguration(
  undefined,
  '.',
  DEFAULT_BODIES,
  new Map([...lintRules].filter(([_, rule]) => rule.owned.length === 0)),
);
