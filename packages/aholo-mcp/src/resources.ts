/**
 * MCP Resources — read-only context an agent can pull via `resources/list` +
 * `resources/read`. These hold the orchestration know-how that's hard to
 * embed in tool descriptions without bloat: end-to-end recipes, error
 * catalogues, format explainers.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const RECIPE_WALKABLE_SPACE = `# Recipe — generate a walkable 3DGS world

Goal: turn a sentence or a photo into a 3D space a user can walk around in
@manycore/aholo-viewer.

1. \`aholo_generate_world({ prompt, imageUrl? })\` → returns \`{ worldId }\`.
2. Poll \`aholo_get_world({ worldId })\` every ~30 s. PENDING can last 10+ min;
   that is NOT stuck — it's queue.
3. When status is SUCCEEDED, pick a splat URL from \`assets.splats.urls\` in
   preference order: \`spzPath\` (smallest) → \`sogPath\` → \`plyPath\`.
4. Render in the browser:
   \`\`\`ts
   import { mountViewer, loadSplatFromUrl } from '@3d-incubators/viewer-helpers';
   const view = mountViewer(document.getElementById('stage')!);
   view.start();
   await loadSplatFromUrl(view, '<the spz URL>');
   \`\`\`
5. For your own footage instead of a prompt: \`aholo_reconstruct_world({ imagePaths, scene, taskQuality })\`
   does the OUS upload + reconstruct in one call.

Common gotchas:
- "PENDING" sticking for >10 min is queue, not failure. Do not abort.
- Splat URLs are not eternal — re-fetch via aholo_get_world if you cache them.
- Set \`camera.up = [0,-1,0]\` for many Y-down captures (viewer-helpers default).
`;

const RECIPE_PRODUCT_FIGURINE = `# Recipe — generate a single 3D object (Lux3D)

Goal: turn one text prompt or one image into a renderable GLB.

1. \`aholo_generate_model_from_text({ prompt, style })\` OR
   \`aholo_generate_model_from_image({ imagePath })\` → returns \`{ taskid }\`.
2. Poll \`aholo_get_model({ taskid })\` every ~12 s until status SUCCEEDED.
3. **Do NOT** load the GLB inside the result ZIP directly — it embeds an
   80-byte placeholder texture and renders as grey clay. The actual PBR
   maps are 9 sibling PNG files using V-Ray-style naming.
4. Instead: \`aholo_get_model_textured_glb({ taskid, outputPath })\` downloads
   the ZIP, embeds the three glTF-standard PBR slots (diffuse / normal /
   emissive), and writes a self-contained GLB.
5. Render:
   \`\`\`ts
   import { mountViewer, loadGltfFromUrl } from '@3d-incubators/viewer-helpers';
   const view = mountViewer(stage); view.start();
   await loadGltfFromUrl(view, '/models/your.glb');
   \`\`\`

Styles available for text-to-3D: photorealistic, cartoon, anime,
hand_painted, cyberpunk, fantasy, glass.

Result URLs from the Lux3D gateway expire ~2 h after task submission.
Run the textured-GLB step inside that window.
`;

const FORMAT_SPLATS = `# Splat formats — when to pick which

The World API outputs three splat representations in \`assets.splats.urls\`:

- **spzPath** — Compressed Spz. ~1/3 the size of PLY. Fastest to download
  on a phone. Default choice for any web demo. @manycore/aholo-viewer
  loads it natively.
- **sogPath** — SOG (compressed). Slightly larger than SPZ but supports
  LOD streaming when paired with \`lodMetaPath\`. Use when you want
  billion-point scenes to load in seconds.
- **plyPath** — Standard PLY. Universal but largest (5-10×). Use when
  interoperability with non-Aholo viewers matters; avoid for web.

If \`lodMetaPath\` is present, the world has been LOD-tiled — combine
with \`SplatUtils.LodSplat\` for streaming.
`;

const ERROR_CATALOG = `# Common errors → fixes

| HTTP | Symptom | Likely cause | Fix |
|------|---------|--------------|-----|
| 401  | UNAUTHENTICATED / code 10004 | Bearer prefix added, or env var missing | Authorization header must be the **raw** API key. **No "Bearer " prefix.** Set AHOLO_API_KEY in the MCP server env. |
| 404  | path not found | Wrong gateway: \`.com\` requires \`/global\` prefix, \`.cn\` does not | Use the right baseUrl, the client adds /global automatically for \`.com\` |
| 403  | Forbidden on a Lux3D result URL | URL expired (~2 h after task submission) | Resubmit the task; URLs are NOT regenerated on re-poll |
| 5xx  | gateway error | transient | Retry after a short backoff |
| n/a  | World PENDING for 15+ min | account concurrency queue | Wait; PENDING is not stuck |
| n/a  | Lux3D model renders grey | The GLB inside the ZIP is a placeholder | Use \`aholo_get_model_textured_glb\` to repack with the sibling PBR PNGs |
`;

const DECISION_TREE = `# When to call what — decision tree

You want a **scene / room / environment** (walkable)
  → text prompt only         → aholo_generate_world({ prompt })
  → text + 1 reference image → aholo_generate_world({ prompt, imageUrl })
  → your own photos / video  → aholo_reconstruct_world({ imagePaths or videoPath, scene, taskQuality })

You want a **single object** (prop, product, character, furniture)
  → text + style → aholo_generate_model_from_text({ prompt, style })
  → from one image → aholo_generate_model_from_image({ imagePath })
  → then: aholo_get_model_textured_glb({ taskid, outputPath })

You want to **check / diagnose** an existing job
  → poll status only      → aholo_get_world OR aholo_get_model
  → "what is this id, why is it stuck" → aholo_diagnose_job({ id })
  → list everything       → aholo_list_worlds

Unsure where to start?
  → aholo_choose_api — costs no quota
`;

interface ResourceDef {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: string;
  body: string;
}

const RESOURCES: ResourceDef[] = [
  {
    uri: 'aholo://recipe/walkable-space',
    name: 'recipe-walkable-space',
    title: 'Recipe: text/photo → walkable 3DGS world',
    description: 'End-to-end recipe for the World API path (the prompt-to-space pattern).',
    mimeType: 'text/markdown',
    body: RECIPE_WALKABLE_SPACE,
  },
  {
    uri: 'aholo://recipe/product-figurine',
    name: 'recipe-product-figurine',
    title: 'Recipe: text/image → single textured GLB (Lux3D)',
    description: 'End-to-end recipe for the Lux3D path, including the textured-GLB repack step.',
    mimeType: 'text/markdown',
    body: RECIPE_PRODUCT_FIGURINE,
  },
  {
    uri: 'aholo://format/splats',
    name: 'format-splats',
    title: 'Splat formats — when to pick which',
    description: 'SPZ vs SOG vs PLY trade-offs.',
    mimeType: 'text/markdown',
    body: FORMAT_SPLATS,
  },
  {
    uri: 'aholo://errors/catalog',
    name: 'errors-catalog',
    title: 'Common errors → fixes',
    description: 'A short table mapping observed errors to actionable fixes.',
    mimeType: 'text/markdown',
    body: ERROR_CATALOG,
  },
  {
    uri: 'aholo://decisions/api-tree',
    name: 'decisions-api-tree',
    title: 'Decision tree: when to call which tool',
    description: 'Static decision tree — the same logic aholo_choose_api returns at runtime.',
    mimeType: 'text/markdown',
    body: DECISION_TREE,
  },
];

export function registerResources(server: McpServer): void {
  for (const r of RESOURCES) {
    server.registerResource(
      r.name,
      r.uri,
      { title: r.title, description: r.description, mimeType: r.mimeType },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: r.mimeType, text: r.body }],
      })
    );
  }
}
