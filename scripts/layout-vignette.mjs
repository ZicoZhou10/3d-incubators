#!/usr/bin/env node
/**
 * Vignette auto-layout via Claude — replaces hand-curated transforms.
 *
 * Reads:
 *   demos/vignette/public/scenes/<slug>/*.glb.bbox.json
 *   the vignette's brief + per-component prompt list (from a brief JSON)
 *
 * Calls Claude with: brief, per-component { slot, prompt, bbox.size, bbox.center },
 * plus a system prompt that pins down the conventions (Y-up, Y=0 floor, models
 * already floor-aligned in local space, real-world height hints).
 *
 * Writes:
 *   <scene>/layout.json — { components: [{ slot, position, rotation, scale }] }
 *
 * The vignette demo can then either inline these into vignettes.ts (one-time)
 * or load layout.json at runtime.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... node scripts/layout-vignette.mjs \
 *     demos/vignette/public/scenes/cozy-reading-corner \
 *     "<brief>" \
 *     <slot>:"<prompt>" <slot>:"<prompt>" ...
 *
 * Example:
 *   node scripts/layout-vignette.mjs \
 *     demos/vignette/public/scenes/cozy-reading-corner \
 *     "A small reading corner with an armchair, a floor lamp, an ottoman, and a stack of books." \
 *     armchair:"a comfortable mid-century modern armchair" \
 *     floor_lamp:"a tall slim brass floor lamp" \
 *     ottoman:"a small round leather footstool" \
 *     book_stack:"a stack of three hardcover books"
 *
 * The Anthropic SDK is loaded dynamically so this script can be inspected and
 * its prompt iterated on without a forced install. Install with:
 *   pnpm add -w @anthropic-ai/sdk
 * (or `npm i @anthropic-ai/sdk` in any node_modules-resolvable scope).
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join, basename } from 'node:path';
import process from 'node:process';

const REAL_WORLD_HEIGHT_HINTS = `Real-world heights to use when picking a uniform scale per component
(these are typical; adjust if the brief implies otherwise):
  - armchair                ~0.85 m
  - dining chair / side chair ~0.85 m
  - sofa                    ~0.85 m
  - ottoman / footstool     ~0.45 m
  - coffee table            ~0.40 m
  - side / end table        ~0.55 m
  - desk                    ~0.75 m
  - floor lamp              ~1.55 m
  - table lamp              ~0.45 m
  - book / book stack       0.18 m to 0.30 m
  - vase / object on table  ~0.30 m
  - plant (medium)          ~0.80 m
  - rug                     0.02 m (very flat)
`;

const SYSTEM_PROMPT = `You are a 3D scene layout assistant. You compose a small scene from a set of
generated 3D models so that they read as a coherent vignette.

Conventions you MUST follow:
  - Right-handed coordinate system. Y is UP. Y = 0 is the floor.
  - All input models are already floor-aligned in their LOCAL space:
    each model's bounding-box MIN_Y equals 0 (its bottom touches the local
    origin). So after uniform scaling, the model's bottom is still at Y = 0
    when position.y = 0 — you usually don't need to lift things.
  - The models are not scaled to real-world size. You MUST choose a uniform
    "scale" per component so its scaled bounding-box height matches the
    real-world expectation of that object class.
  - Rotation is Euler XYZ in radians. For furniture, almost always rotate
    about Y only (rotation = [0, theta, 0]). Use small angles (±π/6 or so)
    to give the scene life without it feeling staged.
  - Components must not interpenetrate each other when viewed from the
    default camera. Allow ~0.05–0.10 m of breathing room.
  - For a "reading corner / corner scene" arrangement, the chair is the
    anchor at the origin; lamp goes behind-and-to-one-side; ottoman in
    front of the chair; small props (books, mugs, plants) to the side or
    on a surface.

${REAL_WORLD_HEIGHT_HINTS}

Output: a single JSON object, no prose, schema:
  {
    "components": [
      {
        "slot": "<the slot name>",
        "scale": <number>,
        "position": [x, y, z],
        "rotation": [rx, ry, rz],
        "rationale": "<one short sentence — why this placement>"
      },
      ...
    ],
    "camera": {
      "position": [x, y, z],
      "target":   [x, y, z],
      "rationale": "<why this framing>"
    }
  }
`;

function usage(code = 2) {
  console.error(
    'usage: layout-vignette.mjs <scene-dir> "<brief>" <slot>:"<prompt>" [<slot>:"<prompt>" ...]'
  );
  process.exit(code);
}

async function loadBboxFor(sceneDir, slot) {
  const candidate = join(sceneDir, `${slot}.glb.bbox.json`);
  try {
    return JSON.parse(await readFile(candidate, 'utf-8'));
  } catch {
    throw new Error(`Missing or unreadable bbox sidecar: ${candidate}`);
  }
}

async function main() {
  const [sceneDirRaw, brief, ...rest] = process.argv.slice(2);
  if (!sceneDirRaw || !brief || rest.length === 0) usage();

  const sceneDir = resolve(sceneDirRaw);

  const components = [];
  for (const arg of rest) {
    const m = /^([a-z0-9_]+):(.+)$/i.exec(arg);
    if (!m) {
      console.error(`Bad component arg: ${arg}. Expected "slot:prompt".`);
      process.exit(2);
    }
    const slot = m[1];
    const prompt = m[2].replace(/^"|"$/g, '');
    const bbox = await loadBboxFor(sceneDir, slot);
    components.push({ slot, prompt, bbox });
  }

  // Build the user message.
  const componentBlock = components
    .map((c) => {
      const sz = c.bbox.size.map((n) => +n.toFixed(3)).join(', ');
      const ce = c.bbox.center.map((n) => +n.toFixed(3)).join(', ');
      return `- ${c.slot}: "${c.prompt}"\n  bbox.size  = [${sz}]\n  bbox.center = [${ce}]`;
    })
    .join('\n');

  const userMessage =
    `Brief: ${brief}\n\n` +
    `Components (with bounding-box size + center in their local space, units = raw Lux3D output, NOT meters):\n` +
    componentBlock +
    `\n\nProduce the JSON layout. Reply with JSON only.`;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set. Aborting Claude call.');
    console.error('');
    console.error('=== System prompt ===');
    console.error(SYSTEM_PROMPT);
    console.error('=== User message ===');
    console.error(userMessage);
    process.exit(3);
  }

  // Load the SDK lazily so the file remains inspectable without the dep installed.
  /** @type {typeof import('@anthropic-ai/sdk')} */
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const client = new Anthropic({ apiKey });

  const completion = await client.messages.create({
    model: 'claude-opus-4-7-20260101', // adjust if the model name has rolled
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = completion.content
    .filter((b) => b.type === 'text')
    .map((b) => /** @type {{text: string}} */ (b).text)
    .join('');

  // Strip code fences if Claude wrapped the JSON.
  const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  let layout;
  try {
    layout = JSON.parse(jsonText);
  } catch (e) {
    console.error('Could not parse Claude reply as JSON. Raw text below.');
    console.error(text);
    process.exit(4);
  }

  const outPath = join(sceneDir, 'layout.json');
  await writeFile(outPath, JSON.stringify(layout, null, 2), 'utf-8');
  console.log(`✔ wrote ${outPath}`);
  for (const c of layout.components ?? []) {
    console.log(
      `  ${c.slot}: scale=${c.scale}, pos=[${c.position?.join(', ')}], rot=[${c.rotation?.join(', ')}]`
    );
    if (c.rationale) console.log(`    — ${c.rationale}`);
  }
  if (layout.camera) {
    console.log(`  camera.position=[${layout.camera.position?.join(', ')}], target=[${layout.camera.target?.join(', ')}]`);
    if (layout.camera.rationale) console.log(`    — ${layout.camera.rationale}`);
  }

  // Echo the bare layout JSON last so the script can be piped.
  console.log('');
  console.log(JSON.stringify(layout, null, 2));
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
