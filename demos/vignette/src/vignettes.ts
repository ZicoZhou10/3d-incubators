/**
 * Vignette manifest schema + the registry of curated vignettes.
 *
 * Each vignette declares:
 *   - a short brief (the agent-facing intent)
 *   - the components an agent decomposed it into
 *   - the per-component prompt/style used to generate it via Lux3D
 *   - per-component placement (position / rotation / scale) so the bundle
 *     of GLBs renders as a coherent scene rather than overlapping at the origin
 *
 * The "agent decomposed" step ran offline (Claude Code driving the Aholo MCP):
 *   1. read the brief
 *   2. enumerate components
 *   3. submit Lux3D text-to-3D for each in parallel
 *   4. download + repack each ZIP into a textured GLB
 *   5. eyeball the resulting models and pick the transform that makes them
 *      sit together in space
 *
 * Adding a vignette: run the same offline flow, drop the GLBs into
 *   `public/scenes/<slug>/<component>.glb`, and add an entry below.
 */

export interface VignetteComponent {
  /** Slot label shown in dev UI. */
  slot: string;
  /** The text prompt fed to aholo_generate_model_from_text. */
  prompt: string;
  /** The Lux3D style enum value used. */
  style: string;
  /** Path under /public the GLB is served from. */
  file: string;
  /** World-space placement. */
  transform: {
    position: [number, number, number];
    /** Euler XYZ in radians. */
    rotation: [number, number, number];
    /** Uniform scale applied to the loaded GLB root. */
    scale: number;
  };
}

export interface Vignette {
  id: string;
  label: string;
  brief: string;
  /** A camera framing tuned to fit the whole scene. */
  camera: {
    position: [number, number, number];
    target: [number, number, number];
  };
  components: VignetteComponent[];
}

export const VIGNETTES: Vignette[] = [
  {
    id: 'cozy-reading-corner',
    label: 'Cozy reading corner',
    brief:
      'A small reading corner with a comfortable mid-century armchair, a tall ' +
      'brass floor lamp, a small leather footstool, and a stack of three ' +
      'hardcover books on the floor next to the chair.',
    camera: {
      position: [2.6, 1.8, 3.4],
      target: [0, 0.7, 0],
    },
    components: [
      {
        slot: 'armchair',
        prompt:
          'a comfortable mid-century modern armchair, warm tan leather upholstery, dark walnut wood frame and tapered legs',
        style: 'photorealistic',
        file: '/scenes/cozy-reading-corner/armchair.glb',
        transform: { position: [0, 0, 0], rotation: [0, Math.PI / 6, 0], scale: 1.6 },
      },
      {
        slot: 'floor_lamp',
        prompt: 'a tall slim brass floor lamp with a cream fabric drum shade, vintage style',
        style: 'photorealistic',
        file: '/scenes/cozy-reading-corner/floor_lamp.glb',
        transform: { position: [1.2, 0, -0.3], rotation: [0, 0, 0], scale: 2.0 },
      },
      {
        slot: 'ottoman',
        prompt: 'a small round leather footstool with short wooden legs',
        style: 'photorealistic',
        file: '/scenes/cozy-reading-corner/ottoman.glb',
        transform: { position: [-0.2, 0, 1.0], rotation: [0, 0, 0], scale: 0.65 },
      },
      {
        slot: 'book_stack',
        prompt:
          'a small stack of three hardcover books, weathered red and forest-green and cream covers, gold lettering on spines',
        style: 'photorealistic',
        file: '/scenes/cozy-reading-corner/book_stack.glb',
        transform: { position: [-1.3, 0, 0.5], rotation: [0, -Math.PI / 8, 0], scale: 0.6 },
      },
    ],
  },
];
