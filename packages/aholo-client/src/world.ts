/**
 * Aholo World API — 3D Gaussian Splatting reconstruction & generation.
 *
 * Endpoints covered:
 *   POST /world/v1/reconstructions   — ≥20 images or video → 3DGS
 *   POST /world/v1/generations       — text and/or image → 3DGS
 *   GET  /world/v1/{worldId}         — poll status & get download URLs
 *   POST /world/v1/list              — page through your worlds
 *
 * Note: the spec uses `/global/world/v1/...` for the international gateway and
 * `/world/v1/...` for the China gateway. We prepend `/global` automatically when
 * `baseUrl` is the `.com` host. To override, pass `pathPrefix`.
 */

import type { ClientConfig } from './http.js';
import { request } from './http.js';
import { pollUntilDone, type PollOptions } from './polling.js';
import type {
  GenerationRequest,
  ReconstructionRequest,
  WorldAsyncOperation,
  WorldDetail,
} from './types.js';

function worldPath(cfg: ClientConfig, suffix: string): string {
  const usesGlobal = /aholo3d\.com/i.test(cfg.baseUrl);
  const prefix = usesGlobal ? '/global' : '';
  return `${prefix}/world/v1${suffix}`;
}

export function createReconstruction(
  cfg: ClientConfig,
  body: ReconstructionRequest,
  signal?: AbortSignal
): Promise<WorldAsyncOperation> {
  return request<WorldAsyncOperation>(cfg, {
    method: 'POST',
    path: worldPath(cfg, '/reconstructions'),
    body,
    signal,
  });
}

export function createGeneration(
  cfg: ClientConfig,
  body: GenerationRequest,
  signal?: AbortSignal
): Promise<WorldAsyncOperation> {
  return request<WorldAsyncOperation>(cfg, {
    method: 'POST',
    path: worldPath(cfg, '/generations'),
    body,
    signal,
  });
}

export function getWorld(
  cfg: ClientConfig,
  worldId: string,
  signal?: AbortSignal
): Promise<WorldDetail> {
  return request<WorldDetail>(cfg, {
    method: 'GET',
    path: worldPath(cfg, `/${encodeURIComponent(worldId)}`),
    signal,
  });
}

const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);

/**
 * Submit-then-poll convenience for `createGeneration`.
 * Returns the terminal `WorldDetail`. Throws `AholoApiError`-shaped object on FAILED.
 */
export async function generateAndWait(
  cfg: ClientConfig,
  body: GenerationRequest,
  pollOpts: PollOptions = {}
): Promise<WorldDetail> {
  const { worldId } = await createGeneration(cfg, body, pollOpts.signal);
  return await pollWorld(cfg, worldId, pollOpts);
}

/**
 * Submit-then-poll convenience for `createReconstruction`.
 */
export async function reconstructAndWait(
  cfg: ClientConfig,
  body: ReconstructionRequest,
  pollOpts: PollOptions = {}
): Promise<WorldDetail> {
  const { worldId } = await createReconstruction(cfg, body, pollOpts.signal);
  return await pollWorld(cfg, worldId, pollOpts);
}

export function pollWorld(
  cfg: ClientConfig,
  worldId: string,
  pollOpts: PollOptions = {}
): Promise<WorldDetail> {
  return pollUntilDone<WorldDetail>(
    () => getWorld(cfg, worldId, pollOpts.signal),
    (w) => {
      const status = (w.status ?? '').toUpperCase();
      return { done: TERMINAL_STATUSES.has(status), value: w };
    },
    pollOpts
  );
}
