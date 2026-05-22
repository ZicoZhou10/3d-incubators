/**
 * Utility tools — orientation help that prevents the most common agent mistakes.
 *
 *   aholo_choose_api — decision tree: "I want to do X, which tool do I call?"
 *
 * This tool calls no API and costs no quota. It exists because the single
 * biggest agent failure mode is picking the wrong primitive (e.g. using World
 * generation for a single prop, or expecting an instant synchronous result).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const GUIDE = `# Aholo capability map — which tool for which job

## You want a whole 3D SPACE or SCENE (a room, a street, an environment)
- From a text description        -> aholo_generate_world
- From a reference image + text  -> aholo_generate_world (pass imageUrl)
- Output: a 3D Gaussian Splat (.spz/.ply). Walkable in @manycore/aholo-viewer.
- Time: 5-15 min, async. Submit, then poll aholo_get_world.

## You want a single OBJECT (a prop, a product, a character, furniture)
- From a text description  -> aholo_generate_model_from_text (needs a style)
- From one image           -> aholo_generate_model_from_image
- Output: a GLB mesh + PBR textures, in a ZIP. Result URL valid ~2h.
- Time: a few minutes, async. Submit, then poll aholo_get_model.

## Rule of thumb
- "Can I walk around inside it?"  -> World (splat)
- "Is it one thing on a table?"   -> Lux3D (mesh)

## Things that will bite you
- Everything is ASYNC. No tool returns a finished 3D asset in one call.
  Submit -> get a job id -> poll a get_* tool. Budget minutes, not seconds.
- PENDING is not "stuck". World jobs can queue 10+ minutes before RUNNING.
- The Authorization header is the raw API key. No "Bearer" prefix. A 401
  almost always means a Bearer prefix crept in, or the key env var is unset.
- Lux3D result URLs expire in ~2 hours. World splat URLs are longer-lived
  but treat them as not-forever; re-fetch via aholo_get_world if a link breaks.

## Not yet exposed by this MCP server
- World reconstruction from your own photos/video (needs the OUS upload flow).
- RenderCloud OpenUSD rendering. For real-time streaming, use the RenderCloud
  namespace re-exported from @manycore/aholo-viewer directly.`;

export function registerUtilityTools(server: McpServer): void {
  server.registerTool(
    'aholo_choose_api',
    {
      title: 'Which Aholo tool should I use?',
      description:
        'Returns a concise decision guide mapping intents (whole scene vs single ' +
        'object, text vs image input) to the right Aholo tool, plus the common ' +
        'pitfalls. Call this first if you are unsure which generate/get tool to ' +
        'use. Costs no API quota.',
      inputSchema: {
        intent: z
          .string()
          .optional()
          .describe('Optional free-text description of what you are trying to build.'),
      },
    },
    async ({ intent }) => {
      const head = intent
        ? `You described: "${intent}"\n\nMatch it against the guide below.\n\n`
        : '';
      return {
        content: [{ type: 'text', text: head + GUIDE }],
      };
    }
  );
}
