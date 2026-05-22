/* An AI agent turns a sentence into a 3D object you can spin in your browser. — scaffolded 2026-05-22 */
/**
 * Prompt → Object — a text description becomes an orbitable 3D mesh.
 *
 * Where the 3D actually comes from
 * --------------------------------
 * Aholo's "text → 3D object" capability is exposed only as MCP tools
 * (`aholo_generate_model_from_text` → poll `aholo_get_model`). MCP tools are
 * driven by an *agent*, not by browser JavaScript — a web page cannot call
 * them. So this demo deliberately has NO generation backend.
 *
 * Instead, the models below were generated ahead of time by an AI agent
 * (Claude Code) driving the Aholo MCP server; the resulting GLB meshes were
 * bundled into `public/models/`. This page is the *viewer* half of the loop:
 * it loads a GLB and lets you orbit it. The agent generates, the human
 * inspects — that split is the honest shape of an MCP-only pipeline.
 *
 * Viewer plumbing (mount + glTF load) lives in `@3d-incubators/viewer-helpers`.
 */

import {
  mountViewer,
  loadGltfFromUrl,
  type MountedViewer,
  type GltfHandle,
} from '@3d-incubators/viewer-helpers';
import {
  AmbientLight,
  DirectionalLight,
  setViewerConfig,
  Box3,
  Vector3,
  type Object3D,
} from '@manycore/aholo-viewer';

interface ObjectPrompt {
  id: string;
  label: string;
  /** The exact text prompt fed to aholo_generate_model_from_text. */
  prompt: string;
  /** The Lux3D `style` argument used for this generation. */
  style: string;
  /** Bundled GLB, served from public/. */
  file: string;
}

/**
 * The objects an agent has already generated. To add one: run
 * `aholo_generate_model_from_text`, poll `aholo_get_model`, drop the GLB into
 * `public/models/`, and add a row here.
 */
const PROMPTS: ObjectPrompt[] = [
  {
    id: 'cyberpunk-armchair',
    label: 'Cyberpunk armchair',
    prompt: 'a cyberpunk-style armchair, worn leather upholstery, glowing neon-blue trim, chrome frame',
    style: 'cyberpunk',
    file: '/models/cyberpunk-armchair.glb',
  },
  {
    id: 'ceramic-teapot',
    label: 'Ceramic teapot',
    prompt: 'a glossy ceramic teapot with a smooth bamboo handle, gentle curves',
    style: 'photorealistic',
    file: '/models/ceramic-teapot.glb',
  },
  {
    id: 'cartoon-robot',
    label: 'Cartoon robot',
    prompt: 'a friendly round cartoon robot companion with big glowing eyes and stubby arms',
    style: 'cartoon',
    file: '/models/cartoon-robot.glb',
  },
];

/** World-space length the longest axis of any model is scaled to. */
const TARGET_SIZE = 1.6;

// ---------- DOM ----------
const stageEl = document.getElementById('stage') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const controlsEl = document.getElementById('controls') as HTMLElement;

// ---------- Viewer ----------
setStatus('Booting viewer…');

const view: MountedViewer = mountViewer(stageEl, {
  // Lux3D GLBs are standard glTF (Y-up). We normalise every model to a uniform
  // size centred on the origin (see normalizeModel), so a single fixed framing
  // works for all of them. Override the viewer-helpers splat defaults.
  cameraUp: [0, 1, 0],
  cameraPosition: [1.7, 1.2, 2.15],
  cameraTarget: [0, 0, 0],
  // This demo renders glTF meshes, not Gaussian splats.
  splattingEnabled: false,
});
// The Lux3D meshes are fully metallic (glTF metallicFactor = 1), so they need
// an environment to reflect or they render black. Keep the viewer's sky for
// that, but switch off its ground grid — this is a floating-object viewer.
setViewerConfig(view.viewer, {
  pipeline: { Background: { enabled: true, ground: { enabled: false } } },
});

addLights(view);
view.start();

/** The currently displayed model, so we can dispose it before loading another. */
let current: GltfHandle | null = null;
/** Monotonic token so a slow load can't overwrite a newer one. */
let loadToken = 0;

renderControls();
void selectPrompt(PROMPTS[0].id);

// Dev-only: expose internals for headless QA (scripts/dev-screenshot.mjs).
if (import.meta.env.DEV) {
  (window as Window & { __demo?: unknown }).__demo = { view, PROMPTS };
}

// ---------- Behaviour ----------

async function selectPrompt(id: string): Promise<void> {
  const item = PROMPTS.find((p) => p.id === id);
  if (!item) return;
  const input = document.getElementById('prompt-input') as HTMLInputElement | null;
  if (input) input.value = item.prompt;
  highlightChip(id);
  await loadModel(item);
}

async function loadModel(item: ObjectPrompt): Promise<void> {
  const token = ++loadToken;
  setStatus(`Loading "${item.label}"…`);
  try {
    const handle = await loadGltfFromUrl(view, item.file);
    if (token !== loadToken) {
      handle.remove(); // a newer request superseded this one
      return;
    }
    normalizeModel(handle.scene);
    prepareForRender(handle.scene);
    if (import.meta.env.DEV) debugDump(handle.scene);
    current?.remove();
    current = handle;
    setStatus(`Loaded "${item.label}" — glTF mesh ready (see the notice above).`, 'ok');
  } catch (err) {
    if (token !== loadToken) return;
    setStatus(`Could not load "${item.label}": ${(err as Error).message}`, 'err');
  }
}

function onSubmit(): void {
  const input = document.getElementById('prompt-input') as HTMLInputElement;
  const text = input.value.trim();
  if (!text) return;
  const match = matchPrompt(text);
  if (match) {
    highlightChip(match.id);
    void loadModel(match);
  } else {
    highlightChip(null);
    setStatus(
      'No bundled model for that description. New objects are generated by an ' +
        'AI agent running the Aholo MCP server — not by this page. Pick an ' +
        'example below to view one the agent already made.',
      'err'
    );
  }
}

/**
 * Loose match: pick the prompt sharing the most words with the user's text.
 * Good enough to let "cyberpunk armchair" or "a teapot" resolve to a chip.
 */
function matchPrompt(text: string): ObjectPrompt | undefined {
  const norm = (s: string): string[] =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  const words = new Set(norm(text));
  let best: { item: ObjectPrompt; score: number } | undefined;
  for (const item of PROMPTS) {
    const score = norm(`${item.label} ${item.prompt}`).filter((w) => words.has(w)).length;
    if (score >= 2 && (!best || score > best.score)) best = { item, score };
  }
  return best?.item;
}

// ---------- 3D helpers ----------

/**
 * Centre a freshly-loaded model on the origin and scale it so its longest axis
 * is TARGET_SIZE. Lux3D meshes arrive at varying sizes, often resting on Y=0;
 * normalising means one camera framing fits all and orbiting stays centred.
 */
function normalizeModel(root: Object3D): void {
  const box = new Box3().setFromObject(root);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const s = TARGET_SIZE / maxDim;
  root.scale.set(s, s, s);
  // Scaling happens about the local origin, so the box centre moves to
  // center*s; translate back by that to sit the model on the world origin.
  root.position.set(-center.x * s, -center.y * s, -center.z * s);
}

/**
 * Compute bounding volumes for every geometry in a freshly-loaded model.
 * The viewer frustum-culls meshes on `geometry.boundingSphere`; glTF imports
 * arrive with it null, so without this the mesh is culled and never drawn
 * (objectInfo.calls stays 0).
 */
function prepareForRender(root: Object3D): void {
  const walk = (o: Object3D): void => {
    const node = o as Object3D & {
      geometry?: { computeBoundingBox?: () => void; computeBoundingSphere?: () => void };
      computeBoundingBox?: () => void;
      computeBoundingSphere?: () => void;
      children?: Object3D[];
    };
    node.geometry?.computeBoundingBox?.();
    node.geometry?.computeBoundingSphere?.();
    node.computeBoundingBox?.();
    node.computeBoundingSphere?.();
    for (const c of node.children ?? []) walk(c);
  };
  walk(root);
}

/** A GLB carries materials but no lights — add a key/fill/ambient rig. */
function addLights(v: MountedViewer): void {
  v.scene.add(new AmbientLight(0xffffff, 1.1));

  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4);
  v.scene.add(key);

  const fill = new DirectionalLight(0xbcd2ff, 0.9);
  fill.position.set(-4, 2, -3);
  v.scene.add(fill);
}

/** Dev-only: log camera aim + the model's post-normalize world bounds. */
function debugDump(root: Object3D): void {
  try {
    const f = (v: { x: number; y: number; z: number }): string =>
      `(${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)})`;
    const cam = view.viewer.getCamera() as unknown as {
      position: { x: number; y: number; z: number };
      getWorldDirection?: (v: Vector3) => { x: number; y: number; z: number };
      matrixWorld?: { elements: number[] };
    };
    console.log(`[dbg] camera.pos=${f(cam.position)}`);
    if (typeof cam.getWorldDirection === 'function') {
      console.log(`[dbg] camera.dir=${f(cam.getWorldDirection(new Vector3()))}`);
    } else if (cam.matrixWorld) {
      const e = cam.matrixWorld.elements;
      console.log(`[dbg] camera.fwd≈(${-e[8]},${-e[9]},${-e[10]})`);
    } else {
      console.log(`[dbg] camera keys=${Object.keys(cam).join(',')}`);
    }
    const r = root as unknown as {
      updateMatrixWorld?: (force?: boolean) => void;
      updateWorldMatrix?: (a: boolean, b: boolean) => void;
    };
    r.updateWorldMatrix?.(true, true);
    r.updateMatrixWorld?.(true);
    const box = new Box3().setFromObject(root);
    console.log(
      `[dbg] model worldBox center=${f(box.getCenter(new Vector3()))} ` +
        `size=${f(box.getSize(new Vector3()))}`
    );
  } catch (err) {
    console.log(`[dbg] ${(err as Error).message}`);
  }
}

// ---------- DOM rendering ----------

function renderControls(): void {
  controlsEl.innerHTML = `
    <div class="row">
      <div class="grow">
        <label for="prompt-input">Describe an object</label>
        <input id="prompt-input" type="text" placeholder="a cyberpunk-style armchair…" />
      </div>
      <button id="prompt-go" type="button">View in 3D</button>
    </div>
    <p class="hint">Generated by an AI agent via the Aholo MCP server:</p>
    <div class="chips">
      ${PROMPTS.map(
        (p) => `<button class="chip" type="button" data-id="${p.id}">${p.label}</button>`
      ).join('')}
    </div>
  `;

  (document.getElementById('prompt-go') as HTMLButtonElement).addEventListener('click', onSubmit);
  (document.getElementById('prompt-input') as HTMLInputElement).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSubmit();
  });
  for (const chip of document.querySelectorAll<HTMLButtonElement>('.chip')) {
    chip.addEventListener('click', () => void selectPrompt(chip.dataset.id ?? ''));
  }
}

function highlightChip(id: string | null): void {
  for (const chip of document.querySelectorAll<HTMLButtonElement>('.chip')) {
    chip.classList.toggle('chip-active', chip.dataset.id === id);
  }
}

function setStatus(text: string, kind: '' | 'ok' | 'err' = ''): void {
  statusEl.textContent = text;
  statusEl.className = `panel status${kind ? ' ' + kind : ''}`;
}
