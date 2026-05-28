/* Diorama library — catalog of agent-generated 3D components. */

export interface BBox {
  min: [number, number, number];
  max: [number, number, number];
  size: [number, number, number];
  center: [number, number, number];
}

export type Category = 'seat' | 'light' | 'surface' | 'work' | 'decor';

export interface Component {
  id: string;
  label: string;
  category: Category;
  file: string;
  prompt: string;
  style: string;
  realHeight: number;
  bbox: BBox;
}

/**
 * Optional 3DGS environment shell for a pack — an Aholo World splat that the
 * props are composed *inside*. The transform brings the splat from its native
 * (often Y-down, arbitrary-scale) frame into our canonical metric Y-up frame
 * where the floor sits at y=0, so metric prop placements land on the floor.
 * Calibrated once per world (see the calibration panel) and baked here.
 */
export type WallId = 'xMin' | 'xMax' | 'zMin' | 'zMax';

/**
 * The room's usable interior, in our metric Y-up world frame (after the splat
 * transform). Lets the layout place furniture against walls and keep the
 * centre clear, instead of piling props around the origin. Hand-tuned per
 * room against the rendered splat.
 */
export interface RoomManifest {
  /** Usable floor rectangle (world metres). Props stay inside this. */
  floor: { xMin: number; xMax: number; zMin: number; zMax: number };
  /** Wall the desk/work surface backs against. */
  deskWall: WallId;
  /** Wall the sofa/lounge backs against. */
  loungeWall: WallId;
  /** How far an against-wall object sits in from the wall (metres). */
  margin?: number;
}

export interface PackEnvironment {
  /** Splat URL (.spz/.ply/.sog). Local cached copy lives under /library/<pack>/env/. */
  splatUrl: string;
  /** Splat node transform — applied to fit our metric Y-up frame. */
  transform: {
    position: [number, number, number];
    rotation: [number, number, number]; // Euler XYZ, radians
    scale: number;
  };
  /** Camera framing for a hero shot inside the room. */
  camera: {
    position: [number, number, number];
    target: [number, number, number];
  };
  /** Room interior for wall-aware layout. Absent → layout falls back to archetypes. */
  roomManifest?: RoomManifest;
}

export interface Pack {
  id: string;
  label: string;
  tagline: string;
  vibes: string[];
  rooms: string[];
  components: Component[];
  /** Present once a world has been generated + calibrated for this pack. */
  environment?: PackEnvironment;
}

export interface Catalog {
  version: number;
  packs: Pack[];
}

export async function loadCatalog(url = '/library/catalog.json'): Promise<Catalog> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`catalog ${res.status} ${res.statusText}`);
  return (await res.json()) as Catalog;
}

export function findPack(catalog: Catalog, packId: string): Pack | undefined {
  return catalog.packs.find((p) => p.id === packId);
}

export function findComponent(pack: Pack, componentId: string): Component | undefined {
  return pack.components.find((c) => c.id === componentId);
}

/** Components in the pack matching a category, for swap menus. */
export function componentsByCategory(pack: Pack, category: Category): Component[] {
  return pack.components.filter((c) => c.category === category);
}

/** Uniform scale that makes component bbox height equal realHeight. */
export function uniformScale(component: Component): number {
  const h = component.bbox.size[1];
  return h > 0 ? component.realHeight / h : 1;
}
