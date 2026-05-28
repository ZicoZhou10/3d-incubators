/* 3DGS environment shell — load an Aholo World splat as the room the props
 * live inside, and apply a calibration transform that brings the splat into
 * our canonical metric Y-up frame (floor at y=0).
 *
 * Registration is the hard part of putting meshes inside a generated splat:
 * the splat has an arbitrary orientation/scale/origin. We don't transform the
 * props; we transform the *splat* once (calibrated by hand against the props
 * as a metric ruler), then every metric prop placement lands correctly.
 */

import { Vector3, type Object3D } from '@manycore/aholo-viewer';
import { loadSplatFromUrl, type MountedViewer } from '@3d-incubators/viewer-helpers';
import type { PackEnvironment } from './library.js';

export interface EnvTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
}

export const IDENTITY_TRANSFORM: EnvTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: 1,
};

export interface EnvHandle {
  /** The splat scene node — mutate position/rotation/scale to re-calibrate live. */
  node: Object3D;
  remove: () => void;
}

type Transformable = Object3D & {
  position: { set: (x: number, y: number, z: number) => void };
  rotation: { set: (x: number, y: number, z: number) => void };
  scale: { set: (x: number, y: number, z: number) => void };
};

export function applyTransform(node: Object3D, t: EnvTransform): void {
  const n = node as Transformable;
  n.position.set(t.position[0], t.position[1], t.position[2]);
  n.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2]);
  n.scale.set(t.scale, t.scale, t.scale);
}

/** Load the splat and apply the calibrated transform. */
export async function loadEnvironment(
  view: MountedViewer,
  env: PackEnvironment,
  signal?: AbortSignal
): Promise<EnvHandle> {
  const handle = await loadSplatFromUrl(view, env.splatUrl, signal);
  const node = handle.splat as unknown as Object3D;
  applyTransform(node, env.transform);
  return { node, remove: handle.remove };
}

/** Load just the splat (identity transform) for calibration. */
export async function loadSplatForCalibration(
  view: MountedViewer,
  url: string,
  signal?: AbortSignal
): Promise<EnvHandle> {
  const handle = await loadSplatFromUrl(view, url, signal);
  const node = handle.splat as unknown as Object3D;
  return { node, remove: handle.remove };
}

/** Point the camera at a target (used after (re)loading an environment). */
export function frameCamera(
  view: MountedViewer,
  camera: PackEnvironment['camera']
): void {
  view.camera.position.set(...camera.position);
  view.camera.lookAt(new Vector3(...camera.target));
  view.orbit?.setTarget(...camera.target);
}
