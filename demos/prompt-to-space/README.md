# Prompt-to-Space

> A sentence or a photo becomes a walkable 3D world, sharable as a URL.

## Pattern this demo points at

> "What if a sentence could open a door?"

Hand a person a textbox and a viewer. They type. Two minutes later they're inside a 3D space that came from their words. The URL in the address bar is now a portable artifact — share it, embed it, refresh it. The space is real enough to navigate, even though it never existed.

This is what the **Aholo World Generation API** unlocks. The lighthouse purpose of this demo is to make that primitive **legible in 30 seconds** — no signup, no jargon, no setup. Then a developer looking at the source can ask "what if I do this for X?" and have a working starting point.

## What it touches

| Layer | What |
|---|---|
| API | `POST /world/v1/generations` (single call, async) |
| Pattern | Submit-then-poll, with URL as state |
| SDK | `@manycore/aholo-viewer` for splat rendering |
| Surface | Single page, vanilla TypeScript, ~200 lines |
| Infra | Cloudflare Pages + Functions (1 static site + 2 edge fns) |

It deliberately does **not** use Lux3D, RenderCloud, OUS upload, or any agent. Those will earn their way into later demos.

## Run locally

```bash
cp .dev.vars.example .dev.vars        # then fill AHOLO_API_KEY
pnpm install                           # at repo root if not yet
pnpm --filter @3d-incubators/demo-prompt-to-space dev
```

Visit <http://localhost:8788>. The form is in `#controls`, the splat renders in `#stage`, status sits in between.

## Deploy

```bash
pnpm --filter @3d-incubators/demo-prompt-to-space build
pnpm --filter @3d-incubators/demo-prompt-to-space deploy
# Then:
wrangler pages secret put AHOLO_API_KEY --project-name incubators-prompt-to-space
```

## What might break

| Symptom | Likely cause | Fix |
|---|---|---|
| `401` from `/api/generate` | `AHOLO_API_KEY` not set on Pages | `wrangler pages secret put AHOLO_API_KEY` |
| Job goes to `FAILED` | Prompt too vague, or quota hit | Check the response body — Aholo returns a human message |
| Splat renders as a fog | Camera up axis mismatch | Edit `mountViewer({ cameraUp: [0,0,1] })` for some captures |
| Share link 404s splat | URL signing or asset eviction | Re-fetch the world (the `/api/poll` endpoint does this on demand) |

## Files worth opening

| File | Why |
|---|---|
| `src/main.ts` | The whole UX, 200 lines |
| `functions/api/generate.ts` | The "submit a job" edge fn |
| `functions/api/poll.ts` | The "where is my job" edge fn |
| `../../packages/aholo-client/src/world.ts` | The typed API surface |
| `../../packages/viewer-helpers/src/index.ts` | The 3-line splat mount |

## What I learned building this

(Will be filled in after first end-to-end run — see Principle #10.)
