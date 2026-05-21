/**
 * Browser-side wrappers around our own Pages Functions.
 *
 * We deliberately do NOT call api.aholo3d.com directly from the browser —
 * see DECISION_PRINCIPLES.md and template/functions/api/_utils.ts for why.
 */

import type { WorldDetail } from '@3d-incubators/aholo-client';

export interface GenerateInput {
  prompt?: string;
  /** Data URL (under ~1MB). Use uploadAndGenerate for larger files. */
  imageDataUrl?: string;
  /** Optional scene hint. */
  scene?: string;
}

export interface GenerateResponse {
  worldId: string;
}

export interface PollResponse {
  status: string;
  detail: WorldDetail;
}

export async function submitGenerate(input: GenerateInput, signal?: AbortSignal): Promise<GenerateResponse> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`generate failed: ${res.status} ${text}`);
  }
  return res.json();
}

export async function pollOnce(worldId: string, signal?: AbortSignal): Promise<PollResponse> {
  const res = await fetch(`/api/poll?worldId=${encodeURIComponent(worldId)}`, { signal });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`poll failed: ${res.status} ${text}`);
  }
  return res.json();
}
