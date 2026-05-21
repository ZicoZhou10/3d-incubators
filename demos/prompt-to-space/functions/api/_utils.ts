/**
 * Shared helpers for Pages Functions.
 *
 * Why an edge proxy at all?
 *
 *   1. API keys never reach the browser bundle.
 *   2. We can rate-limit / cache on the edge without changing the client.
 *   3. Aholo's gateway expects a non-standard `Authorization: <key>` (no Bearer);
 *      keeping that quirk on the server side means the demo client looks normal.
 *
 * Each function reads `AHOLO_API_KEY` and `AHOLO_BASE_URL` from the env binding.
 * Local dev: set them in `.dev.vars`. Deploy: set as Pages secrets.
 */

export interface AholoEnv {
  AHOLO_API_KEY: string;
  AHOLO_BASE_URL: string;
}

export interface Ctx {
  env: AholoEnv;
  request: Request;
}

export function json(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(init?.headers ?? {}),
    },
  });
}

export function errorJson(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: { message, ...extra } }, { status });
}

export function requireEnv(env: AholoEnv): void {
  if (!env.AHOLO_API_KEY) {
    throw new Error('AHOLO_API_KEY is not set. Add it to .dev.vars locally or as a Pages secret in deploy.');
  }
  if (!env.AHOLO_BASE_URL) {
    throw new Error('AHOLO_BASE_URL is not set. wrangler.toml [vars] should default it.');
  }
}
