/* Nook — a co-designed reading corner.
 *
 * The page's job: load four agent-generated GLBs and the LLM-generated
 * layout.json, render them into the viewer, and present a tiny product UI
 * around the scene that lets a viewer (Sara, Mia, anyone) inspect the
 * agent's reasoning component-by-component, share the result, and read
 * how it was made.
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
import { VIGNETTES, type Vignette, type VignetteComponent, type VignetteLayout } from './vignettes.js';

// ---------- vignette to load (single-vignette demo for now) ----------
const VIGNETTE = VIGNETTES[0];

// per-slot one-liner shown under the component name on the card
const ONE_LINE_LABEL: Record<string, string> = {
  armchair: 'mid-century · tan leather · walnut',
  floor_lamp: 'brass · cream drum shade · vintage',
  ottoman: 'round · leather top · wooden legs',
  book_stack: 'three books · red, green, cream',
};

// ---------- DOM refs ----------
const stageEl = el('stage');
const composingEl = el('composing');
const composingDotsEl = el('composing-dots');
const componentListEl = el('component-list');
const hintEl = el('hint');
const shareBtn = el('share') as HTMLButtonElement;
const shareLabel = el('share-label');
const shareArrow = el('share-arrow');
const detailEl = el('detail');
const detailCloseEl = el('detail-close');
const detailIndex = el('detail-index');
const detailSlot = el('detail-slot');
const detailPrompt = el('detail-prompt');
const detailRationale = el('detail-rationale');
const detailScale = el('detail-scale');
const detailPosition = el('detail-position');
const detailRotation = el('detail-rotation');

// ---------- Viewer ----------
const view = mountViewer(stageEl, {
  cameraUp: [0, 1, 0],
  cameraPosition: [2.3, 1.4, 2.6],
  cameraTarget: [0, 0.5, 0.3],
  splattingEnabled: false,
  orbit: { rotateSpeed: 0.0055, zoomSpeed: 0.0012, minDistance: 1, maxDistance: 12 },
});

// Make the viewer's background match the paper so the 3D blends into the page.
setViewerConfig(view.viewer, {
  pipeline: {
    Background: {
      enabled: true,
      ground: { enabled: false },
      background: {
        active: BackgroundMode.BasicBackground,
        basic: { color: new Color(0.957, 0.929, 0.882) /* #f4ede1 */, alpha: 1 },
      },
    },
  },
});

addLights();
view.start();

// ---------- State ----------
interface LoadedComponent {
  component: VignetteComponent;
  root: Object3D;
}
let loaded: LoadedComponent[] = [];
let layout: VignetteLayout | null = null;

renderComponentCards(VIGNETTE);
renderComposingDots(VIGNETTE.components.length);
void boot();

// ---------- Behaviour ----------

async function boot(): Promise<void> {
  let fetchedLayout: VignetteLayout;
  try {
    const res = await fetch(VIGNETTE.layoutUrl);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    fetchedLayout = (await res.json()) as VignetteLayout;
  } catch (err) {
    composingEl.textContent = `Could not load layout: ${(err as Error).message}`;
    return;
  }
  layout = fetchedLayout;

  if (layout.camera) {
    view.camera.position.set(...layout.camera.position);
    view.camera.lookAt(new Vector3(...layout.camera.target));
    view.orbit?.setTarget(...layout.camera.target);
  }

  const layoutBySlot = new Map(layout.components.map((c) => [c.slot, c]));

  await Promise.all(
    VIGNETTE.components.map(async (component) => {
      setComponentState(component.slot, 'loading');
      try {
        const handle = await loadGltfFromUrl(view, component.file);
        const placement = layoutBySlot.get(component.slot);
        if (!placement) {
          throw new Error(`layout.json has no entry for slot "${component.slot}"`);
        }
        applyPlacement(handle.scene as Object3D, placement);
        loaded.push({ component, root: handle.scene as Object3D });
        setComponentState(component.slot, 'ok');
      } catch (err) {
        setComponentState(component.slot, 'err');
        console.error(`Could not load ${component.slot}:`, err);
      }
    })
  );

  // Hold the moment, then fade out the composing overlay.
  await wait(220);
  composingEl.dataset.state = 'done';

  // Hint fades in 600ms after the scene appears; fades out on first interaction.
  await wait(700);
  hintEl.dataset.state = 'visible';
  const dismissHint = (): void => {
    hintEl.dataset.state = 'hidden';
    stageEl.removeEventListener('pointerdown', dismissHint);
    window.removeEventListener('wheel', dismissHint, { capture: true });
  };
  stageEl.addEventListener('pointerdown', dismissHint, { once: true });
  window.addEventListener('wheel', dismissHint, { once: true, capture: true });

  observeEssaySteps();
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
  const key = new DirectionalLight(0xffffff, 1.9);
  key.position.set(3, 5, 4);
  view.scene.add(key);
  const fill = new DirectionalLight(0xfff0d8, 0.7);
  fill.position.set(-4, 2, -3);
  view.scene.add(fill);
  const back = new DirectionalLight(0xffe7c2, 0.4);
  back.position.set(-2, 3, 5);
  view.scene.add(back);
}

// ---------- Component cards ----------

function renderComponentCards(v: Vignette): void {
  componentListEl.innerHTML = v.components
    .map((c, i) => {
      const nº = `Nº ${String(i + 1).padStart(2, '0')}`;
      const line = ONE_LINE_LABEL[c.slot] ?? c.prompt.slice(0, 48);
      return `
        <li class="component" data-slot="${escapeHtml(c.slot)}" data-state="pending">
          <button type="button" class="component-button">
            <span class="component-no">${escapeHtml(nº)}</span>
            <span class="component-name">${escapeHtml(c.slot)}</span>
            <span class="component-line">${escapeHtml(line)}</span>
            <span class="component-status" aria-hidden="true"></span>
          </button>
        </li>
      `;
    })
    .join('');

  for (const liEl of componentListEl.querySelectorAll<HTMLElement>('.component')) {
    const slot = liEl.dataset.slot;
    if (!slot) continue;
    liEl.querySelector<HTMLButtonElement>('.component-button')?.addEventListener('click', () => {
      openDetailFor(slot);
    });
  }
}

function renderComposingDots(n: number): void {
  composingDotsEl.innerHTML = Array.from(
    { length: n },
    () => `<li data-state="pending"></li>`
  ).join('');
}

function setComponentState(slot: string, state: 'pending' | 'loading' | 'ok' | 'err'): void {
  const liEl = componentListEl.querySelector<HTMLElement>(`.component[data-slot="${slot}"]`);
  if (liEl) liEl.dataset.state = state;
  // mirror state onto the composing dots so the loading sequence reads here too
  const slotIndex = VIGNETTE.components.findIndex((c) => c.slot === slot);
  const dot = composingDotsEl.querySelectorAll<HTMLElement>('li')[slotIndex];
  if (dot) dot.dataset.state = state === 'ok' ? 'done' : state === 'err' ? 'err' : state;
}

// ---------- Detail drawer ----------

function openDetailFor(slot: string): void {
  if (!layout) return;
  const component = VIGNETTE.components.find((c) => c.slot === slot);
  const placement = layout.components.find((c) => c.slot === slot);
  if (!component || !placement) return;

  const index = VIGNETTE.components.findIndex((c) => c.slot === slot);
  detailIndex.textContent = `Nº ${String(index + 1).padStart(2, '0')}`;
  detailSlot.textContent = slot;
  detailPrompt.textContent = `"${component.prompt}"`;
  detailRationale.textContent = placement.rationale ?? '—';
  detailScale.textContent = placement.scale.toFixed(3);
  detailPosition.textContent = `[${placement.position.map((n) => n.toFixed(2)).join(', ')}]`;
  detailRotation.textContent = formatRotation(placement.rotation);

  detailEl.dataset.state = 'open';
  detailEl.setAttribute('aria-hidden', 'false');

  for (const c of componentListEl.querySelectorAll<HTMLElement>('.component')) {
    c.dataset.active = c.dataset.slot === slot ? 'true' : 'false';
  }

  view.orbit?.setTarget(placement.position[0], placement.position[1] + 0.4, placement.position[2]);
}

function closeDetail(): void {
  detailEl.dataset.state = 'closed';
  detailEl.setAttribute('aria-hidden', 'true');
  for (const c of componentListEl.querySelectorAll<HTMLElement>('.component')) {
    c.dataset.active = 'false';
  }
  if (layout?.camera) {
    view.orbit?.setTarget(...layout.camera.target);
  }
}

detailCloseEl.addEventListener('click', closeDetail);
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && detailEl.dataset.state === 'open') closeDetail();
});

function formatRotation(rad: [number, number, number]): string {
  const deg = rad.map((r) => Math.round((r * 180) / Math.PI));
  return `[${rad.map((r) => r.toFixed(2)).join(', ')}] rad · ${deg.join('°, ')}°`;
}

// ---------- Share ----------

let copiedTimer: number | undefined;
shareBtn.addEventListener('click', async () => {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // older browsers / insecure context — best-effort
  }
  shareBtn.classList.add('is-copied');
  shareLabel.textContent = 'Copied — paste it to Mia';
  shareArrow.textContent = '✓';
  if (copiedTimer) window.clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => {
    shareBtn.classList.remove('is-copied');
    shareLabel.textContent = 'Send to Mia';
    shareArrow.textContent = '→';
  }, 2200);
});

// ---------- Essay step reveal ----------

function observeEssaySteps(): void {
  const steps = document.querySelectorAll<HTMLElement>('.essay .step');
  if (!('IntersectionObserver' in window)) {
    for (const s of steps) s.classList.add('is-visible');
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      }
    },
    { rootMargin: '0px 0px -120px 0px' }
  );
  for (const s of steps) io.observe(s);
}

// ---------- helpers ----------

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
}

function wait(ms: number): Promise<void> {
  return new Promise((res) => window.setTimeout(res, ms));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}
