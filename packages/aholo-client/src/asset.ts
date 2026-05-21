/**
 * Aholo Asset / OUS upload — get an upload token, then upload directly to OUS.
 *
 * Two-step pattern:
 *   1) GET /world/v1/asset/token        on the gateway → returns { ousToken, globalDomain, blockSize }
 *   2) POST `${globalDomain}/ous/api/v2/single/upload`  with header `ous-token-v2: <ousToken>`
 *
 * For files larger than `blockSize`, use the chunked init/part flow — this
 * module currently exposes only single-file upload, which covers >95% of
 * lighthouse demo inputs (a phone photo or sub-100MB video).
 */

import type { ClientConfig } from './http.js';
import { request } from './http.js';
import type { AssetUploadToken } from './types.js';

function assetPath(cfg: ClientConfig, suffix: string): string {
  const usesGlobal = /aholo3d\.com/i.test(cfg.baseUrl);
  const prefix = usesGlobal ? '/global' : '';
  return `${prefix}/world/v1${suffix}`;
}

export function getUploadToken(
  cfg: ClientConfig,
  signal?: AbortSignal
): Promise<AssetUploadToken> {
  return request<AssetUploadToken>(cfg, {
    method: 'GET',
    path: assetPath(cfg, '/asset/token'),
    signal,
  });
}

export interface UploadResult {
  /** Publicly reachable URL of the uploaded asset. */
  url: string;
}

/**
 * Single-file upload. Caller passes the resolved upload token from `getUploadToken`.
 * Returns the public URL to feed into reconstruction/generation requests.
 *
 * Note: the OUS response shape is not yet finalized in our spec snapshot —
 * we currently expect a plain URL string in `d.url` per the v2 single-upload
 * contract. If your environment returns a different shape, fix it here.
 */
export async function uploadSingleFile(
  token: AssetUploadToken,
  file: Blob | File,
  opts: { fetch?: typeof fetch; signal?: AbortSignal } = {}
): Promise<UploadResult> {
  const fetchImpl = opts.fetch ?? fetch;
  const form = new FormData();
  form.append('file', file);

  const url = token.globalDomain.replace(/\/$/, '') + '/ous/api/v2/single/upload';
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'ous-token-v2': token.ousToken,
    },
    body: form,
    signal: opts.signal,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OUS upload failed (${res.status}): ${body}`);
  }
  const json = (await res.json()) as { d?: { url?: string } } | { url?: string };
  // Accept either { d: { url } } or { url }.
  const direct = (json as { url?: string }).url;
  const nested = (json as { d?: { url?: string } }).d?.url;
  const publicUrl = direct ?? nested;
  if (!publicUrl) {
    throw new Error(`OUS upload returned no URL: ${JSON.stringify(json)}`);
  }
  return { url: publicUrl };
}
