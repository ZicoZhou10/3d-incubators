# Prompt To Object

> An AI agent turns a sentence into a single 3D object, rendered in the browser.

Pick an object description and its 3D mesh appears in the viewer.

## How the 3D is made — and why there's no backend

Aholo's "text → 3D object" capability is reached **only through MCP tools**
(`aholo_generate_model_from_text` → poll `aholo_get_model`). MCP tools are
driven by an *agent*, not by browser or server code — so neither this page nor
an edge function can call them.

That shapes the demo:

- **Generation is agent-driven.** An AI agent (Claude Code) ran the Aholo MCP
  server, generated the objects below, and bundled the resulting GLB meshes
  into `public/models/`.
- **This page is the viewer half.** It loads a bundled GLB and renders it. There
  is no `/api/*` backend — the template's edge-proxy scaffolding was removed
  because there is no runtime API call to proxy.

The agent generates; the human inspects. That split is the honest shape of an
MCP-only pipeline.

## What's in the box

| File | Job |
|---|---|
| `index.html` | Single page; expects the `#stage` / `#status` / `#controls` IDs |
| `src/main.ts` | Mounts the viewer, lights the scene, loads a GLB on demand |
| `src/styles.css` | Dark theme + prompt-chip styling |
| `public/models/*.glb` | Agent-generated meshes, one per prompt in `main.ts` |
| `RENDER_BUG_POSTMORTEM.md` | A render bug we shipped, misdiagnosed, then fixed — kept as curriculum |

## Run it

```bash
pnpm install                 # at the repo root, once
pnpm --filter @3d-incubators/demo-prompt-to-object dev
```

Then open the printed local URL. The model renders on load; mouse-orbit controls
are not wired up yet (a follow-up — see `viewer-helpers`).

## Add another object

1. Call `aholo_generate_model_from_text` with a prompt + `style`.
2. Poll `aholo_get_model` until `SUCCEEDED`; download the result ZIP.
3. Extract the `.glb` into `public/models/`.
4. Add a row to the `PROMPTS` array in `src/main.ts`.

## Deploy

`pnpm build` emits a static bundle in `dist/` — host it anywhere static
(Cloudflare Pages, Netlify, GitHub Pages). No secrets, no server.
