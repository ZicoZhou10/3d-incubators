/**
 * Aholo Lux3D API — single-asset image/text to 3D mesh generation.
 *
 * Endpoints:
 *   POST /lux3d/v1/generate/img-to-3d/task/create
 *   POST /lux3d/v1/generate/text-to-3d/task/create
 *   GET  /lux3d/v1/generate/task/get?taskid=...
 *
 * Result URL validity: ~2 hours. Download promptly.
 */

import type { ClientConfig } from './http.js';
import { request } from './http.js';
import { pollUntilDone, type PollOptions } from './polling.js';
import type { Lux3DTaskCreated, Lux3DTaskDetail } from './types.js';

function lux3dPath(cfg: ClientConfig, suffix: string): string {
  const usesGlobal = /aholo3d\.com/i.test(cfg.baseUrl);
  const prefix = usesGlobal ? '/global' : '';
  return `${prefix}/lux3d/v1${suffix}`;
}

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

export function createImageTo3D(
  cfg: ClientConfig,
  body: ImageTo3DInput,
  signal?: AbortSignal
): Promise<Lux3DTaskCreated> {
  return request<Lux3DTaskCreated>(cfg, {
    method: 'POST',
    path: lux3dPath(cfg, '/generate/img-to-3d/task/create'),
    body,
    signal,
  });
}

export function createTextTo3D(
  cfg: ClientConfig,
  body: TextTo3DInput,
  signal?: AbortSignal
): Promise<Lux3DTaskCreated> {
  return request<Lux3DTaskCreated>(cfg, {
    method: 'POST',
    path: lux3dPath(cfg, '/generate/text-to-3d/task/create'),
    body,
    signal,
  });
}

export function getLux3DTask(
  cfg: ClientConfig,
  taskid: string,
  signal?: AbortSignal
): Promise<Lux3DTaskDetail> {
  const qs = `?taskid=${encodeURIComponent(taskid)}`;
  return request<Lux3DTaskDetail>(cfg, {
    method: 'GET',
    path: lux3dPath(cfg, `/generate/task/get${qs}`),
    signal,
  });
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
