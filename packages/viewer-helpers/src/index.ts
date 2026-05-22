/**
 * Sensible-defaults helpers on top of `@manycore/aholo-viewer`.
 *
 * Goal: render a remote 3D asset in 3 lines from a fresh checkout.
 *
 * ```ts
 * import { mountViewer, loadSplatFromUrl, loadGltfFromUrl } from '@3d-incubators/viewer-helpers';
 *
 * const view = mountViewer(document.getElementById('stage')!);
 * await loadSplatFromUrl(view, 'https://.../scene.spz');  // World 3DGS output
 * await loadGltfFromUrl(view, 'https://.../model.glb');   // Lux3D mesh output
 * view.start();
 * ```
 */

import {
  createViewer,
  setViewerConfig,
  SplatUtils,
  SplatLoader,
  GLTFLoader,
  downloadTexture,
  Vector3,
  type Viewer,
} from '@manycore/aholo-viewer';

export interface MountOptions {
  /** Initial camera position. Defaults to a 3m orbital pull-back along +Z. */
  cameraPosition?: [number, number, number];
  /** Look-at target. Defaults to origin. */
  cameraTarget?: [number, number, number];
  /** Up axis. Many 3DGS captures are Y-down, so default mirrors that convention. */
  cameraUp?: [number, number, number];
  /** Pipeline overrides. */
  splattingEnabled?: boolean;
  /** Pixel ratio cap on hi-DPI devices. */
  pixelRatio?: number;
}

export interface MountedViewer {
  /** Underlying Aholo Viewer instance. */
  viewer: Viewer;
  /** The scene graph root — add/remove objects here. */
  scene: ReturnType<Viewer['getScene']>;
  /** Start the render loop. Idempotent. */
  start: () => void;
  /** Stop the render loop and tear down. */
  dispose: () => void;
}

export function mountViewer(container: HTMLElement, opts: MountOptions = {}): MountedViewer {
  const name = `viewer-${Math.random().toString(36).slice(2, 8)}`;
  const viewer = createViewer(name, container, {});

  setViewerConfig(viewer, {
    pixelRatio: opts.pixelRatio,
    pipeline: {
      Splatting: { enabled: opts.splattingEnabled ?? true },
    },
  });

  const camera = viewer.getCamera();
  const pos = opts.cameraPosition ?? [-1.5, -0.5, 0];
  camera.position.set(pos[0], pos[1], pos[2]);
  const up = opts.cameraUp ?? [0, -1, 0];
  camera.up.set(up[0], up[1], up[2]);
  const target = opts.cameraTarget ?? [0, 0, 0];
  camera.lookAt(new Vector3(target[0], target[1], target[2]));

  let started = false;
  let rafId = 0;

  return {
    viewer,
    scene: viewer.getScene(),
    start() {
      if (started) return;
      started = true;
      // The Aholo Viewer has no built-in animation loop — `Viewer.render()`
      // draws exactly one frame. Drive a requestAnimationFrame loop so that
      // assets added after `start()` (async glTF/splat loads) and every
      // camera/orbit change actually reach the screen. Rendering only once
      // here would leave the canvas frozen on its first (empty) frame.
      const loop = (): void => {
        if (!started) return;
        viewer.render();
        rafId = requestAnimationFrame(loop);
      };
      loop();
    },
    dispose() {
      // Aholo Viewer's Application owns disposal; signal via setViewerConfig if needed.
      started = false;
      if (rafId) cancelAnimationFrame(rafId);
    },
  };
}

export interface SplatHandle {
  splat: Awaited<ReturnType<typeof SplatUtils.createSplat>>;
  remove: () => void;
}

/**
 * Load a splat asset (.ply, .spz, .sog, .splat, .lcc, .ksplat) from a URL and add it to the scene.
 * Returns a handle that can be used to remove or dispose the splat.
 *
 * The URL is fetched via standard `fetch`, so CORS rules apply — if you're calling
 * from a serverless proxy, make sure the proxy forwards `Access-Control-Allow-Origin: *`.
 */
export async function loadSplatFromUrl(
  view: MountedViewer,
  url: string,
  signal?: AbortSignal
): Promise<SplatHandle> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`Splat fetch failed: ${res.status} ${res.statusText} (${url})`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());

  // SplatLoader API: detect type from filename + bytes, then parse with that type.
  const filename = url.split('?')[0]?.split('/').pop() ?? 'splat.unknown';
  const fileType = SplatLoader.detectSplatFileType(filename, bytes);
  if (!fileType) {
    throw new Error(
      `Could not detect splat format from "${filename}". Supported: .ply, .spz, .sog, .splat, .lcc, .ksplat.`
    );
  }
  const data = await SplatLoader.parseSplatData(fileType, bytes);
  const splat = await SplatUtils.createSplat(data);
  view.scene.add(splat);

  return {
    splat,
    remove: () => {
      view.scene.remove(splat);
      // SplatUtils.createSplat returns a disposable; respect it if available
      const disposable = splat as unknown as { destroy?: () => void };
      disposable.destroy?.();
    },
  };
}

export interface GltfHandle {
  /** The root Object3D of the loaded glTF scene. */
  scene: Awaited<ReturnType<typeof GLTFLoader.loadGLTF>>['scene'];
  remove: () => void;
}

/**
 * Load a glTF/GLB model from a URL and add it to the scene.
 *
 * Use this for Lux3D output (a single mesh + PBR textures) — as opposed to
 * `loadSplatFromUrl`, which is for World 3DGS output. Lux3D returns a ZIP;
 * point this at the `.glb` inside it (or a direct .glb/.gltf URL).
 *
 * After `scene.add()` of a pre-built subtree the engine does not always pick
 * up the descendant meshes — `notifySceneChange()` forces the scene graph to
 * refresh so the meshes enter the draw list. (A splat is a single leaf, so
 * `loadSplatFromUrl` does not need this.) This mirrors the walk-demo example
 * in @manycore/aholo-viewer, which is the authoritative glTF usage.
 *
 * Same CORS caveat as `loadSplatFromUrl`: the URL must be CORS-reachable.
 */
export async function loadGltfFromUrl(
  view: MountedViewer,
  url: string,
  signal?: AbortSignal
): Promise<GltfHandle> {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`glTF fetch failed: ${res.status} ${res.statusText} (${url})`);
  }
  const buf = await res.arrayBuffer();

  // loadGLTF needs a textureLoader; the viewer ships `downloadTexture` for exactly this.
  const result = await GLTFLoader.loadGLTF(buf, { textureLoader: downloadTexture });
  view.scene.add(result.scene);
  notifySceneChange(view.scene);

  return {
    scene: result.scene,
    remove: () => {
      view.scene.remove(result.scene);
      notifySceneChange(view.scene);
      const disposable = result.scene as unknown as { destroy?: () => void };
      disposable.destroy?.();
    },
  };
}

/** Force the scene graph to refresh — see loadGltfFromUrl for why. */
function notifySceneChange(scene: MountedViewer['scene']): void {
  const fn = (scene as unknown as { notifySceneChange?: () => void }).notifySceneChange;
  if (typeof fn === 'function') fn.call(scene);
}
