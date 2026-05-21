/* A sentence or photo becomes a walkable 3D world, sharable as a URL — scaffolded 2026-05-21 */
/**
 * Demo 01 — Prompt-to-Space
 *
 * Flow:
 *   1. Page boots with viewer mounted, status idle.
 *   2. If URL has `?w=<worldId>`, skip the form: fetch the world, render it.
 *   3. Otherwise show a form (prompt + optional small image).
 *      On submit: POST /api/generate → get worldId → push to URL → poll → render.
 *   4. When ready, surface a "copy share link" button.
 *
 * Why this shape:
 *   - One source of truth for the demo state: the URL. Refresh restores it.
 *   - No frontend framework — the whole UI is ~200 lines of vanilla TS.
 *   - The poll cadence and edge-proxy split match the patterns we want all
 *     subsequent demos to inherit. If something here feels awkward, it's a
 *     signal that the template needs revision, not just this demo.
 */

import { mountViewer, loadSplatFromUrl, type MountedViewer } from '@3d-incubators/viewer-helpers';
import { pollUntilDone } from '@3d-incubators/aholo-client';
import type { WorldDetail } from '@3d-incubators/aholo-client';
import { submitGenerate, pollOnce } from './api.js';

const stageEl = el('stage');
const statusEl = el('status');
const controlsEl = el('controls');

const view: MountedViewer = mountViewer(stageEl);
view.start();

const initialWorldId = new URL(window.location.href).searchParams.get('w');
if (initialWorldId) {
  await enterViewMode(initialWorldId);
} else {
  enterCreateMode();
}

// ---------------- Modes ----------------

function enterCreateMode(): void {
  controlsEl.innerHTML = `
    <form id="form">
      <div class="row">
        <div style="flex: 2 1 360px">
          <label for="prompt">Prompt</label>
          <textarea id="prompt" name="prompt" placeholder="A sun-drenched nordic living room with a wooden floor and a single armchair by the window."></textarea>
        </div>
        <div>
          <label for="image">Reference image (optional, &lt;1 MB)</label>
          <input id="image" name="image" type="file" accept="image/*" />
        </div>
        <div>
          <label>&nbsp;</label>
          <button type="submit" id="submit">Generate</button>
        </div>
      </div>
    </form>
  `;
  setStatus('Ready. Describe a space, or attach a photo. Generation typically takes 5–10 minutes — feel free to keep the tab open and come back.');

  const form = el('form') as HTMLFormElement;
  const submitBtn = el('submit') as HTMLButtonElement;
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const prompt = (el('prompt') as HTMLTextAreaElement).value.trim();
    const file = (el('image') as HTMLInputElement).files?.[0];
    if (!prompt && !file) {
      setStatus('Type something or attach an image first.', 'err');
      return;
    }
    submitBtn.disabled = true;
    try {
      const imageDataUrl = file ? await readAsDataUrl(file) : undefined;
      setStatus('Submitting…');
      const { worldId } = await submitGenerate({ prompt: prompt || undefined, imageDataUrl });
      // Reflect into URL so refresh / share both work.
      const next = new URL(window.location.href);
      next.searchParams.set('w', worldId);
      window.history.replaceState(null, '', next.toString());
      await trackAndRender(worldId);
    } catch (err) {
      setStatus(`Submit failed: ${(err as Error).message}`, 'err');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function enterViewMode(worldId: string): Promise<void> {
  controlsEl.innerHTML = `
    <div class="row">
      <p style="margin:0;color:var(--ink-dim);flex:1 1 320px">
        Viewing shared world <code>${escapeHtml(worldId)}</code>.
      </p>
      <div>
        <button id="new">Create your own</button>
      </div>
    </div>
  `;
  el('new').addEventListener('click', () => {
    const next = new URL(window.location.href);
    next.searchParams.delete('w');
    window.location.href = next.toString();
  });
  await trackAndRender(worldId);
}

// ---------------- Tracking + rendering ----------------

async function trackAndRender(worldId: string): Promise<void> {
  setStatus(`Tracking world ${worldId}…`);

  let lastStatus = '';
  const detail = await pollUntilDone<WorldDetail>(
    () => pollOnce(worldId).then((r) => r.detail),
    (d) => {
      const s = (d.status ?? '').toUpperCase();
      const terminal = s === 'SUCCEEDED' || s === 'FAILED' || s === 'CANCELLED';
      return { done: terminal, value: d };
    },
    {
      initialIntervalMs: 4000,
      maxIntervalMs: 20000,
      timeoutMs: 15 * 60 * 1000,
      onTick: (n, v) => {
        const s = (v as WorldDetail).status ?? 'unknown';
        if (s !== lastStatus) {
          lastStatus = s;
          setStatus(`Poll #${n} — status: ${s}`);
        }
      },
    }
  );

  const status = (detail.status ?? '').toUpperCase();
  if (status !== 'SUCCEEDED') {
    setStatus(`Job ${status}. ${detail.error?.message ?? 'Try again.'}`, 'err');
    return;
  }

  const url = pickBestSplatUrl(detail);
  if (!url) {
    setStatus('Job succeeded but no splat URL in response. Inspect Network → /api/poll.', 'err');
    return;
  }

  setStatus(`Loading splat (${shortFmt(url)})…`);
  try {
    await loadSplatFromUrl(view, url);
    showShareLink(worldId);
  } catch (err) {
    setStatus(`Render failed: ${(err as Error).message}`, 'err');
  }
}

function pickBestSplatUrl(detail: WorldDetail): string | undefined {
  const urls = detail.assets?.splats?.urls;
  // Preference: spz (small) → sog (good for streaming) → ply (largest, universal).
  return urls?.spzPath ?? urls?.sogPath ?? urls?.plyPath;
}

function showShareLink(worldId: string): void {
  const shareUrl = new URL(window.location.href);
  shareUrl.searchParams.set('w', worldId);
  const link = shareUrl.toString();
  statusEl.innerHTML = `
    <span class="share">
      ✔ Ready. Share this link:
      <a href="${escapeHtml(link)}">${escapeHtml(link)}</a>
      <button id="copy" style="margin-left:8px">Copy</button>
    </span>
  `;
  statusEl.className = 'panel status ok';
  el('copy').addEventListener('click', async () => {
    await navigator.clipboard.writeText(link);
    (el('copy') as HTMLButtonElement).textContent = 'Copied';
  });
}

// ---------------- Tiny helpers ----------------

function setStatus(text: string, kind: '' | 'ok' | 'err' = ''): void {
  statusEl.textContent = text;
  statusEl.className = `panel status${kind ? ' ' + kind : ''}`;
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > 1_000_000) {
      reject(new Error(`Image too large (${(file.size / 1024).toFixed(0)} KB). Use <1 MB for now.`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.onload = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

function shortFmt(url: string): string {
  const file = url.split('?')[0]?.split('/').pop() ?? url;
  return file.length > 40 ? file.slice(0, 37) + '…' : file;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}
