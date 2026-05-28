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
import { generateVariantsLocal } from './localLayout.js';
import {
  loadEnvironment,
  loadSplatForCalibration,
  applyTransform,
  type EnvTransform,
  type EnvHandle,
} from './environment.js';
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
  splattingEnabled: true, // needed for 3DGS environment shells; no-op when no splat
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

  // Dev tool: ?calibrate=<packId> drops into the splat calibration panel.
  const params = new URLSearchParams(location.search);
  const calibratePack = params.get('calibrate');
  if (calibratePack !== null) {
    renderCalibration(calibratePack || state.catalog.packs[0]!.id);
    return;
  }
  // Dev tool: ?layout=<packId> drops into the per-component layout editor.
  const layoutPack = params.get('layout');
  if (layoutPack !== null) {
    void renderLayoutEditor(layoutPack || state.catalog.packs[0]!.id);
    return;
  }

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

let rollCounter = 0;

async function onRoll(rerollVariantNames?: string[]): Promise<void> {
  const apiKey = getApiKey();
  const useLocal = !apiKey;
  const brief = composeBrief(state.composer);
  setScreen('rolling');
  const rolling = $('rolling');
  rolling.innerHTML = `
    <div class="rolling">
      <p class="eyebrow">step 02 / rolling${useLocal ? ' · local mode' : ' · anthropic'}</p>
      <h2 class="screen-title">Composing three variants…</h2>
      <p class="subtitle">${esc(brief)}</p>
      <ul class="rolling-dots"><li></li><li></li><li></li></ul>
      ${
        useLocal
          ? `<p class="rolling-note">No API key — composing with the built-in local layout engine.
             <button type="button" id="add-key-inline" class="link-btn">Add an Anthropic key</button>
             for AI variants that read your refine text.</p>`
          : ''
      }
    </div>
  `;
  if (useLocal) {
    document.getElementById('add-key-inline')?.addEventListener('click', () => openApiKeyModal());
  }
  try {
    let variantSet: VariantSet;
    if (useLocal) {
      rollCounter++;
      variantSet = generateVariantsLocal({
        brief,
        catalog: state.catalog,
        packId: state.composer.packId,
        pinned: state.composer.musthaves,
        vibe: state.composer.vibes[0],
        seed: Date.now() + rollCounter,
      });
      await wait(450); // let the rolling animation read as intentional
    } else {
      variantSet = await generateVariants({
        apiKey: apiKey!,
        brief,
        catalog: state.catalog,
        packId: state.composer.packId,
        pinned: state.composer.musthaves,
        previousVariantNames: rerollVariantNames,
      });
    }
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
let loadedEnv: EnvHandle | null = null;

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

  await loadEnvironmentForPack(pack);
  await loadLayoutIntoViewer(layout, pack);
  renderSceneParts(layout, pack);

  // Camera: prefer the room's framing when there's an environment shell,
  // otherwise the variant's own framing.
  const cam = pack.environment?.camera ?? layout.camera;
  view.camera.position.set(...cam.position);
  view.camera.lookAt(new Vector3(...cam.target));
  view.orbit?.setTarget(...cam.target);

  ($('share') as HTMLButtonElement).addEventListener('click', () => void onShare());
  $('reroll-set').addEventListener('click', () => void onRoll(state.lastVariantSet?.variants.map((v) => v.name)));
  $('edit-brief2').addEventListener('click', () => renderCompose());
  const back = document.getElementById('back-variants');
  if (back && state.lastVariantSet) {
    back.addEventListener('click', () => renderVariants(state.lastVariantSet!));
  }
}

let loadedEnvPackId: string | null = null;

async function loadEnvironmentForPack(pack: Pack): Promise<void> {
  // The splat is heavy (~24 MB + a worker parse). Keep it across re-rolls and
  // swaps within the same pack; only tear down when the pack actually changes.
  if (loadedEnvPackId === pack.id && loadedEnv) return;
  if (loadedEnv) {
    loadedEnv.remove();
    loadedEnv = null;
    loadedEnvPackId = null;
  }
  if (!pack.environment) return;
  try {
    loadedEnv = await loadEnvironment(view, pack.environment);
    loadedEnvPackId = pack.id;
  } catch (err) {
    console.error(`environment load (${pack.id}):`, err);
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

// ---------- Calibration (dev tool: ?calibrate=<packId>&splat=<url>) ----------
//
// Drag the splat into our metric Y-up frame using the reference props as a
// ruler (neon lamp = 1.65 m). When the splat floor meets the props' bases and
// the room reads life-size, hit "Copy JSON" and paste the transform + camera
// into the pack's `environment` in catalog.json.

interface CalibSliderDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  get: () => number;
  set: (v: number) => void;
  fmt?: (v: number) => string;
}

async function renderCalibration(packId: string): Promise<void> {
  const pack = findPack(state.catalog, packId);
  setScreen('scene'); // reuse scene screen so the stage canvas is visible
  $('scene').innerHTML = '';

  const params = new URLSearchParams(location.search);
  const initialUrl = params.get('splat') ?? pack?.environment?.splatUrl ?? '';

  const calib: EnvTransform = pack?.environment
    ? {
        position: [...pack.environment.transform.position],
        rotation: [...pack.environment.transform.rotation],
        scale: pack.environment.transform.scale,
      }
    : { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 };
  const camTarget: [number, number, number] = pack?.environment?.camera.target ?? [0, 0.9, 0];
  let splat: EnvHandle | null = null;

  const sliders: CalibSliderDef[] = [
    { key: 'rx', label: 'rot X', min: -3.15, max: 3.15, step: 0.01, get: () => calib.rotation[0], set: (v) => (calib.rotation[0] = v) },
    { key: 'ry', label: 'rot Y', min: -3.15, max: 3.15, step: 0.01, get: () => calib.rotation[1], set: (v) => (calib.rotation[1] = v) },
    { key: 'rz', label: 'rot Z', min: -3.15, max: 3.15, step: 0.01, get: () => calib.rotation[2], set: (v) => (calib.rotation[2] = v) },
    {
      key: 'sc', label: 'scale (log10)', min: -2, max: 1.4, step: 0.01,
      get: () => Math.log10(calib.scale), set: (v) => (calib.scale = Math.pow(10, v)),
      fmt: (v) => `×${Math.pow(10, v).toFixed(3)}`,
    },
    { key: 'px', label: 'pos X', min: -8, max: 8, step: 0.02, get: () => calib.position[0], set: (v) => (calib.position[0] = v) },
    { key: 'py', label: 'pos Y', min: -8, max: 8, step: 0.02, get: () => calib.position[1], set: (v) => (calib.position[1] = v) },
    { key: 'pz', label: 'pos Z', min: -8, max: 8, step: 0.02, get: () => calib.position[2], set: (v) => (calib.position[2] = v) },
  ];

  const panel = document.createElement('div');
  panel.className = 'calib';
  panel.innerHTML = `
    <header class="calib-head">
      <h3>Calibrate environment · <span class="calib-pack">${esc(packId)}</span></h3>
      <p>Drag the splat onto the floor at life-size. Lamp = 1.65 m, crate ≈ 0.45 m.</p>
    </header>
    <div class="calib-row">
      <input type="text" id="calib-url" class="modal-input" placeholder="splat URL (.spz/.ply/.sog)" value="${esc(initialUrl)}" />
      <button type="button" id="calib-load" class="btn btn-primary">Load</button>
    </div>
    <div id="calib-status" class="calib-status"></div>
    <div class="calib-sliders">
      ${sliders
        .map(
          (s) => `
        <label class="calib-slider">
          <span class="calib-slider-label">${s.label}</span>
          <input type="range" id="calib-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.get()}" />
          <span class="calib-slider-val" id="calib-${s.key}-val"></span>
        </label>`
        )
        .join('')}
    </div>
    <div class="calib-row">
      <button type="button" id="calib-reset" class="btn btn-ghost">Reset</button>
      <button type="button" id="calib-capture" class="btn">Capture camera</button>
      <button type="button" id="calib-copy" class="btn btn-primary">Copy JSON</button>
    </div>
    <pre id="calib-json" class="calib-json"></pre>
    <p class="calib-foot"><a href="${esc(location.pathname)}">← exit calibration</a></p>
  `;
  document.body.appendChild(panel);

  const refreshJson = (): void => {
    const camPos: [number, number, number] = [
      round3(view.camera.position.x),
      round3(view.camera.position.y),
      round3(view.camera.position.z),
    ];
    const out = {
      splatUrl: ($('calib-url') as HTMLInputElement).value.trim(),
      transform: {
        position: calib.position.map(round3),
        rotation: calib.rotation.map(round3),
        scale: round3(calib.scale),
      },
      camera: { position: camPos, target: camTarget.map(round3) },
    };
    ($('calib-json') as HTMLElement).textContent = JSON.stringify(out, null, 2);
  };

  const applyAndRefresh = (): void => {
    if (splat) applyTransform(splat.node, calib);
    for (const s of sliders) {
      const valEl = document.getElementById(`calib-${s.key}-val`);
      if (valEl) valEl.textContent = s.fmt ? s.fmt(s.get()) : s.get().toFixed(2);
    }
    refreshJson();
  };

  for (const s of sliders) {
    const input = $(`calib-${s.key}`) as HTMLInputElement;
    input.addEventListener('input', () => {
      s.set(parseFloat(input.value));
      applyAndRefresh();
    });
  }

  $('calib-load').addEventListener('click', () => void doLoad());
  $('calib-reset').addEventListener('click', () => {
    calib.position = [0, 0, 0];
    calib.rotation = [0, 0, 0];
    calib.scale = 1;
    for (const s of sliders) ($(`calib-${s.key}`) as HTMLInputElement).value = String(s.get());
    applyAndRefresh();
  });
  $('calib-capture').addEventListener('click', refreshJson);
  $('calib-copy').addEventListener('click', () => {
    void navigator.clipboard.writeText(($('calib-json') as HTMLElement).textContent ?? '');
    ($('calib-copy') as HTMLElement).textContent = 'Copied';
    setTimeout(() => (($('calib-copy') as HTMLElement).textContent = 'Copy JSON'), 1500);
  });

  // Reference props as a metric ruler.
  await loadCalibrationRefs(pack);
  view.camera.position.set(3, 1.6, 3.4);
  view.orbit?.setTarget(...camTarget);

  async function doLoad(): Promise<void> {
    const url = ($('calib-url') as HTMLInputElement).value.trim();
    const status = $('calib-status');
    if (!url) {
      status.textContent = 'enter a splat URL first';
      return;
    }
    if (splat) {
      splat.remove();
      splat = null;
    }
    status.textContent = 'loading splat…';
    try {
      splat = await loadSplatForCalibration(view, url);
      applyTransform(splat.node, calib);
      status.textContent = 'loaded — drag the sliders';
    } catch (err) {
      status.textContent = `load failed: ${(err as Error).message}`;
    }
    applyAndRefresh();
  }

  applyAndRefresh();
  if (initialUrl) void doLoad();
}

/** Load a couple of known-size props at the origin as a metric ruler. */
async function loadCalibrationRefs(pack: Pack | undefined): Promise<void> {
  if (!pack) return;
  const refs = ['neon_floor_lamp', 'utility_crate', 'armchair', 'floor_lamp']
    .map((id) => findComponent(pack, id))
    .filter((c): c is Component => !!c)
    .slice(0, 2);
  let x = 0;
  for (const comp of refs) {
    try {
      const handle = await loadGltfFromUrl(view, comp.file);
      applyPlacement(handle.scene as Object3D, {
        componentId: comp.id,
        position: [x, 0, 0],
        rotation: [0, 0, 0],
        rationale: '',
      }, comp);
      loadedRoots.set(`__ref_${comp.id}`, handle.scene as Object3D);
      x += 0.9;
    } catch (err) {
      console.error('ref load', comp.id, err);
    }
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------- Layout editor (dev tool: ?layout=<packId>) ----------
//
// Loads the calibrated room + every component, seeded from the auto-layout.
// Select a piece, nudge its x/z/height/yaw with sliders, toggle pieces in/out,
// then Copy JSON and paste the result into the pack's `curatedLayouts`.

interface EditorItem {
  comp: Component;
  root: Object3D | null;
  pos: [number, number, number];
  rotY: number;
  included: boolean;
}

function applyEditorItem(it: EditorItem): void {
  if (!it.root) return;
  const node = it.root as Object3D & {
    position: { set: (x: number, y: number, z: number) => void };
    rotation: { set: (x: number, y: number, z: number) => void };
    scale: { set: (x: number, y: number, z: number) => void };
  };
  const s = uniformScale(it.comp);
  node.scale.set(s, s, s);
  if (it.included) {
    node.position.set(it.pos[0], it.pos[1], it.pos[2]);
    node.rotation.set(0, it.rotY, 0);
  } else {
    node.position.set(0, -1000, 0); // park offscreen
  }
}

async function renderLayoutEditor(packId: string): Promise<void> {
  const pack = findPack(state.catalog, packId);
  if (!pack) {
    showFatal(`pack ${packId} not found`);
    return;
  }
  setScreen('scene');
  $('scene').innerHTML = '';

  await loadEnvironmentForPack(pack);

  const items: EditorItem[] = pack.components.map((c) => ({
    comp: c,
    root: null,
    pos: [0, 0, 0],
    rotY: 0,
    included: false,
  }));

  // Seed positions from the auto-layout (variant 0), so we nudge from a sane start.
  try {
    const auto = generateVariantsLocal({ brief: '', catalog: state.catalog, packId, pinned: [], seed: 1 });
    for (const pl of auto.variants[0]?.components ?? []) {
      const it = items.find((i) => i.comp.id === pl.componentId);
      if (it) {
        it.pos = [...pl.position];
        it.rotY = pl.rotation[1];
        it.included = true;
      }
    }
  } catch {
    /* defaults below */
  }
  let ring = 0.5;
  for (const it of items) {
    if (!it.included) {
      it.pos = [Math.cos(ring) * 1.4, 0, Math.sin(ring) * 0.9];
      ring += 1.3;
    }
  }

  for (const it of items) {
    try {
      const h = await loadGltfFromUrl(view, it.comp.file);
      it.root = h.scene as Object3D;
      applyEditorItem(it);
    } catch (err) {
      console.error('editor load', it.comp.id, err);
    }
  }

  const cam = pack.environment?.camera ?? { position: [3, 1.5, 3] as [number, number, number], target: [0, 1, 0] as [number, number, number] };
  view.camera.position.set(...cam.position);
  view.camera.lookAt(new Vector3(...cam.target));
  view.orbit?.setTarget(...cam.target);

  let selectedId: string | null = items.find((i) => i.included)?.comp.id ?? items[0]?.comp.id ?? null;

  const panel = document.createElement('div');
  panel.className = 'calib calib-wide';
  document.body.appendChild(panel);

  const buildJson = (): string => {
    const layout = {
      name: 'Authored',
      narrative: 'Hand-placed in the layout editor.',
      packId,
      components: items
        .filter((i) => i.included)
        .map((i) => ({
          componentId: i.comp.id,
          position: i.pos.map(round3),
          rotation: [0, round3(i.rotY), 0],
          rationale: '',
        })),
      camera: {
        position: [round3(view.camera.position.x), round3(view.camera.position.y), round3(view.camera.position.z)],
        target: cam.target.map(round3),
      },
    };
    return JSON.stringify(layout, null, 2);
  };

  const sliderDefs = (it: EditorItem): CalibSliderDef[] => [
    { key: 'px', label: 'pos X', min: -4, max: 4, step: 0.02, get: () => it.pos[0], set: (v) => (it.pos[0] = v) },
    { key: 'pz', label: 'pos Z', min: -3, max: 3, step: 0.02, get: () => it.pos[2], set: (v) => (it.pos[2] = v) },
    { key: 'py', label: 'height', min: 0, max: 2.5, step: 0.02, get: () => it.pos[1], set: (v) => (it.pos[1] = v) },
    { key: 'ry', label: 'yaw', min: -3.15, max: 3.15, step: 0.02, get: () => it.rotY, set: (v) => (it.rotY = v) },
  ];

  const renderPanel = (): void => {
    const sel = items.find((i) => i.comp.id === selectedId);
    panel.innerHTML = `
      <header class="calib-head">
        <h3>Layout editor · <span class="calib-pack">${esc(packId)}</span></h3>
        <p>Tick a piece to include it, click its name to select, then nudge. Centre stays clear by you.</p>
      </header>
      <div class="editor-list" id="editor-list">
        ${items
          .map(
            (it) => `
          <div class="editor-row ${it.comp.id === selectedId ? 'is-sel' : ''}" data-id="${esc(it.comp.id)}">
            <input type="checkbox" class="editor-inc" data-id="${esc(it.comp.id)}" ${it.included ? 'checked' : ''} />
            <button type="button" class="editor-name" data-id="${esc(it.comp.id)}">
              <span class="editor-cat">${esc(it.comp.category)}</span>${esc(it.comp.label)}
            </button>
          </div>`
          )
          .join('')}
      </div>
      <div class="calib-sliders" id="editor-sliders">
        ${
          sel
            ? sliderDefs(sel)
                .map(
                  (s) => `
          <label class="calib-slider">
            <span class="calib-slider-label">${s.label}</span>
            <input type="range" id="ed-${s.key}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.get()}" />
            <span class="calib-slider-val" id="ed-${s.key}-val">${s.get().toFixed(2)}</span>
          </label>`
                )
                .join('')
            : '<p class="calib-status">select a piece</p>'
        }
      </div>
      <div class="calib-row">
        <button type="button" id="ed-capture" class="btn">Capture camera</button>
        <button type="button" id="ed-copy" class="btn btn-primary">Copy JSON</button>
      </div>
      <pre id="ed-json" class="calib-json"></pre>
      <p class="calib-foot"><a href="${esc(location.pathname)}">← exit editor</a></p>
    `;

    ($('ed-json') as HTMLElement).textContent = buildJson();

    for (const cb of panel.querySelectorAll<HTMLInputElement>('.editor-inc')) {
      cb.addEventListener('change', () => {
        const it = items.find((i) => i.comp.id === cb.dataset.id);
        if (!it) return;
        it.included = cb.checked;
        applyEditorItem(it);
        ($('ed-json') as HTMLElement).textContent = buildJson();
      });
    }
    for (const btn of panel.querySelectorAll<HTMLButtonElement>('.editor-name')) {
      btn.addEventListener('click', () => {
        selectedId = btn.dataset.id ?? null;
        renderPanel();
      });
    }
    if (sel) {
      for (const s of sliderDefs(sel)) {
        const input = document.getElementById(`ed-${s.key}`) as HTMLInputElement | null;
        if (!input) continue;
        input.addEventListener('input', () => {
          s.set(parseFloat(input.value));
          if (!sel.included) {
            sel.included = true;
            const cb = panel.querySelector<HTMLInputElement>(`.editor-inc[data-id="${sel.comp.id}"]`);
            if (cb) cb.checked = true;
          }
          applyEditorItem(sel);
          const valEl = document.getElementById(`ed-${s.key}-val`);
          if (valEl) valEl.textContent = s.get().toFixed(2);
          ($('ed-json') as HTMLElement).textContent = buildJson();
        });
      }
    }
    document.getElementById('ed-capture')?.addEventListener('click', () => {
      ($('ed-json') as HTMLElement).textContent = buildJson();
    });
    document.getElementById('ed-copy')?.addEventListener('click', () => {
      void navigator.clipboard.writeText(buildJson());
      const b = $('ed-copy');
      b.textContent = 'Copied';
      setTimeout(() => (b.textContent = 'Copy JSON'), 1500);
    });
  };

  renderPanel();
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
  chip.textContent = present ? 'Anthropic · on' : 'Local mode · add key';
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
        <strong>Optional.</strong> Diorama runs without a key using a built-in local layout
        engine. Add an Anthropic key and it'll compose variants with the model instead —
        smarter placement, and it reads your free-text refine box. Your key stays in this
        browser (localStorage); it never reaches a server we run.
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

function wait(ms: number): Promise<void> {
  return new Promise((res) => window.setTimeout(res, ms));
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
