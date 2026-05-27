/* Browser-direct Anthropic call for variant generation.
 *
 * Three deliberately different layouts per roll — this is the "card draw"
 * mechanism that lets the user steer toward the composition they want
 * without writing 3D-vocabulary prompts.
 */

import type { Catalog, Pack } from './library.js';
import { findPack, uniformScale } from './library.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

export interface Placement {
  componentId: string;
  position: [number, number, number];
  rotation: [number, number, number];
  rationale: string;
}

export interface VariantLayout {
  name: string;
  narrative: string;
  packId: string;
  components: Placement[];
  camera: {
    position: [number, number, number];
    target: [number, number, number];
  };
}

export interface VariantSet {
  brief: string;
  packId: string;
  variants: VariantLayout[];
}

export interface RollOptions {
  apiKey: string;
  brief: string;
  catalog: Catalog;
  packId: string;
  /** Components the user pinned as must-have. */
  pinned: string[];
  /** Optional carry from previous roll: avoid these layouts. */
  previousVariantNames?: string[];
  /** abort signal */
  signal?: AbortSignal;
}

export async function generateVariants(opts: RollOptions): Promise<VariantSet> {
  const pack = findPack(opts.catalog, opts.packId);
  if (!pack) throw new Error(`unknown pack: ${opts.packId}`);

  const systemPrompt = buildSystemPrompt(pack);
  const userPrompt = buildUserPrompt(opts.brief, pack, opts.pinned, opts.previousVariantNames);

  const body = {
    model: MODEL,
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  };

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Anthropic ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { content: Array<{ type: string; text: string }> };
  const text = json.content.find((c) => c.type === 'text')?.text ?? '';

  return parseVariantResponse(text, pack, opts.brief);
}

function buildSystemPrompt(pack: Pack): string {
  return [
    'You are a layout director for 3D game scenes. You compose small "diorama" scenes',
    'from a fixed library of pre-generated 3D components.',
    '',
    'For every user brief, return EXACTLY THREE variants — three deliberately DIFFERENT',
    'compositions of the same component library, each emphasising a different reading of',
    'the brief. Think of it like Midjourney\'s 4-image grid: the user picks the one that',
    'matches what they had in mind.',
    '',
    'Hard rules:',
    '- World axis: Y-up. Floor at Y=0. All components rest on the floor (their local',
    '  origins sit at the bottom of their bounding box).',
    '- Components are referenced by `componentId`. Use ONLY ids from the library below.',
    '- Each variant can include a subset of the library (3–6 components feels right).',
    '- Position is in metres, applied directly (no scaling on your side — scale is',
    '  derived from realHeight on ours).',
    '- Rotation is in radians, Euler XYZ.',
    '- Keep things grounded in reality: humans need walking space, lamps don\'t levitate,',
    '  monitors face the seat, etc.',
    '',
    `Library — pack "${pack.id}" (${pack.label}):`,
    JSON.stringify(
      pack.components.map((c) => ({
        id: c.id,
        category: c.category,
        realHeight_m: c.realHeight,
        footprint_m: [Number(c.bbox.size[0].toFixed(2)), Number(c.bbox.size[2].toFixed(2))],
        prompt: c.prompt,
      })),
      null,
      2
    ),
    '',
    'Camera: position and target in world metres. Aim for a 3/4 hero shot that frames',
    'the whole scene; eye height ~1.4 m; distance ~3–4 m from scene centre.',
    '',
    'Output: a single JSON object, no prose, no markdown fences. Schema:',
    JSON.stringify({
      variants: [
        {
          name: 'string — short, evocative (e.g. "Hacker corner")',
          narrative: 'string — one sentence on the mood / staging',
          components: [
            {
              componentId: 'string',
              position: [0, 0, 0],
              rotation: [0, 0, 0],
              rationale: 'string — one short clause',
            },
          ],
          camera: { position: [0, 0, 0], target: [0, 0, 0] },
        },
      ],
    }),
  ].join('\n');
}

function buildUserPrompt(
  brief: string,
  pack: Pack,
  pinned: string[],
  previousVariantNames?: string[]
): string {
  const parts: string[] = [];
  parts.push(`Brief: ${brief}`);
  if (pinned.length > 0) {
    parts.push(`Must include: ${pinned.join(', ')}`);
  }
  if (previousVariantNames && previousVariantNames.length > 0) {
    parts.push(
      `Avoid these compositions from a previous roll (give me something different): ` +
        previousVariantNames.join(', ')
    );
  }
  parts.push(`Compose 3 variants from the "${pack.id}" pack. Return JSON only.`);
  return parts.join('\n\n');
}

function parseVariantResponse(text: string, pack: Pack, brief: string): VariantSet {
  // Tolerate fenced code blocks.
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  let raw: unknown;
  try {
    raw = JSON.parse(stripped);
  } catch (err) {
    throw new Error(`LLM did not return JSON: ${(err as Error).message}; got: ${text.slice(0, 200)}`);
  }
  const obj = raw as { variants?: unknown };
  const variantsRaw = obj.variants;
  if (!Array.isArray(variantsRaw)) {
    throw new Error('Response missing variants[]');
  }
  const variants = variantsRaw.map((v: unknown, i: number) => coerceVariant(v, pack, i));
  return { brief, packId: pack.id, variants };
}

function coerceVariant(v: unknown, pack: Pack, index: number): VariantLayout {
  const vv = v as Record<string, unknown>;
  const name = String(vv.name ?? `Variant ${index + 1}`);
  const narrative = String(vv.narrative ?? '');
  const compsRaw = vv.components;
  if (!Array.isArray(compsRaw)) throw new Error(`variant ${index}: components not array`);

  const components: Placement[] = compsRaw
    .map((c: unknown) => coercePlacement(c, pack))
    .filter((c): c is Placement => c !== null);

  if (components.length === 0) {
    throw new Error(`variant ${index} (${name}): no valid components`);
  }

  const camera = coerceCamera(vv.camera);
  return { name, narrative, packId: pack.id, components, camera };
}

function coercePlacement(c: unknown, pack: Pack): Placement | null {
  if (typeof c !== 'object' || c === null) return null;
  const cc = c as Record<string, unknown>;
  const id = String(cc.componentId ?? '');
  if (!pack.components.some((p) => p.id === id)) return null;
  return {
    componentId: id,
    position: coerceVec3(cc.position, [0, 0, 0]),
    rotation: coerceVec3(cc.rotation, [0, 0, 0]),
    rationale: String(cc.rationale ?? ''),
  };
}

function coerceCamera(c: unknown): VariantLayout['camera'] {
  const def = { position: [2.5, 1.4, 3] as [number, number, number], target: [0, 0.5, 0] as [number, number, number] };
  if (typeof c !== 'object' || c === null) return def;
  const cc = c as Record<string, unknown>;
  return {
    position: coerceVec3(cc.position, def.position),
    target: coerceVec3(cc.target, def.target),
  };
}

function coerceVec3(v: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(v) || v.length < 3) return fallback;
  return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
}

export { uniformScale };
