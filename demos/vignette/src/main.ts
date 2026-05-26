/* Vignette — multi-object scene assembled by an agent. */
/**
 * Demo 3 — Vignette
 *
 * The pattern this demo points at:
 *   An agent receives a high-level intent ("a cozy reading corner") and
 *   decomposes it into several discrete 3D objects (an armchair, a lamp, an
 *   ottoman, a book stack). Each is generated independently via the Aholo
 *   MCP server's Lux3D path, then placed into a single shared scene.
 *
 *   This is the "Spatially-Grounded Agent" idea made tactile: the agent is
 *   not just producing one artefact, it is reasoning about a *set* of
 *   artefacts and the relationships between them.
 *
 * Where the work happens:
 *   - Decomposition + Lux3D generation: offline, by an AI agent driving the
 *     Aholo MCP server (aholo_generate_model_from_text → poll →
 *     aholo_get_model_textured_glb). See `src/vignettes.ts` for the per-
 *     component prompts the agent used.
 *   - Placement (transforms): hand-curated after eyeballing the generated
 *     GLBs. This step could in principle be automated, but spatial
 *     composition by an LLM is its own demo (and not what this one is for).
 *   - This page: loads the GLBs at the curated transforms and renders them
 *     together.
 */

import { mountViewer, loadGltfFromUrl } from '@3d-incubators/viewer-helpers';
import { AmbientLight, DirectionalLight, Vector3, type Object3D } from '@manycore/aholo-viewer';
import { VIGNETTES, type Vignette, type VignetteComponent } from './vignettes.js';

// ---------- DOM ----------
const stageEl = el('stage');
const statusEl = el('status');
const controlsEl = el('controls');
const briefEl = el('brief');

// ---------- Viewer ----------
setStatus('Booting viewer…');
const view = mountViewer(stageEl, {
  cameraUp: [0, 1, 0],
  cameraPosition: [3.5, 2.4, 4.5],
  cameraTarget: [0, 0.6, 0],
  splattingEnabled: false,
});
addLights();
view.start();

// ---------- State ----------
interface LoadedComponent {
  component: VignetteComponent;
  root: Object3D;
}
let loaded: LoadedComponent[] = [];
let loadToken = 0;

renderControls();
void selectVignette(VIGNETTES[0].id);

// ---------- Behaviour ----------

async function selectVignette(id: string): Promise<void> {
  const vignette = VIGNETTES.find((v) => v.id === id);
  if (!vignette) return;
  highlightChip(id);
  showBrief(vignette);

  const token = ++loadToken;
  setStatus(`Loading vignette "${vignette.label}" — ${vignette.components.length} components…`);

  // Drop whatever's loaded.
  for (const { root } of loaded) view.scene.remove(root);
  loaded = [];

  // Aim the camera at the vignette's framing.
  const cam = view.camera;
  cam.position.set(...vignette.camera.position);
  cam.lookAt(new Vector3(...vignette.camera.target));

  // Load components in parallel; place each at its curated transform.
  let loadedCount = 0;
  await Promise.all(
    vignette.components.map(async (component) => {
      try {
        const handle = await loadGltfFromUrl(view, component.file);
        if (token !== loadToken) {
          handle.remove();
          return;
        }
        const root = handle.scene as Object3D;
        applyTransform(root, component);
        loaded.push({ component, root });
        loadedCount += 1;
        setStatus(
          `Loaded ${loadedCount} / ${vignette.components.length} — placing "${component.slot}"…`
        );
      } catch (err) {
        setStatus(`Could not load ${component.slot}: ${(err as Error).message}`, 'err');
      }
    })
  );

  if (token !== loadToken) return;
  setStatus(`"${vignette.label}" — ${loaded.length} components assembled.`, 'ok');
}

function applyTransform(root: Object3D, component: VignetteComponent): void {
  const { position, rotation, scale } = component.transform;
  const node = root as Object3D & {
    position: { set: (x: number, y: number, z: number) => void };
    rotation: { set: (x: number, y: number, z: number) => void };
    scale: { set: (x: number, y: number, z: number) => void };
  };
  node.position.set(position[0], position[1], position[2]);
  node.rotation.set(rotation[0], rotation[1], rotation[2]);
  node.scale.set(scale, scale, scale);
}

function addLights(): void {
  view.scene.add(new AmbientLight(0xffffff, 1.0));
  const key = new DirectionalLight(0xffffff, 2.0);
  key.position.set(3, 5, 4);
  view.scene.add(key);
  const fill = new DirectionalLight(0xbcd2ff, 0.7);
  fill.position.set(-4, 2, -3);
  view.scene.add(fill);
  const back = new DirectionalLight(0xffe7c2, 0.5);
  back.position.set(-2, 3, 5);
  view.scene.add(back);
}

// ---------- DOM rendering ----------

function renderControls(): void {
  controlsEl.innerHTML = `
    <p class="hint">Pick a vignette an agent has already decomposed and generated:</p>
    <div class="chips">
      ${VIGNETTES.map(
        (v) => `<button class="chip" type="button" data-id="${v.id}">${escapeHtml(v.label)}</button>`
      ).join('')}
    </div>
  `;
  for (const chip of document.querySelectorAll<HTMLButtonElement>('.chip')) {
    chip.addEventListener('click', () => void selectVignette(chip.dataset.id ?? ''));
  }
}

function showBrief(v: Vignette): void {
  briefEl.innerHTML = `
    <div class="brief">
      <div class="brief-label">Brief</div>
      <div class="brief-body">${escapeHtml(v.brief)}</div>
      <div class="brief-label" style="margin-top:8px">Decomposed into</div>
      <ul class="brief-list">
        ${v.components
          .map((c) => `<li><code>${escapeHtml(c.slot)}</code> — ${escapeHtml(c.prompt)}</li>`)
          .join('')}
      </ul>
    </div>
  `;
}

function highlightChip(id: string): void {
  for (const chip of document.querySelectorAll<HTMLButtonElement>('.chip')) {
    chip.classList.toggle('chip-active', chip.dataset.id === id);
  }
}

function setStatus(text: string, kind: '' | 'ok' | 'err' = ''): void {
  statusEl.textContent = text;
  statusEl.className = `panel status${kind ? ' ' + kind : ''}`;
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}
