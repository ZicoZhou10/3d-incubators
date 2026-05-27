/* Diorama — assemble small 3D scenes from a library of agent-generated parts.
 *
 * State machine:
 *   compose → rolling → variants → scene → (compose | rolling)
 *
 * Settings (API key) and URL state (?#s=<encoded>) live outside the state
 * machine and don't take a screen of their own.
 */

import { mountViewer, loadGltfFromUrl } from '@3d-incubators/viewer-helpers';
import {
  AmbientLight,
  DirectionalLight,
  Vector3,
  setViewerConfig,
  Color,
  BackgroundMode,
  type Object3D,
} from '@manycore/aholo-viewer';
import {
  loadCatalog,
  findPack,
  findComponent,
  componentsByCategory,
  uniformScale,
  type Catalog,
  type Pack,
  type Component,
} from './library.js';
import { generateVariants, type VariantLayout, type VariantSet, type Placement } from './llm.js';
import {
  readSceneFromUrl,
  writeSceneToUrl,
  clearSceneUrl,
  getApiKey,
  setApiKey,
  clearApiKey,
} from './state.js';

type Screen = 'compose' | 'rolling' | 'variants' | 'scene';

interface ComposerState {
  packId: string;
  vibes: string[];
  rooms: string[];
  musthaves: string[];
  refine: string;
}

interface AppState {
  screen: Screen;
  catalog: Catalog;
  composer: ComposerState;
  lastVariantSet: VariantSet | null;
  scene: VariantLayout | null;
}

const $ = (id: string): HTMLElement => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`#${id} missing`);
  return e;
};

// ---------- viewer (mounted once, reused across scene renders) ----------

const stageEl = $('stage');
const view = mountViewer(stageEl, {
  cameraUp: [0, 1, 0],
  cameraPosition: [3, 1.5, 3],
  cameraTarget: [0, 0.5, 0],
  splattingEnabled: false,
  orbit: { rotateSpeed: 0.0055, zoomSpeed: 0.0012, minDistance: 1, maxDistance: 15 },
});
setViewerConfig(view.viewer, {
  pipeline: {
    Background: {
      enabled: true,
      ground: { enabled: false },
      background: {
        active: BackgroundMode.BasicBackground,
        basic: { color: new Color(0.08, 0.08, 0.1), alpha: 1 },
      },
    },
  },
});
view.scene.add(new AmbientLight(0xffffff, 0.85));
const key = new DirectionalLight(0xffffff, 1.8);
key.position.set(3, 5, 4);
view.scene.add(key);
const fill = new DirectionalLight(0xb6d8ff, 0.55);
fill.position.set(-4, 2, -3);
view.scene.add(fill);
const back = new DirectionalLight(0xffc7a8, 0.35);
back.position.set(-2, 3, 5);
view.scene.add(back);
view.start();

// ---------- state ----------

let state: AppState;

void boot();

async function boot(): Promise<void> {
  let catalog: Catalog;
  try {
    catalog = await loadCatalog();
  } catch (err) {
    showFatal(`Could not load library: ${(err as Error).message}`);
    return;
  }

  const urlScene = readSceneFromUrl();
  state = {
    screen: urlScene ? 'scene' : 'compose',
    catalog,
    composer: defaultComposer(catalog),
    lastVariantSet: null,
    scene: urlScene,
  };

  renderApiKeyChip();
  if (urlScene) {
    renderScene(urlScene);
  } else {
    renderCompose();
  }
}

function defaultComposer(catalog: Catalog): ComposerState {
  const firstPack = catalog.packs[0]!;
  return { packId: firstPack.id, vibes: [], rooms: [], musthaves: [], refine: '' };
}

// ---------- COMPOSE screen ----------

function renderCompose(): void {
  setScreen('compose');
  const pack = findPack(state.catalog, state.composer.packId)!;
  const sec = $('compose');

  sec.innerHTML = `
    <div class="composer">
      <header class="composer-head">
        <p class="eyebrow">step 01 / brief</p>
        <h2 class="screen-title">What scene do you want to assemble?</h2>
        <p class="subtitle">
          Pick a pack, add a vibe, pin must-haves, and refine in your own words.
          We'll roll three different compositions.
        </p>
      </header>

      <fieldset class="field">
        <legend>Pack</legend>
        <div class="chips" id="chips-pack">
          ${state.catalog.packs
            .map(
              (p) => `
                <label class="chip chip-radio ${p.id === state.composer.packId ? 'is-on' : ''}">
                  <input type="radio" name="pack" value="${esc(p.id)}" ${p.id === state.composer.packId ? 'checked' : ''} />
                  <span class="chip-label">${esc(p.label)}</span>
                  <span class="chip-meta">${esc(p.tagline)}</span>
                </label>
              `
            )
            .join('')}
        </div>
      </fieldset>

      <fieldset class="field">
        <legend>Vibe <span class="legend-hint">(any)</span></legend>
        <div class="chips" id="chips-vibe">
          ${pack.vibes.map((v) => chipHtml(v, state.composer.vibes.includes(v))).join('')}
        </div>
      </fieldset>

      <fieldset class="field">
        <legend>Room <span class="legend-hint">(pick one or leave blank)</span></legend>
        <div class="chips" id="chips-room">
          ${pack.rooms
            .map((r) => chipHtml(r, state.composer.rooms.includes(r), 'single-room'))
            .join('')}
        </div>
      </fieldset>

      <fieldset class="field">
        <legend>Must-have components <span class="legend-hint">(any from the library)</span></legend>
        <div class="chips chips-components" id="chips-musthave">
          ${pack.components
            .map(
              (c) => `
                <label class="chip chip-component ${state.composer.musthaves.includes(c.id) ? 'is-on' : ''}">
                  <input type="checkbox" value="${esc(c.id)}" ${state.composer.musthaves.includes(c.id) ? 'checked' : ''} />
                  <span class="chip-cat">${esc(c.category)}</span>
                  <span class="chip-label">${esc(c.label)}</span>
                </label>
              `
            )
            .join('')}
        </div>
      </fieldset>

      <fieldset class="field">
        <legend>Refine <span class="legend-hint">(your own words — optional)</span></legend>
        <textarea id="refine" rows="3" placeholder="e.g. dimly lit, late-night vibe, monitors face the chair...">${esc(state.composer.refine)}</textarea>
      </fieldset>

      <div class="actions">
        <button type="button" id="roll" class="btn btn-primary">
          <span>Roll 3 variants</span>
          <span class="btn-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  `;

  // Wire up
  for (const radio of sec.querySelectorAll<HTMLInputElement>('input[name="pack"]')) {
    radio.addEventListener('change', () => {
      state.composer.packId = radio.value;
      // changing pack resets vibe/room/musthave selections (they're pack-specific)
      state.composer.vibes = [];
      state.composer.rooms = [];
      state.composer.musthaves = [];
      renderCompose();
    });
  }
  for (const cb of sec.querySelectorAll<HTMLInputElement>('#chips-vibe input[type="checkbox"]')) {
    cb.addEventListener('change', () => toggleArr(state.composer.vibes, cb.value, cb.checked));
  }
  for (const cb of sec.querySelectorAll<HTMLInputElement>('#chips-room input[type="checkbox"]')) {
    cb.addEventListener('change', () => {
      if (cb.checked) {
        state.composer.rooms = [cb.value];
        for (const other of sec.querySelectorAll<HTMLInputElement>('#chips-room input[type="checkbox"]')) {
          if (other !== cb) {
            other.checked = false;
            other.parentElement?.classList.remove('is-on');
          }
        }
      } else {
        state.composer.rooms = [];
      }
      cb.parentElement?.classList.toggle('is-on', cb.checked);
    });
  }
  for (const cb of sec.querySelectorAll<HTMLInputElement>('#chips-musthave input[type="checkbox"]')) {
    cb.addEventListener('change', () => {
      toggleArr(state.composer.musthaves, cb.value, cb.checked);
      cb.parentElement?.classList.toggle('is-on', cb.checked);
    });
  }
  // mark vibe chip on/off styling
  for (const cb of sec.querySelectorAll<HTMLInputElement>('#chips-vibe input[type="checkbox"]')) {
    cb.addEventListener('change', () => {
      cb.parentElement?.classList.toggle('is-on', cb.checked);
    });
  }

  ($('refine') as HTMLTextAreaElement).addEventListener('input', (e) => {
    state.composer.refine = (e.target as HTMLTextAreaElement).value;
  });

  $('roll').addEventListener('click', () => void onRoll());
}

function chipHtml(value: string, on: boolean, _kind = ''): string {
  return `
    <label class="chip ${on ? 'is-on' : ''}">
      <input type="checkbox" value="${esc(value)}" ${on ? 'checked' : ''} />
      <span class="chip-label">${esc(value)}</span>
    </label>
  `;
}

function toggleArr<T>(arr: T[], v: T, on: boolean): void {
  if (on) {
    if (!arr.includes(v)) arr.push(v);
  } else {
    const i = arr.indexOf(v);
    if (i >= 0) arr.splice(i, 1);
  }
}

function composeBrief(c: ComposerState): string {
  const parts: string[] = [];
  if (c.vibes.length > 0) parts.push(`Vibe: ${c.vibes.join(', ')}`);
  if (c.rooms.length > 0) parts.push(`Room type: ${c.rooms.join(', ')}`);
  if (c.refine.trim()) parts.push(c.refine.trim());
  if (parts.length === 0) parts.push('A small evocative scene from this pack.');
  return parts.join('. ');
}

// ---------- ROLLING screen ----------

async function onRoll(rerollVariantNames?: string[]): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) {
    openApiKeyModal();
    return;
  }
  const brief = composeBrief(state.composer);
  setScreen('rolling');
  const rolling = $('rolling');
  rolling.innerHTML = `
    <div class="rolling">
      <p class="eyebrow">step 02 / rolling</p>
      <h2 class="screen-title">Composing three variants…</h2>
      <p class="subtitle">${esc(brief)}</p>
      <ul class="rolling-dots"><li></li><li></li><li></li></ul>
    </div>
  `;
  try {
    const variantSet = await generateVariants({
      apiKey,
      brief,
      catalog: state.catalog,
      packId: state.composer.packId,
      pinned: state.composer.musthaves,
      previousVariantNames: rerollVariantNames,
    });
    state.lastVariantSet = variantSet;
    renderVariants(variantSet);
  } catch (err) {
    renderRollError(brief, (err as Error).message);
  }
}

function renderRollError(brief: string, msg: string): void {
  const rolling = $('rolling');
  rolling.innerHTML = `
    <div class="rolling">
      <p class="eyebrow">step 02 / rolling — error</p>
      <h2 class="screen-title">Roll failed.</h2>
      <p class="subtitle">${esc(brief)}</p>
      <pre class="error">${esc(msg)}</pre>
      <div class="actions">
        <button type="button" id="back-to-compose" class="btn">Back to brief</button>
        <button type="button" id="retry-roll" class="btn btn-primary">Try again</button>
      </div>
    </div>
  `;
  $('back-to-compose').addEventListener('click', () => renderCompose());
  $('retry-roll').addEventListener('click', () => void onRoll());
}

// ---------- VARIANTS screen ----------

function renderVariants(set: VariantSet): void {
  setScreen('variants');
  const pack = findPack(state.catalog, set.packId)!;
  const sec = $('variants');
  sec.innerHTML = `
    <header class="variants-head">
      <div>
        <p class="eyebrow">step 03 / pick a variant</p>
        <h2 class="screen-title">Three takes on your brief.</h2>
        <p class="subtitle">${esc(set.brief)}</p>
      </div>
      <div class="variants-actions">
        <button type="button" id="reroll" class="btn">Re-roll</button>
        <button type="button" id="edit-brief" class="btn btn-ghost">Edit brief</button>
      </div>
    </header>
    <ol class="variant-cards" id="variant-cards">
      ${set.variants
        .map(
          (v, i) => `
            <li class="variant-card" data-i="${i}">
              <header class="vc-head">
                <span class="vc-letter">${String.fromCharCode(65 + i)}</span>
                <h3 class="vc-name">${esc(v.name)}</h3>
              </header>
              <div class="vc-schematic">${renderSchematic(v, pack)}</div>
              <p class="vc-narrative">${esc(v.narrative)}</p>
              <ul class="vc-parts">
                ${v.components
                  .map((c) => {
                    const comp = findComponent(pack, c.componentId);
                    return `
                      <li>
                        <span class="vc-part-cat">${esc(comp?.category ?? '')}</span>
                        <span class="vc-part-label">${esc(comp?.label ?? c.componentId)}</span>
                      </li>
                    `;
                  })
                  .join('')}
              </ul>
              <button type="button" class="btn btn-primary vc-pick" data-i="${i}">
                <span>Open in 3D</span>
                <span class="btn-arrow" aria-hidden="true">→</span>
              </button>
            </li>
          `
        )
        .join('')}
    </ol>
  `;
  for (const btn of sec.querySelectorAll<HTMLButtonElement>('.vc-pick')) {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.i);
      const v = set.variants[i];
      if (v) {
        state.scene = v;
        writeSceneToUrl(v);
        renderScene(v);
      }
    });
  }
  $('reroll').addEventListener('click', () =>
    void onRoll(set.variants.map((v) => v.name))
  );
  $('edit-brief').addEventListener('click', () => renderCompose());
}

/** Top-down 2D SVG of the variant for at-a-glance comparison. */
function renderSchematic(v: VariantLayout, pack: Pack): string {
  const W = 200;
  const H = 140;
  // World half-extent: pick by farthest component
  let half = 1.5;
  for (const c of v.components) {
    half = Math.max(half, Math.abs(c.position[0]) + 0.5, Math.abs(c.position[2]) + 0.5);
  }
  half = Math.min(half, 3.5);
  const sx = (x: number): number => (W / 2) + (x / half) * (W / 2 - 6);
  const sz = (z: number): number => (H / 2) + (z / half) * (H / 2 - 6);

  const catColor: Record<string, string> = {
    seat: '#d96b6b',
    light: '#ffcf6b',
    surface: '#7ea8ff',
    work: '#9eebff',
    decor: '#b8b8b8',
  };

  let rects = '';
  for (const c of v.components) {
    const comp = findComponent(pack, c.componentId);
    if (!comp) continue;
    const scale = uniformScale(comp);
    const w = comp.bbox.size[0] * scale;
    const d = comp.bbox.size[2] * scale;
    const cx = sx(c.position[0]);
    const cz = sz(c.position[2]);
    const ww = (w / half) * (W / 2 - 6);
    const dd = (d / half) * (H / 2 - 6);
    const rot = (c.rotation[1] * 180) / Math.PI;
    const fill = catColor[comp.category] ?? '#ccc';
    rects += `<g transform="translate(${cx} ${cz}) rotate(${rot})">
      <rect x="${-ww / 2}" y="${-dd / 2}" width="${ww}" height="${dd}"
        fill="${fill}" fill-opacity="0.32" stroke="${fill}" stroke-width="1.2"/>
    </g>`;
  }

  // camera marker
  const cx = sx(v.camera.position[0]);
  const cz = sz(v.camera.position[2]);
  const tx = sx(v.camera.target[0]);
  const tz = sz(v.camera.target[2]);

  return `
    <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="top-down schematic">
      <rect x="0" y="0" width="${W}" height="${H}" fill="#0e0e12"/>
      <g stroke="#1f1f28" stroke-width="0.5">
        ${Array.from({ length: 5 }, (_, i) => {
          const x = (i + 1) * (W / 6);
          return `<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`;
        }).join('')}
        ${Array.from({ length: 3 }, (_, i) => {
          const y = (i + 1) * (H / 4);
          return `<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`;
        }).join('')}
      </g>
      ${rects}
      <line x1="${cx}" y1="${cz}" x2="${tx}" y2="${tz}" stroke="#fff" stroke-width="0.8" stroke-dasharray="2 3" opacity="0.6"/>
      <circle cx="${cx}" cy="${cz}" r="2.5" fill="#fff" opacity="0.85"/>
    </svg>
  `;
}

// ---------- SCENE screen ----------

const loadedRoots: Map<string, Object3D> = new Map();

async function renderScene(layout: VariantLayout): Promise<void> {
  setScreen('scene');
  state.scene = layout;
  const pack = findPack(state.catalog, layout.packId);
  if (!pack) {
    showFatal(`Pack ${layout.packId} not in catalog`);
    return;
  }

  const sec = $('scene');
  sec.innerHTML = `
    <header class="scene-head">
      <div>
        <p class="eyebrow">step 04 / scene · ${esc(pack.label)}</p>
        <h2 class="screen-title">${esc(layout.name)}</h2>
        <p class="subtitle">${esc(layout.narrative)}</p>
      </div>
      <div class="scene-actions">
        ${state.lastVariantSet ? '<button type="button" id="back-variants" class="btn btn-ghost">Back to variants</button>' : ''}
        <button type="button" id="reroll-set" class="btn">Re-roll</button>
        <button type="button" id="edit-brief2" class="btn btn-ghost">Edit brief</button>
        <button type="button" id="share" class="btn btn-primary">
          <span id="share-label">Copy share link</span>
        </button>
      </div>
    </header>
    <section class="scene-panel">
      <p class="panel-eyebrow">components in this scene</p>
      <ul class="scene-parts" id="scene-parts"></ul>
    </section>
  `;

  await loadLayoutIntoViewer(layout, pack);
  renderSceneParts(layout, pack);
  view.camera.position.set(...layout.camera.position);
  view.camera.lookAt(new Vector3(...layout.camera.target));
  view.orbit?.setTarget(...layout.camera.target);

  ($('share') as HTMLButtonElement).addEventListener('click', () => void onShare());
  $('reroll-set').addEventListener('click', () => void onRoll(state.lastVariantSet?.variants.map((v) => v.name)));
  $('edit-brief2').addEventListener('click', () => renderCompose());
  const back = document.getElementById('back-variants');
  if (back && state.lastVariantSet) {
    back.addEventListener('click', () => renderVariants(state.lastVariantSet!));
  }
}

async function loadLayoutIntoViewer(layout: VariantLayout, pack: Pack): Promise<void> {
  // Remove existing roots.
  for (const [, root] of loadedRoots) view.scene.remove(root);
  loadedRoots.clear();

  await Promise.all(
    layout.components.map(async (placement) => {
      const comp = findComponent(pack, placement.componentId);
      if (!comp) return;
      try {
        const handle = await loadGltfFromUrl(view, comp.file);
        applyPlacement(handle.scene as Object3D, placement, comp);
        loadedRoots.set(placement.componentId, handle.scene as Object3D);
      } catch (err) {
        console.error(`load ${comp.id}:`, err);
      }
    })
  );
}

function applyPlacement(root: Object3D, placement: Placement, component: Component): void {
  const s = uniformScale(component);
  const node = root as Object3D & {
    position: { set: (x: number, y: number, z: number) => void };
    rotation: { set: (x: number, y: number, z: number) => void };
    scale: { set: (x: number, y: number, z: number) => void };
  };
  node.position.set(placement.position[0], placement.position[1], placement.position[2]);
  node.rotation.set(placement.rotation[0], placement.rotation[1], placement.rotation[2]);
  node.scale.set(s, s, s);
}

function renderSceneParts(layout: VariantLayout, pack: Pack): void {
  const list = $('scene-parts');
  list.innerHTML = layout.components
    .map((c, i) => {
      const comp = findComponent(pack, c.componentId);
      const swaps = comp ? componentsByCategory(pack, comp.category).filter((s) => s.id !== comp.id) : [];
      return `
        <li class="scene-part" data-i="${i}">
          <header>
            <span class="sp-no">Nº ${String(i + 1).padStart(2, '0')}</span>
            <span class="sp-cat">${esc(comp?.category ?? '')}</span>
            <span class="sp-label">${esc(comp?.label ?? c.componentId)}</span>
          </header>
          <p class="sp-rationale">${esc(c.rationale || '—')}</p>
          ${
            swaps.length > 0
              ? `<div class="sp-actions">
                  <span class="sp-action-label">swap →</span>
                  ${swaps
                    .map(
                      (s) => `<button type="button" class="sp-swap" data-i="${i}" data-to="${esc(s.id)}">${esc(s.label)}</button>`
                    )
                    .join('')}
                </div>`
              : ''
          }
        </li>
      `;
    })
    .join('');

  for (const btn of list.querySelectorAll<HTMLButtonElement>('.sp-swap')) {
    btn.addEventListener('click', () => {
      const i = Number(btn.dataset.i);
      const to = btn.dataset.to!;
      onSwap(i, to);
    });
  }
}

function onSwap(componentIndex: number, toComponentId: string): void {
  if (!state.scene) return;
  const placement = state.scene.components[componentIndex];
  if (!placement) return;
  const updated: VariantLayout = {
    ...state.scene,
    components: state.scene.components.map((p, i) =>
      i === componentIndex ? { ...p, componentId: toComponentId, rationale: `swapped in ${toComponentId}` } : p
    ),
  };
  writeSceneToUrl(updated);
  void renderScene(updated);
}

async function onShare(): Promise<void> {
  const url = window.location.href;
  const label = $('share-label');
  try {
    await navigator.clipboard.writeText(url);
    label.textContent = 'Link copied';
    setTimeout(() => (label.textContent = 'Copy share link'), 1800);
  } catch {
    label.textContent = 'Copy failed';
    setTimeout(() => (label.textContent = 'Copy share link'), 1800);
  }
}

// ---------- screen switching ----------

function setScreen(s: Screen): void {
  state.screen = s;
  document.body.dataset.screen = s;
  for (const id of ['compose', 'rolling', 'variants', 'scene']) {
    $(id).dataset.active = id === s ? 'true' : 'false';
  }
}

// ---------- API key modal ----------

function renderApiKeyChip(): void {
  const chip = $('api-key-chip');
  const present = !!getApiKey();
  chip.dataset.present = present ? 'true' : 'false';
  chip.textContent = present ? 'API key · set' : 'Set API key';
  chip.onclick = (): void => openApiKeyModal();
}

function openApiKeyModal(): void {
  const modal = $('modal');
  modal.dataset.state = 'open';
  modal.innerHTML = `
    <div class="modal-card">
      <header class="modal-head">
        <h3>Anthropic API key</h3>
        <button type="button" class="modal-close" id="modal-close">×</button>
      </header>
      <p class="modal-body">
        Diorama calls the Anthropic API from your browser to generate variant layouts.
        Your key stays in this browser (localStorage) — it never reaches a server we run.
      </p>
      <input type="password" id="api-key-input" class="modal-input"
        placeholder="sk-ant-..." autocomplete="off"
        value="${esc(getApiKey() ?? '')}" />
      <div class="modal-actions">
        ${getApiKey() ? '<button type="button" id="clear-key" class="btn btn-ghost">Forget</button>' : ''}
        <button type="button" id="save-key" class="btn btn-primary">Save</button>
      </div>
      <p class="modal-foot">
        Don't have a key? <a href="https://console.anthropic.com/" target="_blank" rel="noreferrer">console.anthropic.com</a>
      </p>
    </div>
  `;
  $('modal-close').addEventListener('click', closeModal);
  $('save-key').addEventListener('click', () => {
    const v = ($('api-key-input') as HTMLInputElement).value.trim();
    if (v) {
      setApiKey(v);
      renderApiKeyChip();
      closeModal();
    }
  });
  const clear = document.getElementById('clear-key');
  if (clear) {
    clear.addEventListener('click', () => {
      clearApiKey();
      renderApiKeyChip();
      closeModal();
    });
  }
}

function closeModal(): void {
  const m = $('modal');
  m.dataset.state = 'closed';
  m.innerHTML = '';
}

// ---------- error helpers ----------

function showFatal(msg: string): void {
  document.body.innerHTML = `<pre style="padding:2rem;font:14px ui-monospace,monospace;color:#fff;background:#0e0e12">${esc(msg)}</pre>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}

// ---------- "edit brief" should not strand the URL hash ----------

window.addEventListener('hashchange', () => {
  // ignore — we write the hash, we don't react to user edits
});

// Pressing "Edit brief" from scene clears the URL hash.
const observer = new MutationObserver(() => {
  if (state?.screen === 'compose') clearSceneUrl();
});
observer.observe(document.body, { attributes: true, attributeFilter: ['data-screen'] });
