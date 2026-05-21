/**
 * POST /api/generate — kicks off a World Generation job.
 *
 * Body: { prompt?: string, imageDataUrl?: string, scene?: string }
 * Returns: { worldId: string }
 *
 * Notes:
 *   - At least one of `prompt` / `imageDataUrl` must be present.
 *   - `imageDataUrl` is forwarded as a `resources[0]` entry with type=image. The
 *     Aholo API accepts data URLs directly for small inputs; for large ones,
 *     get an upload token (asset.ts) and pass a public URL instead.
 */

import { createGeneration } from '@3d-incubators/aholo-client';
import type { GenerationRequest } from '@3d-incubators/aholo-client';
import { errorJson, json, requireEnv, type AholoEnv } from './_utils.js';

export const onRequestPost: PagesFunction<AholoEnv> = async ({ request, env }) => {
  try {
    requireEnv(env);
  } catch (e) {
    return errorJson(500, (e as Error).message);
  }

  let body: { prompt?: string; imageDataUrl?: string; scene?: string };
  try {
    body = await request.json();
  } catch {
    return errorJson(400, 'Invalid JSON body');
  }

  const prompt = body.prompt?.trim();
  const img = body.imageDataUrl?.trim();
  if (!prompt && !img) {
    return errorJson(400, 'Provide `prompt` or `imageDataUrl` (or both).');
  }

  const reqBody: GenerationRequest = {
    ...(prompt ? { prompt } : {}),
    ...(img ? { resources: [{ url: img, type: 'image' as const }] } : {}),
    ...(body.scene ? { scene: body.scene } : {}),
  };

  try {
    const op = await createGeneration(
      { baseUrl: env.AHOLO_BASE_URL, apiKey: env.AHOLO_API_KEY },
      reqBody
    );
    return json({ worldId: op.worldId });
  } catch (e) {
    const msg = (e as Error).message ?? 'Unknown error';
    return errorJson(502, `Aholo generation failed: ${msg}`);
  }
};
