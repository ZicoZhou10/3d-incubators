#!/usr/bin/env node
/**
 * Smoke test: exercise the World Generation API end-to-end via the SDK.
 *
 *   - POST a tiny prompt
 *   - Poll until terminal
 *   - Report status, timing, and resulting asset URLs
 *
 * Why this script exists separately from the demo:
 *   - The demo proves the *UI path*. This proves the *SDK path*.
 *   - If this fails but the demo passes, the bug is in our edge proxy.
 *   - If this passes but the demo fails, the bug is in the browser glue.
 *   - Either way, isolating the layer is faster than debugging the whole stack.
 */

import { createGeneration, pollWorld } from '../packages/aholo-client/src/index.ts';

const apiKey = process.env.AHOLO_API_KEY;
const baseUrl = process.env.AHOLO_BASE_URL ?? 'https://api.aholo3d.com';

if (!apiKey) {
  console.error('Set AHOLO_API_KEY in your env, e.g. via `set-env.cmd` or shell export.');
  process.exit(2);
}

const prompt = process.argv[2] ?? 'A sunlit nordic living room with a wooden floor and a single armchair by the window.';

console.log(`→ POST  ${baseUrl}/global/world/v1/generations`);
console.log(`  prompt: "${prompt}"`);

const t0 = Date.now();
const cfg = { baseUrl, apiKey };

const op = await createGeneration(cfg, { prompt });
console.log(`  worldId: ${op.worldId}  (submit took ${Date.now() - t0}ms)`);

console.log('→ polling…');
const detail = await pollWorld(cfg, op.worldId, {
  initialIntervalMs: 4000,
  maxIntervalMs: 20000,
  timeoutMs: 15 * 60 * 1000,
  onTick: (n, v) => {
    const s = v?.status ?? 'unknown';
    console.log(`  [${n}] ${s}  (+${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  },
});

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log('');
console.log(`✔ done in ${elapsed}s`);
console.log(`  status: ${detail.status}`);
if (detail.assets?.splats?.urls) {
  console.log('  asset URLs:');
  for (const [k, v] of Object.entries(detail.assets.splats.urls)) {
    if (v) console.log(`    ${k}: ${v}`);
  }
} else {
  console.log('  (no asset URLs in response)');
  console.log('  full detail:', JSON.stringify(detail, null, 2));
}
