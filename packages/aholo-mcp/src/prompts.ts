/**
 * MCP Prompts — paste-ready starter prompts the host (Claude Code, Cursor)
 * can surface in its UI. Each returns a `messages` array the host injects
 * into the conversation.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const HELLO_WORLD = `I want to generate a tiny 3D object end-to-end to verify the Aholo MCP is wired up.

Please:
1. Call aholo_choose_api to confirm you have the right tools.
2. Call aholo_generate_model_from_text with a simple prompt and style (e.g. "a small white ceramic mug", style "photorealistic").
3. Poll aholo_get_model every ~15s until SUCCEEDED.
4. Call aholo_get_model_textured_glb to download + repack into a renderable GLB at ./hello-world.glb.
5. Report the file size, the texture slots embedded, and the V-Ray-only PNGs that were skipped.

Lux3D usually takes 4-8 minutes. Do not poll faster than every 12s.`;

const DEBUG_STUCK_JOB = `I have a job id that seems stuck or failed. Help me diagnose it.

Steps:
1. Ask me for the id if I haven't provided one.
2. Call aholo_diagnose_job with kind="auto".
3. Translate the diagnosis into plain language and the single next action I should take.
4. If the diagnosis says PENDING/RUNNING and the elapsed time is within normal bounds (World: <15 min PENDING + <15 min RUNNING; Lux3D: <10 min), tell me to wait — don't recommend resubmit.
5. If the diagnosis says SUCCEEDED but Lux3D and the result URL is past its 2h window, recommend resubmit (URLs are signed once).`;

const WHY_401 = `My Aholo API call is returning 401 UNAUTHENTICATED.

Run through this checklist in order:
1. Is AHOLO_API_KEY set in the MCP server's environment? (Not as a tool argument — env only.)
2. Is the Authorization header the **raw** key, with NO "Bearer" prefix? (The Aholo gateway is non-standard here — almost every developer hits this once.)
3. Is the baseUrl correct for the region you want? (.com global vs .cn China — different keys.)
4. Did the key get revoked or rotated at labs.aholo3d.com/api-keys?

Read aholo://errors/catalog for the full table. Report which check found the issue.`;

interface PromptDef {
  name: string;
  title: string;
  description: string;
  body: string;
}

const PROMPTS: PromptDef[] = [
  {
    name: 'aholo-hello-world',
    title: 'Hello world — verify MCP end-to-end',
    description: 'Generate a tiny 3D object, repack, and report. Smallest test of the full Lux3D path.',
    body: HELLO_WORLD,
  },
  {
    name: 'aholo-debug-stuck-job',
    title: 'Debug a stuck or failed job',
    description: 'Diagnose a worldId or Lux3D taskid and recommend a single next action.',
    body: DEBUG_STUCK_JOB,
  },
  {
    name: 'aholo-why-401',
    title: 'Fix a 401 from the Aholo gateway',
    description: 'Walk the checklist for the most common Aholo authentication failure.',
    body: WHY_401,
  },
];

export function registerPrompts(server: McpServer): void {
  for (const p of PROMPTS) {
    server.registerPrompt(
      p.name,
      { title: p.title, description: p.description },
      async () => ({
        messages: [
          {
            role: 'user',
            content: { type: 'text', text: p.body },
          },
        ],
      })
    );
  }
}
