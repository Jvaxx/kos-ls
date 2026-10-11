import { existsSync } from 'fs';
import { join, dirname, relative, isAbsolute } from 'path';
import { Location } from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { normalizeExtensions } from '../utilities/pathUtils';
import { empty } from '../utilities/typeGuards';

/**
 * The result of resolving a kOS path
 */
export type Resolution =
  /** the path designates this file (which may not exist) */
  | { kind: 'file'; uri: URI }
  /** the path is on a volume with no directory configured */
  | { kind: 'unmappedVolume'; volume: string }
  /** the resolver has no archive directory yet */
  | { kind: 'notReady' };

/**
 * Names that designate the archive, volume 0
 */
const archiveNames = new Set(['0', 'archive']);

/**
 * Does a file exist for this uri, as kOS would find it (`.ksm` and missing
 * extensions are normalized to `.ks`)
 * @param uri file uri
 */
const fileExists = (uri: URI): boolean => {
  if (existsSync(uri.fsPath)) {
    return true;
  }

  const normalized = normalizeExtensions(uri);
  return !empty(normalized) && existsSync(URI.parse(normalized).fsPath);
};

/**
 * Class to resolve run statements or calls to file paths
 */
export class ResolverService {
  /**
   * The directory of volume 0, the archive
   */
  public rootVolume?: URI;

  /**
   * The directories of other volumes, by lower case number or name
   */
  public volumes: Map<string, URI>;

  /**
   * Checks whether a file exists, to choose between candidate locations
   */
  private readonly exists: (uri: URI) => boolean;

  /**
   * Create an instance of that path resolve.
   * @param rootVolume the uri associated with volume 0
   * @param exists file existence check
   */
  constructor(rootVolume?: string, exists: (uri: URI) => boolean = fileExists) {
    this.rootVolume = !empty(rootVolume) ? URI.parse(rootVolume) : undefined;
    this.volumes = new Map();
    this.exists = exists;
  }

  /**
   * Is the resolve ready to resolve paths
   */
  public ready(): boolean {
    return !empty(this.rootVolume);
  }

  /**
   * Resolve path from kerboscript run statement
   * @param caller location of caller
   * @param rawPath path provided in a run statement
   */
  public resolve(caller: Location, rawPath: string): Maybe<URI> {
    const resolution = this.resolvePath(caller, rawPath);
    return resolution.kind === 'file' ? resolution.uri : undefined;
  }

  /**
   * Resolve a kOS path, `[volume:]path`, used in a file
   *
   * A path with a volume is resolved in that volume's directory. A path
   * without one is relative to the current directory at runtime, which
   * is not known statically: the first existing file is taken among the
   * caller's directory, the root of the caller's volume and the archive.
   * @param caller location of caller
   * @param rawPath path provided in a run statement
   */
  public resolvePath(caller: Location, rawPath: string): Resolution {
    if (empty(this.rootVolume)) {
      return { kind: 'notReady' };
    }

    const callerUri = URI.parse(caller.uri);
    if (callerUri.scheme !== 'file') {
      return { kind: 'notReady' };
    }

    const match = /^([A-Za-z0-9_]+):(.*)$/.exec(rawPath);
    if (match !== null) {
      const volume = match[1].toLowerCase();
      const root = this.volumeRoot(volume);
      if (empty(root)) {
        return { kind: 'unmappedVolume', volume };
      }

      return { kind: 'file', uri: this.join(root, match[2]) };
    }

    const callerRoot = this.callerVolumeRoot(callerUri);

    // an absolute path is relative to the current volume's root
    if (rawPath.startsWith('/')) {
      return { kind: 'file', uri: this.join(callerRoot, rawPath) };
    }

    const candidates = [
      this.join(URI.file(dirname(callerUri.fsPath)), rawPath),
      this.join(callerRoot, rawPath),
      this.join(this.rootVolume, rawPath),
    ];
    const found = candidates.find((candidate) => this.exists(candidate));
    return { kind: 'file', uri: found ?? candidates[0] };
  }

  /**
   * The directory of a volume
   * @param volume lower case volume number or name
   */
  private volumeRoot(volume: string): Maybe<URI> {
    return archiveNames.has(volume) ? this.rootVolume : this.volumes.get(volume);
  }

  /**
   * The root of the volume a file is on: the innermost volume directory
   * that contains it, else the archive
   * @param uri file uri
   */
  private callerVolumeRoot(uri: URI): URI {
    let best = this.rootVolume!;
    let bestDepth = -1;

    for (const root of [this.rootVolume!, ...this.volumes.values()]) {
      const path = relative(root.fsPath, uri.fsPath);
      if (path.startsWith('..') || isAbsolute(path)) {
        continue;
      }

      const depth = root.fsPath.split(/[\\/]/).length;
      if (depth > bestDepth) {
        best = root;
        bestDepth = depth;
      }
    }

    return best;
  }

  /**
   * Join a kOS path to a directory
   * @param root directory
   * @param path kOS path, '/' separated
   */
  private join(root: URI, path: string): URI {
    return URI.file(join(root.fsPath, ...path.split('/')));
  }
}
