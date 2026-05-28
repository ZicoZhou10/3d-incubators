/* Local layout engine — the no-API-key path.
 *
 * Produces the same VariantSet shape the LLM path does, but composes scenes
 * with hand-designed arrangement archetypes + category-role placement rules
 * instead of a model call. It honours pinned must-haves and varies on each
 * roll, so the UX (3 distinct cards → pick → 3D → swap → re-roll) is identical.
 *
 * Trade-off vs the LLM path: it can't read the free-text "refine" box, and the
 * arrangements are templated rather than reasoned. It's a graceful fallback,
 * not a replacement — when an API key is set, main.ts uses the LLM instead.
 */

import type { Catalog, Component, Pack, Category, RoomManifest, WallId } from './library.js';
import { findPack } from './library.js';
import type { Placement, VariantLayout, VariantSet } from './llm.js';

type Role = 'focal' | 'tall' | 'support' | 'accent';

function roleOf(cat: Category): Role {
  switch (cat) {
    case 'seat':
    case 'work':
      return 'focal';
    case 'light':
      return 'tall';
    case 'surface':
      return 'support';
    case 'decor':
    default:
      return 'accent';
  }
}

interface SlotDef {
  pos: [number, number, number];
  rotY: number;
  onSupport?: boolean;
}

interface Archetype {
  name: string;
  blurb: (vibe: string) => string;
  focal: SlotDef;
  tall: SlotDef;
  support: SlotDef;
  accents: SlotDef[];
  camera: { position: [number, number, number]; target: [number, number, number] };
}

const ARCHETYPES: Archetype[] = [
  {
    name: 'Corner setup',
    blurb: (v) => `An L-shaped ${v} corner — the anchor turned into the room, height behind it.`,
    focal: { pos: [0, 0, 0.1], rotY: 0.5 },
    tall: { pos: [-0.85, 0, -0.6], rotY: 0.2 },
    support: { pos: [0.75, 0, 0.45], rotY: -0.3 },
    accents: [
      { pos: [-0.8, 0, 0.7], rotY: 0.8 },
      { pos: [0.65, 0, -0.55], rotY: -0.6, onSupport: true },
    ],
    camera: { position: [2.4, 1.5, 2.7], target: [0, 0.5, 0.1] },
  },
  {
    name: 'Open lineup',
    blurb: (v) => `Everything in a ${v} row facing you — nothing hidden, good for a hero shot.`,
    focal: { pos: [0, 0, 0], rotY: 0 },
    tall: { pos: [-1.25, 0, -0.15], rotY: 0.15 },
    support: { pos: [1.2, 0, 0], rotY: 0 },
    accents: [
      { pos: [0.55, 0, 0.5], rotY: 0.4 },
      { pos: [-0.55, 0, 0.5], rotY: -0.4 },
    ],
    camera: { position: [0, 1.45, 3.3], target: [0, 0.55, 0] },
  },
  {
    name: 'Tight cluster',
    blurb: (v) => `A dense, intimate ${v} huddle — camera pulled in close.`,
    focal: { pos: [0, 0, 0], rotY: 0.6 },
    tall: { pos: [-0.6, 0, -0.55], rotY: 0.3 },
    support: { pos: [0.55, 0, 0.35], rotY: -0.4 },
    accents: [
      { pos: [-0.45, 0, 0.5], rotY: 1.0 },
      { pos: [0.5, 0, -0.5], rotY: -0.7, onSupport: true },
    ],
    camera: { position: [1.7, 1.2, 2.0], target: [0, 0.45, 0.05] },
  },
];

/** Tiny seeded RNG so a roll is reproducible within itself but varies per roll. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface LocalRollOptions {
  brief: string;
  catalog: Catalog;
  packId: string;
  pinned: string[];
  vibe?: string;
  /** Bump to force a different roll. */
  seed?: number;
}

export function generateVariantsLocal(opts: LocalRollOptions): VariantSet {
  const pack = findPack(opts.catalog, opts.packId);
  if (!pack) throw new Error(`unknown pack: ${opts.packId}`);
  const vibe = opts.vibe?.trim() || pack.vibes[0] || 'composed';
  const baseSeed = opts.seed ?? Math.floor(Math.random() * 1e9);

  // Room-aware path: when the pack has a calibrated room, place furniture
  // against its walls and keep the centre clear (a dwelling, not a pile).
  const manifest = pack.environment?.roomManifest;
  if (manifest) {
    return generateVariantsRoomAware(pack, manifest, vibe, opts.brief, opts.pinned, baseSeed);
  }

  const variants: VariantLayout[] = ARCHETYPES.map((arch, i) => {
    const rng = mulberry32(baseSeed + i * 7919);
    const chosen = pickComponents(pack, opts.pinned, rng);
    const components = placeComponents(chosen, arch, rng);
    return {
      name: arch.name,
      narrative: arch.blurb(vibe),
      packId: pack.id,
      components,
      camera: arch.camera,
    };
  });

  return { brief: opts.brief, packId: pack.id, variants };
}

function pickComponents(pack: Pack, pinned: string[], rng: () => number): Component[] {
  const byRole: Record<Role, Component[]> = { focal: [], tall: [], support: [], accent: [] };
  for (const c of pack.components) byRole[roleOf(c.category)].push(c);

  const chosen = new Map<string, Component>();
  const add = (c?: Component): void => {
    if (c && !chosen.has(c.id)) chosen.set(c.id, c);
  };
  const pickOne = (pool: Component[]): Component | undefined => {
    const free = pool.filter((c) => !chosen.has(c.id));
    return free.length ? free[Math.floor(rng() * free.length)] : undefined;
  };

  // 1. Pinned must-haves always in.
  for (const id of pinned) add(pack.components.find((c) => c.id === id));

  // 2. Guarantee an anchor.
  if (![...chosen.values()].some((c) => roleOf(c.category) === 'focal')) add(pickOne(byRole.focal));
  // 3. Guarantee some height.
  if (![...chosen.values()].some((c) => roleOf(c.category) === 'tall')) add(pickOne(byRole.tall));
  // 4. A surface, sometimes (or always if a small accent wants a perch).
  if (![...chosen.values()].some((c) => roleOf(c.category) === 'support') && rng() > 0.35) {
    add(pickOne(byRole.support));
  }
  // 5. One or two accents.
  const accentTarget = 1 + (rng() > 0.5 ? 1 : 0);
  let accents = [...chosen.values()].filter((c) => roleOf(c.category) === 'accent').length;
  while (accents < accentTarget) {
    const a = pickOne(byRole.accent);
    if (!a) break;
    add(a);
    accents++;
  }

  // Cap at 5, but never drop a pinned item.
  const ordered = [...chosen.values()];
  if (ordered.length <= 5) return ordered;
  const pinnedSet = new Set(pinned);
  const keep = ordered.filter((c) => pinnedSet.has(c.id));
  for (const c of ordered) {
    if (keep.length >= 5) break;
    if (!pinnedSet.has(c.id)) keep.push(c);
  }
  return keep;
}

function placeComponents(
  selected: Component[],
  arch: Archetype,
  rng: () => number
): Placement[] {
  const jitter = (): number => (rng() - 0.5) * 0.12;

  // Bucket selected by role.
  const buckets: Record<Role, Component[]> = { focal: [], tall: [], support: [], accent: [] };
  for (const c of selected) buckets[roleOf(c.category)].push(c);

  const placements: Placement[] = [];
  let support: { comp: Component; topY: number; x: number; z: number } | undefined;
  let overflow = 0;

  const emit = (comp: Component, slot: SlotDef, rationale: string): void => {
    let [x, y, z] = slot.pos;
    if (slot.onSupport && support) {
      x = support.x;
      z = support.z;
      y = support.topY;
    } else {
      x += jitter();
      z += jitter();
    }
    placements.push({
      componentId: comp.id,
      position: [round(x), round(y), round(z)],
      rotation: [0, round(slot.rotY + (rng() - 0.5) * 0.15), 0],
      rationale,
    });
  };

  // Support first so accents can sit on it.
  const sup = buckets.support[0];
  if (sup) {
    const x = arch.support.pos[0] + jitter();
    const z = arch.support.pos[2] + jitter();
    support = { comp: sup, topY: sup.realHeight, x, z };
    placements.push({
      componentId: sup.id,
      position: [round(x), 0, round(z)],
      rotation: [0, round(arch.support.rotY + (rng() - 0.5) * 0.15), 0],
      rationale: 'Beside the anchor, within easy reach.',
    });
  }

  const focal = buckets.focal[0];
  if (focal) emit(focal, arch.focal, 'Anchor of the scene, turned to give the composition depth.');

  const tall = buckets.tall[0];
  if (tall) emit(tall, arch.tall, 'Set behind to give the scene height and wash it with light.');

  // Accents fill the archetype's accent slots; small ones perch on the support.
  let accentSlot = 0;
  for (const a of buckets.accent) {
    const slot = arch.accents[accentSlot] ?? fallbackSlot(overflow++);
    const small = a.realHeight < 0.3;
    const useSlot = slot.onSupport && (!support || !small) ? { ...slot, onSupport: false } : slot;
    const rationale = useSlot.onSupport && support
      ? `Resting on the ${support.comp.label.toLowerCase()}.`
      : 'Dropped into the scene to fill the floor and add story.';
    emit(a, useSlot, rationale);
    accentSlot++;
  }

  // Any extra focal/tall items (e.g. two work pieces) ring out around the anchor.
  for (const c of [...buckets.focal.slice(1), ...buckets.tall.slice(1)]) {
    emit(c, fallbackSlot(overflow++), 'Placed off to the side so the anchor stays the focus.');
  }

  return placements;
}

function fallbackSlot(i: number): SlotDef {
  const angle = 0.8 + i * 1.3;
  const r = 1.15 + i * 0.15;
  return { pos: [Math.cos(angle) * r, 0, Math.sin(angle) * r], rotY: -angle };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// =========================================================================
// Room-aware layout — place furniture against walls, keep the centre clear.
// =========================================================================

interface WallGeom {
  /** Inward normal (unit, x/z). */
  nx: number;
  nz: number;
  /** A point `margin` in from the wall, at parameter t∈[0,1] along the wall. */
  point: (t: number, inset: number) => [number, number];
  /** rotationY so a +Z-front model faces into the room. */
  facing: number;
}

function wallGeom(wall: WallId, f: RoomManifest['floor'], margin: number): WallGeom {
  const facing = (nx: number, nz: number): number => Math.atan2(nx, nz);
  switch (wall) {
    case 'xMin':
      return {
        nx: 1, nz: 0,
        point: (t, inset) => [f.xMin + inset, lerp(f.zMin + margin, f.zMax - margin, t)],
        facing: facing(1, 0),
      };
    case 'xMax':
      return {
        nx: -1, nz: 0,
        point: (t, inset) => [f.xMax - inset, lerp(f.zMin + margin, f.zMax - margin, t)],
        facing: facing(-1, 0),
      };
    case 'zMin':
      return {
        nx: 0, nz: 1,
        point: (t, inset) => [lerp(f.xMin + margin, f.xMax - margin, t), f.zMin + inset],
        facing: facing(0, 1),
      };
    case 'zMax':
    default:
      return {
        nx: 0, nz: -1,
        point: (t, inset) => [lerp(f.xMin + margin, f.xMax - margin, t), f.zMax - inset],
        facing: facing(0, -1),
      };
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Four floor corners, inset by margin, each facing the room centre. */
function corners(f: RoomManifest['floor'], margin: number): Array<{ x: number; z: number; facing: number }> {
  const cx = (f.xMin + f.xMax) / 2;
  const cz = (f.zMin + f.zMax) / 2;
  const pts = [
    [f.xMin + margin, f.zMin + margin],
    [f.xMax - margin, f.zMin + margin],
    [f.xMax - margin, f.zMax - margin],
    [f.xMin + margin, f.zMax - margin],
  ];
  return pts.map(([x, z]) => ({ x, z, facing: Math.atan2(cx - x, cz - z) }));
}

interface RoomCast {
  desk?: Component;
  work: Component[]; // monitors, server — go on/beside the desk
  chair?: Component; // smaller seat — at the desk
  sofa?: Component; // larger seat — at the lounge wall
  lamp?: Component; // tall light — a corner
  decor: Component[]; // everything else — corners, walls, on surfaces
}

function castForRoom(pack: Pack): RoomCast {
  const byId = (id: string): Component | undefined => pack.components.find((c) => c.id === id);
  const seats = pack.components.filter((c) => c.category === 'seat');
  // Larger-footprint seat = sofa, smaller = chair.
  seats.sort((a, b) => footprint(b) - footprint(a));
  const sofa = byId('sofa') ?? (seats.length > 1 ? seats[0] : undefined);
  const chair = byId('office_chair') ?? seats.find((s) => s.id !== sofa?.id);
  const desk = byId('desk') ?? pack.components.find((c) => c.category === 'surface' && c.realHeight >= 0.6);
  const work = pack.components.filter((c) => c.category === 'work');
  const used = new Set<string>(
    [desk?.id, chair?.id, sofa?.id, ...work.map((w) => w.id)].filter(Boolean) as string[]
  );
  const lamp = pack.components.find((c) => c.category === 'light');
  if (lamp) used.add(lamp.id);
  const decor = pack.components.filter((c) => !used.has(c.id));
  return { desk, work, chair, sofa, lamp, decor };
}

function footprint(c: Component): number {
  return c.bbox.size[0] * c.bbox.size[2];
}

const ROOM_VARIANTS = [
  { name: 'Work nook', blurb: (v: string) => `A ${v} corner built around the desk — monitors up, chair tucked in, the rest framing it.` },
  { name: 'Lived-in loft', blurb: (v: string) => `A ${v} studio that looks slept-in — lounge anchored, clutter where a person would drop it.` },
  { name: 'Hacker den', blurb: (v: string) => `Dense ${v} den — every surface used, gear and junk layered the way they accrue.` },
];

function generateVariantsRoomAware(
  pack: Pack,
  manifest: RoomManifest,
  vibe: string,
  brief: string,
  pinned: string[],
  baseSeed: number
): VariantSet {
  const cam = pack.environment!.camera;
  const variants: VariantLayout[] = ROOM_VARIANTS.map((rv, i) => ({
    name: rv.name,
    narrative: rv.blurb(vibe),
    packId: pack.id,
    components: composeRoom(pack, manifest, mulberry32(baseSeed + i * 7919), i, pinned),
    camera: { position: cam.position, target: cam.target },
  }));
  return { brief, packId: pack.id, variants };
}

function composeRoom(
  pack: Pack,
  manifest: RoomManifest,
  rng: () => number,
  variantIndex: number,
  pinned: string[]
): Placement[] {
  const m = manifest.margin ?? 0.35;
  const cast = castForRoom(pack);
  const placements: Placement[] = [];
  const jit = (): number => (rng() - 0.5) * 0.1;
  const place = (
    comp: Component | undefined,
    x: number,
    y: number,
    z: number,
    facing: number,
    rationale: string
  ): void => {
    if (!comp) return;
    placements.push({
      componentId: comp.id,
      position: [round(x + (y === 0 ? jit() : 0)), round(y), round(z + (y === 0 ? jit() : 0))],
      rotation: [0, round(facing + (rng() - 0.5) * 0.12), 0],
      rationale,
    });
  };

  const deskWall = wallGeom(manifest.deskWall, manifest.floor, m);
  const loungeWall = wallGeom(manifest.loungeWall, manifest.floor, m);
  const cs = corners(manifest.floor, m + 0.05);

  // --- Desk against its wall (centred), monitors on top, server beside, chair in front.
  let deskTopY = 0;
  if (cast.desk) {
    const [dx, dz] = deskWall.point(0.5, (cast.desk.bbox.size[2] / 2) * (cast.desk.realHeight / cast.desk.bbox.size[1]) + 0.05);
    deskTopY = cast.desk.realHeight;
    place(cast.desk, dx, 0, dz, deskWall.facing, 'Desk against the wall — the anchor everything else reads off.');
    // work items: first on the desk, extra beside on the floor.
    cast.work.forEach((w, wi) => {
      if (wi === 0) {
        place(w, dx - deskWall.nz * 0.12, deskTopY, dz - deskWall.nx * 0.12, deskWall.facing, 'On the desk, facing the seat.');
      } else {
        const side = deskWall.point(0.5 + 0.28 * (wi % 2 === 0 ? 1 : -1), 0.3);
        place(w, side[0], 0, side[1], deskWall.facing, 'Beside the desk on the floor.');
      }
    });
    // chair in front of the desk, facing it.
    place(cast.chair, dx + deskWall.nx * 0.75, 0, dz + deskWall.nz * 0.75, deskWall.facing + Math.PI, 'Pulled up to the desk.');
  } else {
    // No desk: work items go along the desk wall on the floor.
    cast.work.forEach((w, wi) => {
      const p = deskWall.point(0.4 + 0.2 * wi, 0.3);
      place(w, p[0], 0, p[1], deskWall.facing, 'Set against the wall.');
    });
    place(cast.chair, ...spread(deskWall.point(0.5, 0.9)), deskWall.facing + Math.PI, 'A place to sit.');
  }

  // --- Sofa / lounge against the lounge wall.
  // Rotate +90° so the sofa's long axis runs ALONG the wall (its native long
  // axis is local Z); then only its short side projects into the room, so it
  // sits against the wall instead of jutting into the centre.
  if (cast.sofa) {
    const sofaScale = cast.sofa.realHeight / cast.sofa.bbox.size[1];
    const intoRoomHalf = (cast.sofa.bbox.size[0] / 2) * sofaScale; // short side after +90°
    const inset = Math.min(intoRoomHalf + 0.1, 0.55);
    const [sx, sz] = loungeWall.point(0.5, inset);
    place(cast.sofa, sx, 0, sz, loungeWall.facing + Math.PI / 2, 'Lounge against the far wall — the room\'s soft corner.');
  }

  // --- Lamp in a corner near the desk wall.
  const lampCorner = cs[(variantIndex + 0) % cs.length]!;
  place(cast.lamp, lampCorner.x, 0, lampCorner.z, lampCorner.facing, 'Tall light in the corner to wash the wall.');

  // --- Decor: a small room reads as a pile if over-filled. Cap how many we
  // drop in, scaling up across the three variants (nook → loft → den).
  const decorCap = [2, 3, 4][variantIndex] ?? 2;
  const decor = [...cast.decor];
  shuffle(decor, rng);
  const decorCorners = cs.filter((_, ci) => ci !== (variantIndex + 0) % cs.length);
  let ci = 0;
  let placedDecor = 0;
  for (const d of decor) {
    if (placedDecor >= decorCap) break;
    const small = d.realHeight < 0.3;
    if (small && cast.desk && rng() > 0.4) {
      const [dx, dz] = deskWall.point(0.5 + (rng() - 0.5) * 0.4, 0.25);
      place(d, dx, deskTopY, dz, deskWall.facing, 'Left on the desk.');
    } else {
      const corner = decorCorners[ci % decorCorners.length]!;
      ci++;
      place(d, corner.x + jit(), 0, corner.z + jit(), corner.facing + (rng() - 0.5) * 0.6, 'Settled into a corner where it would naturally land.');
    }
    placedDecor++;
  }

  // Ensure any pinned must-haves are present (room recipe already includes most).
  for (const id of pinned) {
    if (!placements.some((p) => p.componentId === id)) {
      const comp = pack.components.find((c) => c.id === id);
      const corner = cs[placements.length % cs.length]!;
      place(comp, corner.x, 0, corner.z, corner.facing, 'Pinned must-have.');
    }
  }

  return placements;
}

function spread(p: [number, number]): [number, number, number] {
  return [p[0], 0, p[1]];
}

function shuffle<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
}
