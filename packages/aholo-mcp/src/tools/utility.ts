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
import {
  getWorld,
  getLux3DTask,
  type ClientConfig,
} from '@3d-incubators/aholo-client';

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

export function registerUtilityTools(server: McpServer, cfg: ClientConfig): void {
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

  // -------------------------------------------------------------------------
  // aholo_diagnose_job
  // -------------------------------------------------------------------------
  server.registerTool(
    'aholo_diagnose_job',
    {
      title: 'Diagnose a stuck or failed job',
      description:
        'Inspect a World worldId or Lux3D taskid, fetch its current state, and ' +
        'return a structured diagnosis: status, elapsed time, what to do next. ' +
        'Use when a job seems stuck or you forgot which kind of id it was.',
      inputSchema: {
        id: z.string().min(1).describe('A worldId (World) or taskid (Lux3D).'),
        kind: z
          .enum(['world', 'lux3d', 'auto'])
          .default('auto')
          .describe('Hint which API the id belongs to. "auto" tries World first, then Lux3D.'),
      },
    },
    async ({ id, kind }) => {
      const tried: string[] = [];
      const tryWorld = async () => {
        tried.push('world');
        const detail = await getWorld(cfg, id);
        const status = (detail.status ?? '').toUpperCase();
        const age =
          typeof detail.createTime === 'number'
            ? Math.round((Date.now() - detail.createTime) / 1000)
            : undefined;
        const advice = worldAdvice(status, age);
        return {
          structuredContent: { api: 'world', id, status, ageSeconds: age, detail },
          content: [
            {
              type: 'text',
              text:
                `[World] ${id}\n` +
                `  status: ${status}\n` +
                (age !== undefined ? `  age: ${age}s since createTime\n` : '') +
                `  advice: ${advice}`,
            },
          ],
        } satisfies UtilityResult;
      };
      const tryLux3D = async () => {
        tried.push('lux3d');
        const detail = await getLux3DTask(cfg, id);
        const status = (detail.status ?? '').toUpperCase();
        const advice = lux3dAdvice(status, detail.result?.url);
        return {
          structuredContent: { api: 'lux3d', id, status, detail },
          content: [
            {
              type: 'text',
              text:
                `[Lux3D] ${id}\n` +
                `  status: ${status}\n` +
                (detail.result?.url ? `  resultUrl: ${detail.result.url.slice(0, 100)}…\n` : '') +
                `  advice: ${advice}`,
            },
          ],
        } satisfies UtilityResult;
      };

      try {
        if (kind === 'world') return await tryWorld();
        if (kind === 'lux3d') return await tryLux3D();
        // auto
        try {
          return await tryWorld();
        } catch {
          return await tryLux3D();
        }
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text:
                `Could not diagnose id "${id}" via ${tried.join(', ') || 'any API'}: ` +
                `${(err as Error).message}.\n` +
                `If it's a Lux3D taskid that succeeded over 2h ago the result URL has ` +
                `expired — Lux3D signs URLs once at submission time.`,
            },
          ],
        };
      }
    }
  );
}

interface UtilityResult {
  [x: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

function worldAdvice(status: string, ageSeconds: number | undefined): string {
  if (status === 'SUCCEEDED') return 'Done. Read `assets.splats.urls` for the splat files.';
  if (status === 'FAILED') return 'Check `error.message`. World gen failures usually mean a too-abstract prompt or quota.';
  if (status === 'CANCELLED') return 'Job was cancelled. Re-submit if you still want the output.';
  if (status === 'RUNNING') {
    return ageSeconds && ageSeconds > 20 * 60
      ? 'RUNNING for >20 min — unusually long; consider a fresh submit. Normal is 5-15 min total.'
      : 'Normal. Wait ~30 s and re-poll.';
  }
  if (status === 'PENDING') {
    return ageSeconds && ageSeconds > 15 * 60
      ? 'PENDING for >15 min — long queue. Account may have hit a concurrency limit. Still likely to start; do not abort.'
      : 'Queued — NOT stuck. Wait ~30 s and re-poll.';
  }
  return `Unknown status "${status}". Re-poll, or use aholo_choose_api to confirm the right tool.`;
}

function lux3dAdvice(status: string, hasUrl: string | undefined): string {
  if (status === 'SUCCEEDED' && hasUrl)
    return 'Done. Call aholo_get_model_textured_glb to download + repack into a renderable GLB.';
  if (status === 'SUCCEEDED')
    return 'Marked SUCCEEDED but no result URL — Lux3D URL likely expired (2 h window). Resubmit.';
  if (status === 'FAILED') return 'Resubmit with a more concrete prompt + matching style.';
  if (status === 'RUNNING' || status === 'PENDING') return 'Normal. Wait 10-15 s and re-poll.';
  return `Unknown status "${status}". Re-poll.`;
}
