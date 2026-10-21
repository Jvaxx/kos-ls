#!/usr/bin/env node
// Offline verification of the editable source inputs shipped with releases.
const assert = require('assert/strict');
const { createHash } = require('crypto');
const { existsSync, readFileSync, readdirSync } = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const json = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const sha256 = (file) =>
  createHash('sha256')
    .update(readFileSync(path.join(root, file)))
    .digest('hex');
const checkArchive = (directory, entry) => {
  assert.equal(path.basename(entry.archive), entry.archive);
  const file = `${directory}/${entry.archive}`;
  assert.equal(sha256(file), entry.sha256, `Source checksum mismatch: ${file}`);
};

checkArchive('third_party', json('third_party/kos-1.6.0.1-inputs.json'));
const lock = json(
  existsSync(path.join(root, 'package-lock.json'))
    ? 'package-lock.json'
    : 'npm-shrinkwrap.json',
);
const sources = json('third_party/npm/sources.json');
const covered = new Map();
for (const archive of sources.archives) {
  checkArchive('third_party/npm', archive);
  for (const pkg of archive.packages) {
    const key = `${pkg.name}@${pkg.version}`;
    assert(!covered.has(key), `Duplicate source entry: ${key}`);
    covered.set(key, pkg);
  }
}
let dependencies = 0;
for (const [directory, pkg] of Object.entries(lock.packages)) {
  if (!directory || pkg.dev || pkg.devOptional) continue;
  const name = directory.slice(directory.lastIndexOf('node_modules/') + 13);
  const key = `${name}@${pkg.version}`;
  const source = covered.get(key);
  assert(source, `Missing editable dependency source: ${key}`);
  assert.equal(source.npmIntegrity, pkg.integrity, `Stale npm source: ${key}`);
  if (pkg.license) assert.equal(source.license, pkg.license);
  dependencies++;
}
assert.equal(dependencies, covered.size, 'Unused or stale dependency sources');

const fixtures = json('docs/fixture-provenance.json');
for (const fixture of fixtures.files) {
  assert.equal(
    sha256(fixture.path),
    fixture.sha256,
    `Fixture changed; review provenance: ${fixture.path}`,
  );
}
const filesUnder = (directory) =>
  readdirSync(path.join(root, directory), { withFileTypes: true }).flatMap(
    (entry) => {
      const file = `${directory}/${entry.name}`;
      return entry.isDirectory() ? filesUnder(file) : [file];
    },
  );
assert.deepEqual(
  filesUnder('test/fixtures').sort(),
  fixtures.files.map((fixture) => fixture.path).sort(),
  'Update the fixture inventory for additions/removals',
);
console.log(
  `Verified kOS inputs, ${dependencies} runtime dependency sources and ${fixtures.files.length} fixtures.`,
);
