/**
 * Dev-only headless screenshot + diagnostics via Chrome DevTools Protocol.
 * NOT part of the demo — a local QA aid for verifying the 3D viewer renders.
 *
 *   node scripts/dev-screenshot.mjs <url> <out.png> [waitMs]
 *
 * Prints: page status, canvas dims, camera, renderInfo (drawcalls/faces),
 * the viewer scene tree, the first material's shape, console logs.
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] ?? 'http://localhost:5173/';
const OUT = process.argv[3] ?? 'C:/Users/Zico/AppData/Local/Temp/dev-shot.png';
const WAIT = Number(process.argv[4] ?? 10000);
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    `--remote-debugging-port=${PORT}`,
    '--window-size=1280,860',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--user-data-dir=C:/Users/Zico/AppData/Local/Temp/cdp-profile',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

let target;
for (let i = 0; i < 80; i++) {
  try {
    const list = await (await fetch(`http://localhost:${PORT}/json`)).json();
    target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    if (target) break;
  } catch {
    /* not up yet */
  }
  await sleep(250);
}
if (!target) {
  console.error('FATAL: no DevTools page target');
  chrome.kill();
  process.exit(1);
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
let msgId = 0;
const pending = new Map();
const logs = [];
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++msgId;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id);
    pending.delete(m.id);
    m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
  } else if (m.method === 'Runtime.consoleAPICalled') {
    logs.push(
      `[${m.params.type}] ` +
        m.params.args.map((a) => a.value ?? a.description ?? JSON.stringify(a.preview ?? {})).join(' ')
    );
  } else if (m.method === 'Runtime.exceptionThrown') {
    const e = m.params.exceptionDetails;
    logs.push(`[EXCEPTION] ${e.exception?.description ?? e.text}`);
  }
});

await new Promise((r) => ws.addEventListener('open', r));
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: URL });
await sleep(WAIT);

const diag = `(() => {
  const out = {};
  out.status = document.getElementById('status')?.textContent ?? null;
  const c = document.querySelector('#stage canvas');
  out.canvas = c ? { w: c.width, h: c.height } : null;
  const d = window.__demo;
  if (!d?.view) { out.err = 'no __demo.view'; return JSON.stringify(out); }
  try {
    const cam = d.view.viewer.getCamera();
    out.camera = { pos: [cam.position.x, cam.position.y, cam.position.z] };
  } catch (e) { out.camErr = String(e); }
  try {
    const ri = d.view.viewer.renderInfo;
    if (ri) {
      out.renderInfo = {};
      for (const k of Object.keys(ri)) {
        if (typeof ri[k] === 'number') out.renderInfo[k] = ri[k];
      }
      const oi = ri.objectInfo;
      if (oi) {
        out.objectInfo = {};
        for (const k of Object.keys(oi)) {
          if (typeof oi[k] === 'number') out.objectInfo[k] = oi[k];
        }
      }
    }
  } catch (e) { out.riErr = String(e); }
  const tree = [];
  let firstMat = null;
  const walk = (o, depth) => {
    if (!o || depth > 9) return;
    let matInfo = null;
    try {
      if (typeof o.getMaterials === 'function') {
        const ms = o.getMaterials() || [];
        matInfo = ms.map((m) => m && m.constructor && m.constructor.name).join(',') || 'EMPTY';
        if (!firstMat && ms[0]) firstMat = ms[0];
      } else if (o.material) {
        matInfo = o.material.constructor && o.material.constructor.name;
        if (!firstMat) firstMat = o.material;
      }
    } catch (e) {
      matInfo = 'ERR:' + e.message;
    }
    tree.push({
      depth,
      type: o.constructor?.name,
      name: (o.name || '').slice(0, 28),
      visible: o.visible,
      geom: !!o.geometry,
      mat: matInfo,
      kids: (o.children || []).length,
    });
    for (const ch of o.children || []) walk(ch, depth + 1);
  };
  try { walk(d.view.scene, 0); out.tree = tree; } catch (e) { out.treeErr = String(e); }
  if (firstMat) {
    const numeric = {};
    for (const k of Object.keys(firstMat)) {
      const v = firstMat[k];
      if (typeof v === 'number' || typeof v === 'boolean') numeric[k] = v;
    }
    out.material = { type: firstMat.constructor?.name, keys: Object.keys(firstMat), numeric };
  }
  return JSON.stringify(out);
})()`;
const r = await send('Runtime.evaluate', { expression: diag, returnByValue: true });
console.log('DIAG:', r.result.value);
console.log(`CONSOLE (${logs.length}):`);
for (const l of logs) console.log('  ' + l);

const shot = await send('Page.captureScreenshot', { format: 'png' });
writeFileSync(OUT, Buffer.from(shot.data, 'base64'));
console.log('screenshot ->', OUT);

ws.close();
chrome.kill();
process.exit(0);
