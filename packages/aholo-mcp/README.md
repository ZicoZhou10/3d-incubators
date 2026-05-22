# @3d-incubators/aholo-mcp

> A Model Context Protocol server for the Aholo Spatial APIs. Lets any MCP-aware agent — Claude Code, Claude Desktop, Cursor — generate and render 3D from text or images.

## Why this exists

The Aholo REST API is capable but has sharp edges that every integrator re-discovers: a `Bearer`-less auth header, an implicit `/global` path prefix, async jobs that take 5–15 minutes, a queue that looks like a hang. This MCP server is the layer that **absorbs those edges** so an agent can think in intents ("make me a 3D chair") instead of HTTP.

It does **not** invent a parallel API — each tool is 1–3 real Aholo calls with the orchestration know-how baked into the tool description.

## Install

```bash
# from the 3d-incubators monorepo root
pnpm --filter @3d-incubators/aholo-client build
pnpm --filter @3d-incubators/aholo-mcp build
```

(Standalone npm publication will come once it leaves the experimental repo.)

## Connect it to Claude Code

```bash
claude mcp add aholo --env AHOLO_API_KEY=<your-key> -- node /abs/path/to/packages/aholo-mcp/dist/index.js
```

Or add to `.mcp.json` / Claude Desktop config:

```json
{
  "mcpServers": {
    "aholo": {
      "command": "node",
      "args": ["/abs/path/to/packages/aholo-mcp/dist/index.js"],
      "env": { "AHOLO_API_KEY": "your-key-from-labs.aholo3d.com" }
    }
  }
}
```

`AHOLO_BASE_URL` is optional and defaults to `https://api.aholo3d.com`. Set it to `https://api.aholo3d.cn` for the China gateway.

## Tools

| Tool | What it does |
|---|---|
| `aholo_choose_api` | Decision guide — call first if unsure which tool to use. No quota cost. |
| `aholo_generate_world` | Text (+ optional image URL) → a 3DGS scene. Submits async, returns a `worldId`. |
| `aholo_get_world` | Poll a world job; on success returns splat URLs + a ready-to-paste viewer snippet. |
| `aholo_generate_model_from_text` | Text + style → a single GLB object via Lux3D. |
| `aholo_generate_model_from_image` | A local image file or data URL → a single GLB object. |
| `aholo_get_model` | Poll a Lux3D task; on success returns the result ZIP URL. |

## Design notes

- **Nothing blocks for 15 minutes.** Generation is async; a tool that blocked for the full job would hang the host. Tools submit and return a job id; the agent polls a `get_*` tool. The tool descriptions tell the agent to expect minutes and not to busy-loop.
- **The API key never reaches the model.** It is read from `AHOLO_API_KEY` in the server's environment, never passed as a tool argument.
- **Errors are blueprints.** A 401 explains the `Bearer`-prefix trap. A `FAILED` job suggests what to change. The point is that an agent can self-correct from the error text alone.
- **Big payloads stay out of context.** Tools return URLs, never megabytes of splat or mesh bytes.

## Not yet covered

- **World reconstruction from your own photos/video** — needs the OUS upload flow wired in. Planned next.
- **RenderCloud** (OpenUSD offline + real-time streaming) — for real-time streaming, use the `RenderCloud` namespace re-exported from `@manycore/aholo-viewer`, which already wraps the WebSocket protocol.
- **MCP Resources & Prompts** — recipe docs and starter prompts are planned; today the know-how lives in tool descriptions and `aholo_choose_api`.

## Verified

`tools/list` and a live `aholo_get_world` call against `api.aholo3d.com` both pass (2026-05-22). A world generated earlier in development (`"Nordic Sunlit Haven"`) was retrieved end-to-end through the server, returning real `.spz` / `.ply` URLs.
