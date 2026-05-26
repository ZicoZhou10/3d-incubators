/**
 * Minimal orbit controls — pointer drag rotates the camera around a target,
 * wheel zooms in/out. Just enough to make a 3D demo feel alive without
 * pulling in the viewer's full 979-line CameraControl class.
 *
 * Math: spherical coordinates (azimuth, elevation, distance) around a target.
 *   camera.position = target + (
 *     distance * cos(el) * sin(az),
 *     distance * sin(el),
 *     distance * cos(el) * cos(az),
 *   )
 *
 * Used via `mountViewer({ orbit: true })`. The orbit state is recomputed from
 * the initial camera position passed in `cameraPosition` / `cameraTarget`, so
 * a demo's chosen framing becomes the orbit's anchor.
 */

import type { PerspectiveCamera, Vector3 } from '@manycore/aholo-viewer';

export interface OrbitOptions {
  /** Pixels of drag → radians of rotation. Default 0.005. */
  rotateSpeed?: number;
  /** Wheel delta multiplier (per notch). Default 0.0015. */
  zoomSpeed?: number;
  /** Distance bounds. Default [0.5, 100]. */
  minDistance?: number;
  maxDistance?: number;
  /** Elevation bounds in radians. Default [-1.5, 1.5] (~±86°). */
  minElevation?: number;
  maxElevation?: number;
}

export interface OrbitController {
  /** Set the orbit target — camera will look here. */
  setTarget(x: number, y: number, z: number): void;
  /** Snap the orbit anchor to the camera's current position + target. */
  resync(): void;
  /** Detach event listeners. */
  dispose(): void;
}

interface Spherical {
  azimuth: number; // around Y
  elevation: number; // up from XZ plane
  distance: number;
}

export function attachOrbit(
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
  Vector3Ctor: new (x: number, y: number, z: number) => Vector3,
  opts: OrbitOptions = {}
): OrbitController {
  const rotateSpeed = opts.rotateSpeed ?? 0.005;
  const zoomSpeed = opts.zoomSpeed ?? 0.0015;
  const minDistance = opts.minDistance ?? 0.5;
  const maxDistance = opts.maxDistance ?? 100;
  const minElevation = opts.minElevation ?? -1.5;
  const maxElevation = opts.maxElevation ?? 1.5;

  const target = { x: 0, y: 0, z: 0 };
  const state: Spherical = { azimuth: 0, elevation: 0, distance: 1 };

  // Initialise from camera's current pose.
  function deriveFromCamera(): void {
    const dx = camera.position.x - target.x;
    const dy = camera.position.y - target.y;
    const dz = camera.position.z - target.z;
    const distance = Math.max(Math.hypot(dx, dy, dz), 1e-6);
    state.distance = distance;
    state.elevation = Math.asin(Math.max(-1, Math.min(1, dy / distance)));
    state.azimuth = Math.atan2(dx, dz);
  }
  deriveFromCamera();

  function applyToCamera(): void {
    const ce = Math.cos(state.elevation);
    const se = Math.sin(state.elevation);
    const sa = Math.sin(state.azimuth);
    const ca = Math.cos(state.azimuth);
    camera.position.set(
      target.x + state.distance * ce * sa,
      target.y + state.distance * se,
      target.z + state.distance * ce * ca
    );
    camera.lookAt(new Vector3Ctor(target.x, target.y, target.z));
  }

  // Pointer handlers — capture-style so a fast drag past the canvas keeps tracking.
  let dragging = false;
  let pointerId = -1;
  let lastX = 0;
  let lastY = 0;

  const onPointerDown = (ev: PointerEvent): void => {
    // Only react to primary button (left for mouse, touch contact, pen tip).
    if (ev.button !== 0) return;
    dragging = true;
    pointerId = ev.pointerId;
    lastX = ev.clientX;
    lastY = ev.clientY;
    canvas.setPointerCapture(pointerId);
    canvas.style.cursor = 'grabbing';
  };

  const onPointerMove = (ev: PointerEvent): void => {
    if (!dragging || ev.pointerId !== pointerId) return;
    const dx = ev.clientX - lastX;
    const dy = ev.clientY - lastY;
    lastX = ev.clientX;
    lastY = ev.clientY;
    state.azimuth -= dx * rotateSpeed;
    state.elevation += dy * rotateSpeed;
    state.elevation = Math.max(minElevation, Math.min(maxElevation, state.elevation));
    applyToCamera();
  };

  const stopDrag = (): void => {
    if (!dragging) return;
    dragging = false;
    try {
      canvas.releasePointerCapture(pointerId);
    } catch {
      /* releasing an already-released pointer throws; ignore */
    }
    canvas.style.cursor = 'grab';
  };

  const onWheel = (ev: WheelEvent): void => {
    ev.preventDefault();
    const factor = Math.exp(ev.deltaY * zoomSpeed);
    state.distance = Math.max(minDistance, Math.min(maxDistance, state.distance * factor));
    applyToCamera();
  };

  canvas.style.cursor = 'grab';
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return {
    setTarget(x, y, z) {
      target.x = x;
      target.y = y;
      target.z = z;
      deriveFromCamera();
      applyToCamera();
    },
    resync() {
      deriveFromCamera();
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', stopDrag);
      canvas.removeEventListener('pointercancel', stopDrag);
      canvas.removeEventListener('wheel', onWheel);
      canvas.style.cursor = '';
      canvas.style.touchAction = '';
    },
  };
}
