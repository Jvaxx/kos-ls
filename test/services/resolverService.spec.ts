import { ResolverService } from '../../src/services/resolverService';
import { Location } from 'vscode-languageserver';
import { URI } from 'vscode-uri';

const range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 1 },
};

const at = (path: string): Location => ({
  range,
  uri: URI.file(path).toString(),
});

/**
 * A resolver for an archive at /arch, where only the given files exist
 * @param files existing files
 */
const resolver = (...files: string[]) => {
  const existing = new Set(files);
  const service = new ResolverService(undefined, (uri) =>
    existing.has(uri.fsPath),
  );
  service.rootVolume = URI.file('/arch');
  return service;
};

const resolved = (service: ResolverService, caller: string, path: string) =>
  service.resolve(at(caller), path)?.fsPath;

describe('resolver service', () => {
  test('is not ready without an archive', () => {
    const service = new ResolverService();
    expect(service.ready()).toBe(false);
    expect(service.resolvePath(at('/arch/a.ks'), '0:/b.ks')).toEqual({
      kind: 'notReady',
    });
  });

  test('resolves archive paths', () => {
    const service = resolver();
    expect(resolved(service, '/arch/x/a.ks', '0:/lib/b.ks')).toBe(
      '/arch/lib/b.ks',
    );
    expect(resolved(service, '/arch/x/a.ks', '0:lib/b')).toBe('/arch/lib/b');
    expect(resolved(service, '/arch/x/a.ks', 'Archive:/lib/b.ks')).toBe(
      '/arch/lib/b.ks',
    );
  });

  test('resolves mapped volumes', () => {
    const service = resolver();
    service.volumes.set('1', URI.file('/arch/src'));
    service.volumes.set('probe', URI.file('/elsewhere'));

    expect(resolved(service, '/arch/boot/a.ks', '1:/lib/std.ks')).toBe(
      '/arch/src/lib/std.ks',
    );
    expect(resolved(service, '/arch/boot/a.ks', 'PROBE:/x.ks')).toBe(
      '/elsewhere/x.ks',
    );
  });

  test('reports unmapped volumes', () => {
    expect(resolver().resolvePath(at('/arch/a.ks'), '1:/lib/std.ks')).toEqual({
      kind: 'unmappedVolume',
      volume: '1',
    });
  });

  describe('paths without a volume', () => {
    test('prefer the caller directory', () => {
      const service = resolver('/arch/x/b.ks', '/arch/b.ks');
      expect(resolved(service, '/arch/x/a.ks', 'b.ks')).toBe('/arch/x/b.ks');
      expect(resolved(service, '/arch/x/y/a.ks', '../b.ks')).toBe(
        '/arch/x/b.ks',
      );
    });

    test('fall back to the root of the caller volume', () => {
      const service = resolver('/arch/src/lib/b.ks', '/arch/lib/b.ks');
      service.volumes.set('1', URI.file('/arch/src'));
      expect(resolved(service, '/arch/src/boot/a.ks', 'lib/b.ks')).toBe(
        '/arch/src/lib/b.ks',
      );
    });

    test('fall back to the archive', () => {
      const service = resolver('/arch/lib/b.ks');
      service.volumes.set('1', URI.file('/arch/src'));
      expect(resolved(service, '/arch/src/boot/a.ks', 'lib/b.ks')).toBe(
        '/arch/lib/b.ks',
      );
    });

    test('find files without their extension', () => {
      const service = new ResolverService(undefined, (uri) =>
        uri.fsPath.endsWith('/arch/lib/b'),
      );
      service.rootVolume = URI.file('/arch');
      expect(resolved(service, '/arch/boot/a.ks', 'lib/b')).toBe('/arch/lib/b');
    });

    test('designate the caller directory when nothing exists', () => {
      expect(resolved(resolver(), '/arch/boot/a.ks', 'lib/b.ks')).toBe(
        '/arch/boot/lib/b.ks',
      );
    });

    test('starting with a slash are on the caller volume', () => {
      const service = resolver();
      service.volumes.set('1', URI.file('/arch/src'));
      expect(resolved(service, '/arch/src/boot/a.ks', '/lib/b.ks')).toBe(
        '/arch/src/lib/b.ks',
      );
    });
  });
});
