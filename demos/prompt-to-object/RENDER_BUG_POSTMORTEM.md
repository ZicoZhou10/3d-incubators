# Post-mortem — the "glTF won't render" bug

**Status: resolved (2026-05-22).** The demo renders correctly. This file is kept
as curriculum (Decision Principle #10), because the *misdiagnosis* is the
instructive part.

## What happened

The 3D viewport rendered blank — imported glTF meshes never appeared, only the
sky background. We spent a long investigation on it and very nearly escalated it
to the `@manycore/aholo-viewer` team as an SDK bug.

It was **our bug**, in `@3d-incubators/viewer-helpers`.

## The real root cause

`mountViewer` was a from-scratch reimplementation of a viewer driver. It used
`viewer.getScene()` / `viewer.getCamera()` defaults and never called
`viewer.resize()`. The viewer's own website driver (`RenderSessionRenderer`)
instead installs a fresh `Scene3D` + `PerspectiveCamera` via `setScene` /
`setCamera`, sizes the canvas to the container, and calls `resize()`.

Without that setup the background drew but scene-graph content never did. The
fix was to make `mountViewer` mirror `RenderSessionRenderer`'s construction
sequence. The viewer SDK was fine the whole time.

## Why the misdiagnosis happened — the actual lesson

We anchored the entire investigation on one metric: `renderInfo.objectInfo.calls`
read `0`, so we concluded "the mesh is not being drawn" and went hunting in the
scene graph, the geometry, the loader.

Then the viewer team ran the same `loadGLTF` in their Playground — it rendered a
cube fine, **and their inspector also showed `Draw calls: 0`**. The counter is
unreliable. We had spent days chasing a number that didn't mean what we assumed.

**Lesson, now Decision Principle #12:** *Verify against the artifact, not a
proxy metric.* "Did it render?" is answered by looking at the pixels — a
screenshot — not by reading a stats counter. A proxy metric is a hypothesis
about reality, not reality.

Secondary lesson: we almost escalated a self-inflicted bug to another team. Before
blaming a dependency, reproduce the dependency working in isolation (its own
example / playground). The viewer team did that in one minute; we should have
done it first.

## Investigation trail

The full ruled-out table, the `componentMap` red herring, and the Khronos
`Box.glb` test live in this file's git history (it was `KNOWN_ISSUE.md`). The
diagnostic harness `scripts/dev-screenshot.mjs` is kept — it now also serves as
the "look at the pixels" tool the lesson above demands.
