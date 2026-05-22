/**
 * Runtime config for the Aholo MCP server.
 *
 * The API key is read from the environment, never from tool arguments —
 * that keeps it out of the LLM's context window entirely.
 */

import type { ClientConfig } from '@3d-incubators/aholo-client';

export function loadClientConfig(): ClientConfig {
  const apiKey = process.env.AHOLO_API_KEY;
  if (!apiKey) {
    throw new Error(
      'AHOLO_API_KEY is not set. Add it to the MCP server config, e.g.:\n' +
        '  "env": { "AHOLO_API_KEY": "<your key from labs.aholo3d.com/api-keys>" }\n' +
        'The key is used as the raw Authorization header — no "Bearer" prefix.'
    );
  }
  const baseUrl = process.env.AHOLO_BASE_URL ?? 'https://api.aholo3d.com';
  return { baseUrl, apiKey };
}

/** Server identity reported to MCP hosts. */
export const SERVER_INFO = {
  name: 'aholo-mcp',
  version: '0.0.1',
} as const;
