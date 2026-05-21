/**
 * GET /api/poll?worldId=... — returns the latest world status & assets.
 *
 * This is intentionally a single-shot fetch, NOT a long-poll. The browser
 * decides cadence and runs the poll loop with @3d-incubators/aholo-client's
 * `pollUntilDone` (or its own). That keeps the edge function cheap and
 * cacheable, and lets the share-link flow (`?w=<worldId>`) reuse the same
 * endpoint to load a completed world on demand.
 */

import { getWorld } from '@3d-incubators/aholo-client';
import { errorJson, json, requireEnv, type AholoEnv } from './_utils.js';

export const onRequestGet: PagesFunction<AholoEnv> = async ({ request, env }) => {
  try {
    requireEnv(env);
  } catch (e) {
    return errorJson(500, (e as Error).message);
  }

  const url = new URL(request.url);
  const worldId = url.searchParams.get('worldId');
  if (!worldId) {
    return errorJson(400, 'Missing `worldId` query parameter.');
  }

  try {
    const detail = await getWorld(
      { baseUrl: env.AHOLO_BASE_URL, apiKey: env.AHOLO_API_KEY },
      worldId
    );
    return json({ status: detail.status, detail });
  } catch (e) {
    const msg = (e as Error).message ?? 'Unknown error';
    return errorJson(502, `Aholo poll failed: ${msg}`);
  }
};
