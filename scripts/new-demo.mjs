#!/usr/bin/env node
/**
 * Scaffold a new demo from `template/` into `demos/<slug>/`.
 *
 * Usage:
 *   pnpm new-demo my-thing
 *   pnpm new-demo my-thing "One-sentence pitch"
 *
 * What it does:
 *   - Refuses if the destination already exists
 *   - Copies template/ recursively
 *   - Rewrites package.json `name` to `@3d-incubators/demo-<slug>`
 *   - Rewrites README's title and pitch
 *   - Stamps a freshness comment in main.ts
 *
 * Anti-features (intentional):
 *   - Does NOT npm install. Run `pnpm install` at the repo root afterwards.
 *   - Does NOT git add. Review the diff first.
 */

import { readFile, writeFile, mkdir, cp, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const TEMPLATE_DIR = join(REPO_ROOT, 'template');

async function main() {
  const [, , slugRaw, ...pitchParts] = process.argv;
  if (!slugRaw) usage('missing <slug>');

  const slug = slugRaw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    usage(`invalid slug "${slug}". Use lowercase letters, digits, dashes (no leading dash).`);
  }
  const pitch = pitchParts.join(' ').trim() || 'TODO: one-sentence pitch';

  const destDir = join(REPO_ROOT, 'demos', slug);
  if (existsSync(destDir)) {
    bail(`demos/${slug} already exists. Pick another slug or delete it first.`);
  }
  if (!existsSync(TEMPLATE_DIR)) {
    bail(`template/ not found at ${TEMPLATE_DIR}`);
  }

  await mkdir(dirname(destDir), { recursive: true });
  await cp(TEMPLATE_DIR, destDir, {
    recursive: true,
    filter: (src) => {
      // Skip cruft that shouldn't ride along.
      const rel = src.slice(TEMPLATE_DIR.length);
      return !rel.includes('node_modules') && !rel.includes('.wrangler') && !rel.endsWith('.dev.vars');
    },
  });

  // package.json — rename
  const pkgPath = join(destDir, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
  pkg.name = `@3d-incubators/demo-${slug}`;
  pkg.description = pitch;
  pkg.private = true;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

  // wrangler.toml — set project name
  const wranglerPath = join(destDir, 'wrangler.toml');
  if (existsSync(wranglerPath)) {
    let toml = await readFile(wranglerPath, 'utf-8');
    toml = toml.replace(/^name\s*=.*$/m, `name = "incubators-${slug}"`);
    await writeFile(wranglerPath, toml);
  }

  // tsconfig.json — demos sit one level deeper than the template,
  // so the extends path needs an extra `../`.
  const tsconfigPath = join(destDir, 'tsconfig.json');
  if (existsSync(tsconfigPath)) {
    let ts = await readFile(tsconfigPath, 'utf-8');
    ts = ts.replace('"../tsconfig.base.json"', '"../../tsconfig.base.json"');
    await writeFile(tsconfigPath, ts);
  }

  // README — first line title + pitch
  const readmePath = join(destDir, 'README.md');
  if (existsSync(readmePath)) {
    let md = await readFile(readmePath, 'utf-8');
    const title = slug
      .split('-')
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(' ');
    md = `# ${title}\n\n> ${pitch}\n\n` + stripFrontMatter(md);
    await writeFile(readmePath, md);
  }

  // main.ts — pitch comment
  const mainPath = join(destDir, 'src/main.ts');
  if (existsSync(mainPath)) {
    const stamp = `/* ${pitch} — scaffolded ${new Date().toISOString().slice(0, 10)} */\n`;
    const main = await readFile(mainPath, 'utf-8');
    await writeFile(mainPath, stamp + main);
  }

  console.log(`✔ scaffolded demos/${slug}`);
  console.log('');
  console.log('Next:');
  console.log('  1. cp demos/' + slug + '/.dev.vars.example demos/' + slug + '/.dev.vars');
  console.log('     # fill in AHOLO_API_KEY');
  console.log('  2. pnpm install');
  console.log('  3. pnpm --filter @3d-incubators/demo-' + slug + ' dev');
}

function usage(why) {
  console.error(`new-demo: ${why}`);
  console.error('');
  console.error('Usage: pnpm new-demo <slug> [pitch...]');
  console.error('Example: pnpm new-demo prompt-to-space "A sentence becomes a walkable world"');
  process.exit(2);
}

function bail(why) {
  console.error(`new-demo: ${why}`);
  process.exit(1);
}

function stripFrontMatter(md) {
  // Drop the original template's top `# Demo Template` and intro line so we
  // don't double-stack titles.
  const lines = md.split('\n');
  let i = 0;
  if (lines[0]?.startsWith('# ')) i = 1;
  while (i < lines.length && (lines[i].trim() === '' || lines[i].startsWith('>'))) i += 1;
  return lines.slice(i).join('\n').trimStart();
}

await main().catch((e) => {
  console.error(e);
  process.exit(1);
});
