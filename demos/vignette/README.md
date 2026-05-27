# Diorama

> A chip-based brief + a library of agent-generated 3D parts → 3 LLM-composed variants → an interactive 3D scene the user can swap and re-roll component-by-component.

Internal folder is still `demos/vignette/` (history). The product is **Diorama**.

## Pattern this demo points at

> **Steerable scene assembly.** The user isn't writing 3D vocabulary or placing meshes. They're picking from chips, naming a vibe, pinning must-haves, and choosing between LLM-composed variants — *like Midjourney for 3D scenes, but built from a pack of reusable assets.*

A game studio (or a tool that targets one) needs *many* indoor scenes — apartments, hideouts, offices, workstations — populated with style-consistent props. Diorama is the assembly half of that workflow: a fixed library of agent-generated cyberpunk / cozy / etc. components, an LLM that knows how to compose them under a brief, and a 3D canvas where you can iterate.

The pattern unlocks: rapid indoor scene prototyping for indie games, world-building previews, classroom dioramas, set design boards — anywhere the user wants a *composition* rather than a *single object*.

## What it touches

| Layer | What |
|---|---|
| Library | `public/library/<pack>/<id>.glb` + `.bbox.json` sidecars, fronted by `public/library/catalog.json` |
| LLM | Direct browser → Anthropic Messages API (Sonnet 4.6), `claude-sonnet-4-6`, dangerous-direct-browser-access header |
| Layout | LLM reads the catalog (per-component real-world heights + bbox footprints) and emits 3 variants per roll |
| Viewer | `@manycore/aholo-viewer` GLTFLoader via `@3d-incubators/viewer-helpers` mountViewer + loadGltfFromUrl |
| State | URL hash (`#s=<base64-json>`) carries the picked variant for shareable links |

## How the library was built

Offline, an agent (Claude Code via the Aholo MCP) ran:

1. **Pick a pack** (e.g. "cyberpunk apartment").
2. **Decide the components** that make the pack (lamp / monitors / chair / etc.).
3. **Submit Lux3D text-to-3d in parallel** — one task per component.
4. **Repack** each ZIP into a self-contained textured GLB (`scripts/repack-lux3d-zip.py`), which also writes a `<file>.glb.bbox.json` sidecar with the local-space bounding box.
5. **Add the components** to `public/library/<pack>/` and update `public/library/catalog.json` with their metadata + real-world height priors.

The library is the durable artefact. New packs are added by running steps 1–5 again.

## How the assembly works at runtime

1. The page fetches `library/catalog.json`.
2. The user fills out the **compose** screen: pack selector, vibe chips, room chip, must-have components, free-text refine.
3. They click **Roll 3 variants** — the page calls Anthropic directly from the browser. The system prompt lists every component in the chosen pack with its category, real-world height and footprint. The model returns three variants, each with a name, a one-line narrative, a component subset, per-component position + rotation + rationale, and a camera framing.
4. The user picks one from the **variants** screen (each card includes a top-down 2D schematic). The pick is encoded into the URL hash.
5. On the **scene** screen, each component can be **swapped** for another component of the same category from the same pack. Re-roll regenerates new variants from the same brief.

## Run it

```bash
pnpm install
pnpm --filter @3d-incubators/demo-vignette dev
```

Open the printed local URL. Click **Set API key** in the topbar, paste an Anthropic key (it stays in `localStorage` — no server in the loop). Fill the brief, roll.

## What's in the box

| File | Job |
|---|---|
| `public/library/catalog.json` | Master catalog — packs + components + bboxes |
| `public/library/<pack>/*.glb` | Agent-generated, repacked, ready-to-render meshes |
| `src/library.ts` | Catalog types + fetch + bbox-derived uniform scale |
| `src/llm.ts` | Browser-direct Anthropic call + variant JSON coercion |
| `src/state.ts` | URL hash encode/decode + API-key localStorage |
| `src/main.ts` | State machine: compose → rolling → variants → scene |

## Adding a new pack

1. Define the pack's components (categories: `seat / light / surface / work / decor`).
2. Generate each via `aholo_generate_model_from_text` + `aholo_get_model_textured_glb` (or the MCP composite call).
3. Drop GLBs + sidecars into `public/library/<pack-id>/`.
4. Add an entry under `packs[]` in `public/library/catalog.json` with vibes, rooms, component metadata.

No code changes. The compose screen reads the catalog at runtime.
