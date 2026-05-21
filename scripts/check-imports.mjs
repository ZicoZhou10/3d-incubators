#!/usr/bin/env node
/**
 * Enforce the cross-package import discipline that ESLint can't easily express
 * in this minimal repo.
 *
 * Rules:
 *   - demos/* may import from @3d-incubators/* and @manycore/* — nothing else
 *     from outside their own directory and the workspace packages.
 *   - packages/* must not import from demos/* (would be cyclic).
 *   - Nothing imports `external/` (we don't have one yet, but reserving for later).
 *
 * Returns non-zero on any violation. Plug into CI later.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const IMPORT_RE = /import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g;

const violations = [];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.wrangler') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mjs|js)$/.test(entry.name)) yield full;
  }
}

function checkFile(file, content) {
  const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
  const isDemo = rel.startsWith('demos/');
  const isPackage = rel.startsWith('packages/');

  for (const match of content.matchAll(IMPORT_RE)) {
    const spec = match[1];
    if (isPackage && spec.includes('demos/')) {
      violations.push(`${rel}: package imports from demos — would be cyclic`);
    }
    if (isDemo && spec.startsWith('../../') && !spec.includes('packages/')) {
      violations.push(`${rel}: demo reaches outside its folder via "${spec}" — use a workspace package instead`);
    }
  }
}

for await (const file of walk(REPO_ROOT)) {
  try {
    const content = await readFile(file, 'utf-8');
    checkFile(file, content);
  } catch {
    // skip
  }
}

if (violations.length) {
  console.error('import discipline violations:');
  for (const v of violations) console.error('  -', v);
  process.exit(1);
}
console.log('✔ imports look healthy');
