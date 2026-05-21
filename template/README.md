# Demo Template

> Starter for a new 3D Incubators demo. You almost certainly arrived here via `pnpm new-demo <slug>` — if not, **do that first** so this folder ends up under `demos/<slug>/` with a unique name.

## What's in the box

| File | Job |
|---|---|
| `index.html` | The single page; expects `#stage`, `#status`, `#controls` IDs (keep them) |
| `src/main.ts` | Boots the viewer, loads a sample splat — proves the pipeline works before you wire anything |
| `src/api.ts` | Browser-side wrappers around `/api/generate` and `/api/poll` |
| `functions/api/generate.ts` | Edge function: kicks off a World Generation |
| `functions/api/poll.ts` | Edge function: one-shot status fetch |
| `functions/api/_utils.ts` | Shared env validation + JSON helpers |
| `wrangler.toml` | Cloudflare Pages config; sets `AHOLO_BASE_URL` |
| `.dev.vars.example` | Copy → `.dev.vars` and put your `AHOLO_API_KEY` there |

## Run it

```bash
cp .dev.vars.example .dev.vars       # fill in AHOLO_API_KEY
pnpm install                          # if you haven't at repo root
pnpm dev                              # wrangler serves vite + functions together
```

Open <http://localhost:8788>.

You should see the sample bear splat. If you don't, the viewer pipeline is broken — fix that before touching anything else (Principle #2: time-to-feedback).

## Deploy

```bash
pnpm build
pnpm deploy
# First time: wrangler will create the Pages project. Then:
wrangler pages secret put AHOLO_API_KEY
```

## Where to start

1. Open `src/main.ts` — replace the sample splat with your own flow
2. If you need new server endpoints, add them under `functions/api/`
3. Read `../../DECISION_PRINCIPLES.md` before adding scope
4. When you ship, update `../../README.md`'s demos table

## What to keep, what to change

**Keep:** the three-region layout (`#controls`, `#status`, `#stage`), the edge proxy pattern, the absence of frontend frameworks (unless you genuinely need one).

**Change:** everything else.
