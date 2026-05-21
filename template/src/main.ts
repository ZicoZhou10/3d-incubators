/**
 * Demo template — minimal "hello, splat" boilerplate.
 *
 * Drop your own UI in `#controls` and call `renderSplat(url)` when you have one.
 * The fields used in this template (#stage, #status, #controls) are the same
 * convention used by all 3D Incubators demos; preserve them when forking.
 */

import { mountViewer, loadSplatFromUrl, type MountedViewer } from '@3d-incubators/viewer-helpers';

const SAMPLE_SPLAT_URL = 'https://holo-cos.aholo3d.cn/aholo-opensource/gs_file/bear/bear.3d71a266.sog';

const stageEl = document.getElementById('stage') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const controlsEl = document.getElementById('controls') as HTMLElement;

setStatus('Booting viewer…');

const view: MountedViewer = mountViewer(stageEl);
view.start();

setStatus('Loading sample splat (replace this with your own pipeline)…');
try {
  await loadSplatFromUrl(view, SAMPLE_SPLAT_URL);
  setStatus('Ready. Drag to orbit, scroll to zoom.', 'ok');
} catch (err) {
  setStatus(`Failed to load sample: ${(err as Error).message}`, 'err');
}

renderControls();

// ---------- Helpers ----------

function setStatus(text: string, kind: '' | 'ok' | 'err' = ''): void {
  statusEl.textContent = text;
  statusEl.className = `panel status${kind ? ' ' + kind : ''}`;
}

function renderControls(): void {
  controlsEl.innerHTML = `
    <p style="margin:0;color:var(--ink-dim)">
      Edit <code>src/main.ts</code> to build your demo.
      The sample splat above proves the viewer pipeline works end-to-end.
    </p>
  `;
}
