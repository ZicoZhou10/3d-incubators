/**
 * Vignette manifest schema + the registry of curated vignettes.
 *
 * Each vignette declares:
 *   - a short brief (the agent-facing intent)
 *   - the components an agent decomposed it into
 *   - per-component prompts (kept as provenance — the prompts fed to Lux3D)
 *   - a path to a layout.json file that lives next to the component GLBs.
 *     That layout.json is produced by an LLM auto-layout step
 *     (`scripts/layout-vignette.mjs`), and it's the source of truth for
 *     per-component transforms + camera framing. The page loads it at
 *     runtime; this file only contains *non-spatial* metadata.
 *
 * Adding a vignette: see demos/vignette/README.md.
 */

export interface VignetteComponent {
  /** Slot label, matches a layout.json entry + the GLB filename stem. */
  slot: string;
  /** The text prompt fed to aholo_generate_model_from_text (provenance only). */
  prompt: string;
  /** The Lux3D style enum value used (provenance only). */
  style: string;
  /** Path under /public the GLB is served from. */
  file: string;
}

export interface Vignette {
  id: string;
  label: string;
  brief: string;
  /**
   * URL the layout.json sits at (LLM auto-layout output). The page fetches
   * this at vignette-select time and uses its transforms + camera framing.
   */
  layoutUrl: string;
  components: VignetteComponent[];
}

/** Shape the page expects after fetching a vignette's layout.json. */
export interface VignetteLayout {
  components: Array<{
    slot: string;
    scale: number;
    position: [number, number, number];
    rotation: [number, number, number];
    rationale?: string;
  }>;
  camera?: {
    position: [number, number, number];
    target: [number, number, number];
    rationale?: string;
  };
}

export const VIGNETTES: Vignette[] = [
  {
    id: 'cozy-reading-corner',
    label: 'Cozy reading corner',
    brief:
      'A small reading corner with a comfortable mid-century armchair, a tall ' +
      'brass floor lamp, a small leather footstool, and a stack of three ' +
      'hardcover books on the floor next to the chair.',
    layoutUrl: '/scenes/cozy-reading-corner/layout.json',
    components: [
      {
        slot: 'armchair',
        prompt:
          'a comfortable mid-century modern armchair, warm tan leather upholstery, dark walnut wood frame and tapered legs',
        style: 'photorealistic',
        file: '/scenes/cozy-reading-corner/armchair.glb',
      },
      {
        slot: 'floor_lamp',
        prompt: 'a tall slim brass floor lamp with a cream fabric drum shade, vintage style',
        style: 'photorealistic',
        file: '/scenes/cozy-reading-corner/floor_lamp.glb',
      },
      {
        slot: 'ottoman',
        prompt: 'a small round leather footstool with short wooden legs',
        style: 'photorealistic',
        file: '/scenes/cozy-reading-corner/ottoman.glb',
      },
      {
        slot: 'book_stack',
        prompt:
          'a small stack of three hardcover books, weathered red and forest-green and cream covers, gold lettering on spines',
        style: 'photorealistic',
        file: '/scenes/cozy-reading-corner/book_stack.glb',
      },
    ],
  },
];
