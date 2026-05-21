/**
 * Minimal HTTP layer for Aholo gateway calls.
 *
 * Why hand-rolled instead of axios/ky:
 * - Zero deps in the client package → easy to read for coding agents
 * - Edge-runtime compatible (Cloudflare Workers, Vercel Edge)
 * - Explicit auth header shape (no `Bearer` prefix — Aholo's quirk)
 */

import type { ApiError } from './types.js';

export interface ClientConfig {
  /**
   * Base URL of the Aholo gateway.
   * - Global: https://api.aholo3d.com
   * - China:  https://api.aholo3d.cn
   */
  baseUrl: string;
  /**
   * API key from https://labs.aholo3d.com/api-keys
   * NEVER pass this from a browser bundle — proxy through a serverless function.
   */
  apiKey: string;
  /** Default fetch implementation override (testing / edge runtimes). */
  fetch?: typeof fetch;
}

export class AholoApiError extends Error {
  readonly httpStatus: number;
  readonly body: ApiError | undefined;
  constructor(httpStatus: number, message: string, body?: ApiError) {
    super(message);
    this.name = 'AholoApiError';
    this.httpStatus = httpStatus;
    this.body = body;
  }
}

export async function request<T>(
  cfg: ClientConfig,
  init: {
    method: 'GET' | 'POST' | 'DELETE';
    path: string;
    /** JSON body. Omit for GET. */
    body?: unknown;
    /** Extra headers, e.g. `ous-token-v2` for OUS uploads. */
    headers?: Record<string, string>;
    /** Abort signal. */
    signal?: AbortSignal;
  }
): Promise<T> {
  const fetchImpl = cfg.fetch ?? fetch;
  const url = cfg.baseUrl.replace(/\/$/, '') + init.path;

  const headers: Record<string, string> = {
    // Aholo's quirk: no `Bearer` prefix.
    Authorization: cfg.apiKey,
    ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...init.headers,
  };

  const res = await fetchImpl(url, {
    method: init.method,
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: init.signal,
  });

  // Attempt to parse the body either way — Aholo errors come as JSON.
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    const errBody = (parsed && typeof parsed === 'object' ? (parsed as ApiError) : undefined);
    const message = errBody?.message ?? `${init.method} ${init.path} failed: ${res.status}`;
    throw new AholoApiError(res.status, message, errBody);
  }

  return parsed as T;
}
