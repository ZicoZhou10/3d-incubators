/* Vignette — multi-object scene assembled by an agent. */
/**
 * Demo 3 — Vignette
 *
 * The pattern this demo points at:
 *   An agent receives a high-level intent ("a cozy reading corner") and
 *   decomposes it into several discrete 3D objects (an armchair, a lamp, an
 *   ottoman, a book stack). Each is generated independently via the Aholo
 *   MCP server's Lux3D path, then placed into a single shared scene by an
 *   LLM auto-layout step that knows the components' bounding boxes and
 *   typical real-world heights.
 *
 *   This is the "Spatially-Grounded Agent" idea made tactile: the agent is
 *   not just producing one artefact, it is reasoning about a *set* of
 *   artefacts AND about the spatial relationships between them.
 *
 * Where the work happens:
 *   - Decomposition + Lux3D generation: offline, by an AI agent driving the
 *     Aholo MCP server. See `src/vignettes.ts` for the per-component prompts.
 *   - LLM layout: offline, via `scripts/layout-vignette.mjs` — outputs
 *     `public/scenes/<slug>/layout.json`.
 *   - This page: loads the GLBs + that layout.json and renders them together.
 *     User can orbit (drag) and zoom (scroll).
 */

import { mountViewer, loadGltfFromUrl } from '@3d-incubators/viewer-helpers';
import { AmbientLight, DirectionalLight, Vector3, type Object3D } from '@manycore/aholo-viewer';
import { VIGNETTES, type Vignette, type VignetteComponent, type VignetteLayout } from './vignettes.js';

// ---------- DOM ----------
const stageEl = el('stage');
const statusEl = el('status');
const controlsEl = el('controls');
const briefEl = el('brief');
const hintEl = el('hint');

// ---------- Viewer ----------
setStatus('Booting viewer…');
const view = mountViewer(stageEl, {
  cameraUp: [0, 1, 0],
  cameraPosition: [2.3, 1.4, 2.6],
  cameraTarget: [0, 0.5, 0.3],
  splattingEnabled: false,
  orbit: { rotateSpeed: 0.0055, zoomSpeed: 0.0012, minDistance: 1, maxDistance: 12 },
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
  resetComponentDots(vignette);
  hideHint();

  const token = ++loadToken;

  // Drop whatever's currently loaded so the scene doesn't double-stack.
  for (const { root } of loaded) view.scene.remove(root);
  loaded = [];

  setStatus(`Fetching layout for "${vignette.label}"…`);
  let layout: VignetteLayout;
  try {
    const res = await fetch(vignette.layoutUrl);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    layout = (await res.json()) as VignetteLayout;
  } catch (err) {
    setStatus(`Could not load layout.json: ${(err as Error).message}`, 'err');
    return;
  }
  if (token !== loadToken) return;

  // Aim the camera at the layout's framing.
  if (layout.camera) {
    view.camera.position.set(...layout.camera.position);
    view.camera.lookAt(new Vector3(...layout.camera.target));
    view.orbit?.setTarget(...layout.camera.target);
  }

  const layoutBySlot = new Map(layout.components.map((c) => [c.slot, c]));

  // Load every component in parallel; place each at the LLM's chosen transform.
  setStatus(`Loading ${vignette.components.length} components in parallel…`);
  await Promise.all(
    vignette.components.map(async (component) => {
      setComponentDot(component.slot, 'loading');
      try {
        const handle = await loadGltfFromUrl(view, component.file);
        if (token !== loadToken) {
          handle.remove();
          return;
        }
        const placement = layoutBySlot.get(component.slot);
        if (!placement) {
          throw new Error(`layout.json has no entry for slot "${component.slot}"`);
        }
        const root = handle.scene as Object3D;
        applyPlacement(root, placement);
        loaded.push({ component, root });
        setComponentDot(component.slot, 'ok');
      } catch (err) {
        setComponentDot(component.slot, 'err');
        setStatus(`Could not load ${component.slot}: ${(err as Error).message}`, 'err');
      }
    })
  );

  if (token !== loadToken) return;
  setStatus(`"${vignette.label}" — ${loaded.length} components assembled.`, 'ok');
  showHint();
}

function applyPlacement(
  root: Object3D,
  placement: VignetteLayout['components'][number]
): void {
  const { position, rotation, scale } = placement;
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
    <p class="hint">Pick a vignette an agent has already decomposed, generated, and laid out:</p>
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
      <div class="brief-label brief-label-row">
        <span>Decomposed into</span>
        <span class="dots" id="component-dots"></span>
      </div>
      <ul class="brief-list">
        ${v.components
          .map(
            (c) =>
              `<li><code data-slot="${escapeHtml(c.slot)}" class="slot-tag slot-pending">${escapeHtml(c.slot)}</code> — ${escapeHtml(c.prompt)}</li>`
          )
          .join('')}
      </ul>
    </div>
  `;
}

function resetComponentDots(v: Vignette): void {
  for (const tag of document.querySelectorAll<HTMLElement>('.slot-tag')) {
    tag.className = 'slot-tag slot-pending';
  }
  const dotsEl = document.getElementById('component-dots');
  if (dotsEl) {
    dotsEl.innerHTML = v.components.map(() => `<span class="dot dot-pending"></span>`).join('');
  }
}

function setComponentDot(slot: string, state: 'loading' | 'ok' | 'err'): void {
  const tag = document.querySelector<HTMLElement>(`.slot-tag[data-slot="${slot}"]`);
  if (tag) {
    tag.className = `slot-tag slot-${state}`;
  }
  // Update the inline dot counter too — find the matching dot by index.
  const slots = Array.from(document.querySelectorAll<HTMLElement>('.slot-tag')).map(
    (t) => t.dataset.slot
  );
  const idx = slots.indexOf(slot);
  const dot = document.querySelectorAll<HTMLElement>('.dot')[idx];
  if (dot) dot.className = `dot dot-${state}`;
}

function highlightChip(id: string): void {
  for (const chip of document.querySelectorAll<HTMLButtonElement>('.chip')) {
    chip.classList.toggle('chip-active', chip.dataset.id === id);
  }
}

function showHint(): void {
  hintEl.classList.add('hint-visible');
}

function hideHint(): void {
  hintEl.classList.remove('hint-visible');
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
