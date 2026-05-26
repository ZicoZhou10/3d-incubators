# Vignette

> An AI agent decomposes a brief into several 3D objects and assembles them into one scene.

## Pattern this demo points at

> **Spatially-Grounded Agent.** The agent isn't just generating a single artefact, it's reasoning about a *set* of artefacts and how they sit together in space.

Demos 1 and 2 each produced one thing — one world, one object. This demo produces **a small composed scene** from one high-level brief, by an agent that decomposed the brief into components, generated each via Lux3D, and placed them at curated transforms. The result is the same MCP-only pipeline as Demo 2, scaled to multi-object output.

The pattern unlocks: product viz套装, interior design previews, education scenes, retail collection samples — anywhere a developer's customer thinks in terms of *a scene*, not *a thing*.

## What it touches

| Layer | What |
|---|---|
| API | `POST /lux3d/v1/generate/text-to-3d/task/create` × N (parallel), `task/get` polling |
| MCP | `aholo_generate_model_from_text` → `aholo_get_model` → `aholo_get_model_textured_glb` |
| SDK | `@manycore/aholo-viewer` GLTFLoader; `@3d-incubators/viewer-helpers` mountViewer + loadGltfFromUrl |
| Repack | `scripts/repack-lux3d-zip.py` (or `aholo_get_model_textured_glb` server-side) embeds PBR PNGs into each GLB |

## How the vignette was made

Offline, an agent (Claude Code via the Aholo MCP) ran this pipeline:

1. **Read the brief** — e.g. *"A cozy reading corner with an armchair, a tall floor lamp, a small leather footstool, and a stack of books on the floor next to the chair."*
2. **Decompose** the brief into discrete generatable components (4 in this case). The agent author picks the prompt phrasing per component.
3. **Submit Lux3D text-to-3D in parallel** — Lux3D's per-account concurrency supports it. Each takes 3–8 minutes.
4. **Repack each ZIP** — Lux3D ships GLB + 9 separate V-Ray-style PNGs; the bare GLB is grey. The repacker embeds the three glTF-standard PBR slots (diffuse / normal / emissive).
5. **Place each component** at a hand-curated transform (position / rotation / uniform scale) that makes them sit together as a scene.
6. **Drop the GLBs** into `public/scenes/<slug>/` and add an entry to `src/vignettes.ts`.

This page is the viewer half. It reads the vignette manifest and loads each GLB at its transform.

## Run it

```bash
pnpm install               # at the repo root, once
pnpm --filter @3d-incubators/demo-vignette dev
```

Open the printed local URL. Pick a vignette chip; the components load and assemble.

## Adding another vignette

Re-run the same offline flow with new prompts:

```bash
# (in a Claude Code session with the Aholo MCP wired up)
# 1. aholo_generate_model_from_text({ prompt, style }) × N in parallel
# 2. aholo_get_model + aholo_get_model_textured_glb once each is SUCCEEDED
# 3. drop the GLBs into public/scenes/<your-slug>/
# 4. add a Vignette entry to src/vignettes.ts with curated transforms
```

The placement step is hand-curated for now. A future iteration could auto-place via an LLM that knows the bounding boxes — but that's a different demo (and a separate hard problem).

## What's in the box

| File | Job |
|---|---|
| `src/vignettes.ts` | The vignette registry — prompts, files, transforms |
| `src/main.ts` | Mounts the viewer, loads + places each component |
| `public/scenes/<slug>/*.glb` | Agent-generated, repacked, ready-to-render meshes |
