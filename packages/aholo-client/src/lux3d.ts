/**
 * Aholo Lux3D API — single-asset image/text to 3D mesh generation.
 *
 * Endpoints:
 *   POST /lux3d/v1/generate/img-to-3d/task/create
 *   POST /lux3d/v1/generate/text-to-3d/task/create
 *   GET  /lux3d/v1/generate/task/get?taskid=...
 *
 * Result URL validity: ~2 hours. Download promptly.
 *
 * Response-shape note (observed live, 2026-05-22):
 *   World endpoints return their payload flat (`{ worldId }`). Lux3D does NOT —
 *   it wraps every response in a terse envelope:
 *
 *       { f: <failure|null>, c: "<code>", m: "<message>", d: <payload> }
 *
 *   `c === "0"` means success; `d` carries the payload — a *numeric* task id
 *   for the create endpoints, a detail object for the get endpoint. The
 *   helpers below peel that envelope so callers get a flat, typed result with
 *   a guaranteed string `taskid`, and surface logical errors (HTTP 2xx but
 *   `c !== 0`) as thrown errors instead of silently orphaning a job.
 */

import type { ClientConfig } from './http.js';
import { request } from './http.js';
import { pollUntilDone, type PollOptions } from './polling.js';
import type { ApiError, Lux3DTaskCreated, Lux3DTaskDetail } from './types.js';

function lux3dPath(cfg: ClientConfig, suffix: string): string {
  const usesGlobal = /aholo3d\.com/i.test(cfg.baseUrl);
  const prefix = usesGlobal ? '/global' : '';
  return `${prefix}/lux3d/v1${suffix}`;
}

// ---------------------------------------------------------------------------
// Response normalization — see the "Response-shape note" above.
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function asObject(x: unknown): Json {
  return x && typeof x === 'object' ? (x as Json) : {};
}

/** Coerce a scalar id to a string — the gateway returns numeric task ids. */
function asId(v: unknown): string | undefined {
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return undefined;
}

function firstId(obj: Json, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const id = asId(obj[k]);
    if (id) return id;
  }
  return undefined;
}

function firstString(obj: Json, keys: readonly string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/**
 * Peel the `{ f, c, m, d }` Lux3D envelope and return the inner `d` payload.
 * Throws if the gateway reported a non-success code. If the response is not
 * enveloped (defensive — in case the gateway is ever made consistent with
 * World), the raw value is returned untouched.
 */
function unwrapLux3D(raw: unknown, what: string): unknown {
  const o = asObject(raw);
  const enveloped = 'c' in o && 'd' in o;
  if (!enveloped) return raw;

  const code = o.c;
  const ok = code === '0' || code === 0;
  if (!ok) {
    const msg = firstString(o, ['m']) ?? `code=${JSON.stringify(code)}`;
    const fail = o.f != null ? ` (f=${JSON.stringify(o.f)})` : '';
    throw new Error(
      `Aholo Lux3D ${what} failed: ${msg}${fail}. Raw response: ${JSON.stringify(raw)}`
    );
  }
  return o.d;
}

const ID_KEYS = ['taskid', 'task_id', 'taskId', 'id'] as const;

function normalizeCreated(raw: unknown, what: string): Lux3DTaskCreated {
  const payload = unwrapLux3D(raw, what);

  // The create endpoints put the task id directly in `d` (a number). Tolerate
  // it also arriving as an object, just in case.
  let taskid = asId(payload);
  if (!taskid && payload && typeof payload === 'object') {
    taskid = firstId(payload as Json, ID_KEYS);
  }
  if (!taskid) {
    throw new Error(
      `Aholo Lux3D ${what} returned success but no taskid could be found in ` +
        `the payload — the job cannot be polled. Raw response: ${JSON.stringify(raw)}`
    );
  }
  return { taskid };
}

/**
 * Lux3D's actual status field is an *integer enum* per the OpenAPI spec —
 * 0 = init, 1 = in progress, 3 = success, 4 = failed. We translate to the
 * string status the rest of the codebase expects.
 */
const INT_STATUS: Record<number, Lux3DTaskDetail['status']> = {
  0: 'PENDING',
  1: 'RUNNING',
  3: 'SUCCEEDED',
  4: 'FAILED',
};

function readStatus(o: Json): Lux3DTaskDetail['status'] {
  const raw = o.status ?? o.state ?? o.taskStatus ?? o.taskState;
  if (typeof raw === 'number' && Number.isInteger(raw)) {
    return INT_STATUS[raw] ?? 'UNKNOWN';
  }
  if (typeof raw === 'string' && raw.length > 0) return raw.toUpperCase();
  return 'UNKNOWN';
}

/**
 * Lux3D's actual result-URL location is `outputs[0].content` (an array of
 * `{content: string}`) per the OpenAPI spec. Older / informal shapes use
 * `result.url` or various `*_url` flat fields — keep the fallbacks so a
 * gateway revision doesn't silently break the client.
 */
function readResultUrl(o: Json): string | undefined {
  const outputs = o.outputs;
  if (Array.isArray(outputs)) {
    for (const item of outputs) {
      const content = (item as Json | null)?.content;
      if (typeof content === 'string' && content.length > 0) return content;
    }
  }
  const resultObj = asObject(o.result);
  const nested = typeof resultObj.url === 'string' && resultObj.url.length > 0 ? resultObj.url : undefined;
  return (
    nested ??
    firstString(o, [
      'result_url',
      'resultUrl',
      'modelUrl',
      'model_url',
      'downloadUrl',
      'download_url',
      'zipUrl',
      'glbUrl',
      'url',
    ])
  );
}

function normalizeDetail(raw: unknown, fallbackTaskid: string): Lux3DTaskDetail {
  const payload = unwrapLux3D(raw, 'task get');
  const o = asObject(payload);

  const taskid = firstId(o, ID_KEYS) ?? fallbackTaskid;
  const status = readStatus(o);
  const url = readResultUrl(o);
  const error = o.error && typeof o.error === 'object' ? (o.error as ApiError) : undefined;

  return {
    taskid,
    status,
    ...(url ? { result: { url } } : {}),
    ...(error ? { error } : {}),
    // Always carry the peeled payload — lets an agent read field shapes the
    // typed parse above could not anticipate (the gateway is terse + evolving).
    raw: payload,
  };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface ImageTo3DInput {
  /** Data URL or http(s) URL to the source image. */
  img: string;
}

export interface TextTo3DInput {
  prompt: string;
  style: string;
  /** Optional reference image (data URL or http(s) URL). */
  img?: string;
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export async function createImageTo3D(
  cfg: ClientConfig,
  body: ImageTo3DInput,
  signal?: AbortSignal
): Promise<Lux3DTaskCreated> {
  const raw = await request<unknown>(cfg, {
    method: 'POST',
    path: lux3dPath(cfg, '/generate/img-to-3d/task/create'),
    body,
    signal,
  });
  return normalizeCreated(raw, 'image-to-3D create');
}

export async function createTextTo3D(
  cfg: ClientConfig,
  body: TextTo3DInput,
  signal?: AbortSignal
): Promise<Lux3DTaskCreated> {
  const raw = await request<unknown>(cfg, {
    method: 'POST',
    path: lux3dPath(cfg, '/generate/text-to-3d/task/create'),
    body,
    signal,
  });
  return normalizeCreated(raw, 'text-to-3D create');
}

export async function getLux3DTask(
  cfg: ClientConfig,
  taskid: string,
  signal?: AbortSignal
): Promise<Lux3DTaskDetail> {
  const qs = `?taskid=${encodeURIComponent(taskid)}`;
  const raw = await request<unknown>(cfg, {
    method: 'GET',
    path: lux3dPath(cfg, `/generate/task/get${qs}`),
    signal,
  });
  return normalizeDetail(raw, taskid);
}

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);

export function pollLux3D(
  cfg: ClientConfig,
  taskid: string,
  pollOpts: PollOptions = {}
): Promise<Lux3DTaskDetail> {
  return pollUntilDone<Lux3DTaskDetail>(
    () => getLux3DTask(cfg, taskid, pollOpts.signal),
    (t) => ({ done: TERMINAL.has((t.status ?? '').toUpperCase()), value: t }),
    {
      // Lux3D is faster than World — 10-15s recommended cadence per docs.
      initialIntervalMs: 4000,
      maxIntervalMs: 15000,
      ...pollOpts,
    }
  );
}
