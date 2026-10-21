#!/usr/bin/env node
// npm always excludes root package-lock.json. Ship the exact canonical
// lock as npm-shrinkwrap.json instead, so extracted sources support npm ci.
const { copyFileSync, existsSync } = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const lock = path.join(root, 'package-lock.json');
const shrinkwrap = path.join(root, 'npm-shrinkwrap.json');
if (existsSync(lock)) {
  copyFileSync(lock, shrinkwrap);
} else if (!existsSync(shrinkwrap)) {
  throw new Error('Source packaging requires a dependency lockfile');
}
// An unpacked package already has its canonical lock as npm-shrinkwrap.json.
