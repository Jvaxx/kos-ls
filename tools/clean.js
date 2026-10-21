#!/usr/bin/env node
// Remove only known disposable outputs at the repository root, never
// nested fixtures, versioned data or installed dependencies.
const { existsSync, readdirSync, rmSync } = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const outputs = [
  'out',
  'dist',
  'coverage',
  // In a checkout this is generated, but in an unpacked npm package it
  // is the only lockfile and must survive cleanup.
  ...(existsSync(path.join(root, 'package-lock.json'))
    ? ['npm-shrinkwrap.json']
    : []),
  'junit.xml',
  'TEST.xml',
  ...readdirSync(root).filter((name) =>
    /^(benchmark\.data\.[^/]+|[^/]+\.(profile\.(json|html)|cpuprofile))$/.test(
      name,
    ),
  ),
];

for (const output of outputs) {
  rmSync(path.join(root, output), { recursive: true, force: true });
}
