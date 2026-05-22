# Known issue — `@manycore/aholo-viewer` does not draw imported glTF meshes

**Status:** open. Blocks the 3D viewport of this demo. Everything else — the
agent-driven MCP generation, the GLB bundling, the UI — is complete and works.

## Symptom

Run the demo (`pnpm --filter @3d-incubators/demo-prompt-to-object dev`) and open
the page: the 3D viewport is a flat, blank fill. The model *loads* with no error
(the status line goes green) — but nothing is ever drawn.

## Evidence

Collected with `scripts/dev-screenshot.mjs` — a headless-Chrome DevTools-Protocol
harness that screenshots the page and dumps the viewer's scene tree + render
stats. The loaded mesh is fully present and correct:

- **Scene graph:** `Scene3D > Group > Object3D "world" > Mesh` — the `Mesh` has a
  `geometry`, a `MeshPhongMaterial`, and `visible: true`.
- **Camera:** `pos (1.70, 1.20, 2.15)`, `dir (-0.57, -0.40, -0.72)` — aimed
  straight at the origin.
- **Model:** normalized to the origin, world-space box `size (1.11, 1.60, 1.12)`
  — squarely inside the camera frustum.

…yet the engine draws nothing:

- `viewer.renderInfo.objectInfo` → `{ geometries: 1, calls: 0, faces: 0, vertices: 0 }`.
  **Zero draw calls** are issued for the mesh.

The viewer's *background* (sky) renders fine — so `viewer.render()` itself works;
only scene-graph meshes are skipped.

## Ruled out

| Hypothesis | Test | Result |
|---|---|---|
| `start()` rendered only one frame, before the async load | rewrote `start()` as a rAF loop | real bug, fixed — mesh still 0 calls |
| Camera not aimed at the model | dumped `camera.getWorldDirection()` | aimed correctly |
| Model off-screen / mis-scaled | normalized to origin, dumped world box | correct |
| Geometry has no bounding volume → frustum-culled | called `computeBoundingBox/Sphere()` | no change |
| Splatting pipeline mode skips plain meshes | mounted with `splattingEnabled: false` | no change |
| Subtree nodes never registered with `Scene3D` | walked subtree, called `scene.onNodeAdd()` per node | no effect — reverted (see below) |
| Engine "may not notify every change" | called `Scene3D.notifySceneChange()` after `scene.add()` (the documented refresh hook, and what the walk-demo example does) | **no effect — still 0 calls.** Verified on a fresh `vite --force` server. |
| `componentMap` from `ParseResult` ignored | searched the entire `@manycore/aholo-viewer` repo | **hypothesis dropped:** `componentMap` is referenced *nowhere* in the SDK — not in `gltf-loader.ts`, not in the walk-demo. It is an unused field. |
| Bug is specific to Lux3D-encoded GLBs | loaded Khronos official `Box.glb` (canonical static glTF, never touched Lux3D or the MCP) through the same path | **disproved — still `calls: 0`.** The bug hits *any* static glTF, including Khronos's reference Box. Not a Lux3D problem, not an MCP problem. |

## Refined finding (2026-05-22)

`loadGLTF` is used in exactly **one** place in the whole `@manycore/aholo-viewer`
repo — `walk-demo.ts` — and only on the **skinned-character** path (the mesh is
bound to a skeleton via `AnimationPlugin.bindSkinned`). There is no example, and
no docs, for rendering a **static** imported glTF mesh. Lux3D output is static.

The renderer *does* partially ingest the mesh: `viewer.renderInfo.objectInfo`
reports `geometries: 1, programs: 1` — one geometry registered, one shader
program compiled — yet `vertices: 0, faces: 0, calls: 0`. The renderer holds the
geometry object but counts **zero drawable primitives in it**. So the gap is not
the scene graph and not the Mesh wrapper (those register fine); it is one layer
deeper — how the geometry produced by `@qunhe/egs-gltf-loader` presents its
index / draw-count / GPU buffers to the EGS renderer. A hand-built
`BufferGeometry` (the `3d-buffer-geometry` example) renders fine via the same
`new Mesh()` + `scene.add()`; a `loadGLTF` geometry does not.

**This is an `@manycore/aholo-viewer` SDK gap, not a demo bug.** `loadGLTF`'s
output is not renderable through `scene.add()` without an undocumented step, and
the only working reference is skinned-mesh-specific.

**Next step:** escalate to the aholo-viewer team with this evidence. The fix
needs the renderer's geometry-ingest internals (or a documented static-glTF
path). Tracked also in the platform assessment, `D:/Holo/Aholo-API-平台改进建议.md`.

## Diagnostic harness (kept in the repo)

- `scripts/dev-screenshot.mjs` — headless-Chrome CDP screenshot + scene-tree /
  `renderInfo` / material dump. Usage: `node scripts/dev-screenshot.mjs <url> <out.png> [waitMs]`.
- `window.__demo` — exposed by `src/main.ts` in dev builds (`{ view, PROMPTS }`);
  the harness walks the scene through it.

## Fixes already applied (kept — genuine bugs, independent of the render gap)

- `viewer-helpers`: `mountViewer().start()` now drives a real `requestAnimationFrame`
  loop. It previously rendered exactly one frame — before any async asset loaded —
  so async-loaded content never reached the screen.
- `viewer-helpers`: `loadGltfFromUrl` calls `Scene3D.notifySceneChange()` after
  `scene.add()` — the documented scene-graph refresh hook, and what the walk-demo
  example does. Correct and kept, though (see the table above) not sufficient on
  its own. The earlier per-node `onNodeAdd` walk was speculative and is removed.
