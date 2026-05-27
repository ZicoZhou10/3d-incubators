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

export interface Pack {
  id: string;
  label: string;
  tagline: string;
  vibes: string[];
  rooms: string[];
  components: Component[];
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
