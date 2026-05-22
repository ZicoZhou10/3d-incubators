/**
 * World tools — 3D Gaussian Splatting generation & reconstruction.
 *
 * Tools registered here:
 *   aholo_generate_world  — text (+ optional image URL) → 3DGS world  [submit]
 *   aholo_get_world       — poll a world job, get download URLs       [status]
 *   aholo_list_worlds     — page through your worlds                  [atomic]
 *
 * `aholo_reconstruct_world` (images/video → world, with upload handling) is
 * intentionally deferred to the next iteration — it needs the OUS upload flow
 * wired in, and shipping the text path solid first follows our "single atomic
 * win" principle.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  AholoApiError,
  createGeneration,
  getWorld,
  type ClientConfig,
  type WorldDetail,
} from '@3d-incubators/aholo-client';

export function registerWorldTools(server: McpServer, cfg: ClientConfig): void {
  // -------------------------------------------------------------------------
  // aholo_generate_world
  // -------------------------------------------------------------------------
  server.registerTool(
    'aholo_generate_world',
    {
      title: 'Generate a 3D world from text',
      description:
        'Generate a 3D Gaussian Splatting (3DGS) world from a text prompt, ' +
        'optionally guided by one reference image.\n\n' +
        'This SUBMITS an asynchronous job and returns immediately with a worldId. ' +
        'Generation typically takes 5-15 minutes (sometimes longer if the account ' +
        'queue is busy). After calling this, call `aholo_get_world` with the ' +
        'returned worldId to check progress.\n\n' +
        'Do NOT call this repeatedly expecting an instant 3D model — it is async. ' +
        'One call submits one job.',
      inputSchema: {
        prompt: z
          .string()
          .min(1)
          .describe('What the 3D space should look like. Be concrete about layout, lighting, materials.'),
        imageUrl: z
          .string()
          .url()
          .optional()
          .describe('Optional public URL of a single reference image to guide generation.'),
        scene: z
          .string()
          .optional()
          .describe('Optional scene hint. Leave empty to let the server pick (defaults to "ai_gen").'),
      },
    },
    async ({ prompt, imageUrl, scene }) => {
      try {
        const op = await createGeneration(cfg, {
          prompt,
          ...(imageUrl ? { resources: [{ url: imageUrl, type: 'image' as const }] } : {}),
          ...(scene ? { scene } : {}),
        });
        return {
          structuredContent: { worldId: op.worldId, status: 'PENDING' },
          content: [
            {
              type: 'text',
              text:
                `Submitted. worldId = ${op.worldId}\n\n` +
                `Next: call aholo_get_world with this worldId. Expect PENDING for ` +
                `several minutes (queue), then RUNNING, then SUCCEEDED. Total 5-15 min ` +
                `is normal. PENDING does not mean stuck.`,
            },
          ],
        };
      } catch (err) {
        return toolError('aholo_generate_world', err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // aholo_get_world
  // -------------------------------------------------------------------------
  server.registerTool(
    'aholo_get_world',
    {
      title: 'Check a 3D world job and get its assets',
      description:
        'Check the status of a World generation/reconstruction job and, when ready, ' +
        'get the download URLs for the 3D assets.\n\n' +
        'Status values:\n' +
        '  PENDING   — queued, not started. Can last 10+ minutes. NOT stuck.\n' +
        '  RUNNING   — actively processing.\n' +
        '  SUCCEEDED — done; splat URLs are in the result.\n' +
        '  FAILED / CANCELLED — terminal failure.\n\n' +
        'When SUCCEEDED, the result includes .spz / .ply / .sog URLs. Load them with ' +
        '@manycore/aholo-viewer (a ready-to-paste snippet is included in the response). ' +
        'If still PENDING/RUNNING, wait ~30s before calling again — polling faster ' +
        'wastes requests and will not speed up the job.',
      inputSchema: {
        worldId: z.string().min(1).describe('The worldId returned by aholo_generate_world.'),
      },
    },
    async ({ worldId }) => {
      try {
        const detail = await getWorld(cfg, worldId);
        return formatWorldDetail(detail);
      } catch (err) {
        return toolError('aholo_get_world', err);
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

interface ToolResult {
  // MCP's ToolCallback return type carries an open index signature; mirror it.
  [x: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

function formatWorldDetail(detail: WorldDetail): ToolResult {
  const status = (detail.status ?? '').toUpperCase();
  const urls = detail.assets?.splats?.urls;
  const splatUrl = urls?.spzPath ?? urls?.sogPath ?? urls?.plyPath;

  if (status === 'SUCCEEDED' && splatUrl) {
    return {
      structuredContent: {
        worldId: detail.worldId,
        status,
        name: detail.name ?? null,
        splatUrl,
        urls: urls ?? {},
      },
      content: [
        {
          type: 'text',
          text:
            `SUCCEEDED — "${detail.name ?? detail.worldId}"\n\n` +
            `Splat URL (best available): ${splatUrl}\n` +
            (urls?.lodMetaPath ? `LOD meta: ${urls.lodMetaPath}\n` : '') +
            `\nRender it in a browser with @manycore/aholo-viewer:\n\n` +
            renderSnippet(splatUrl),
        },
      ],
    };
  }

  if (status === 'FAILED' || status === 'CANCELLED') {
    return {
      isError: true,
      structuredContent: { worldId: detail.worldId, status, error: detail.error ?? null },
      content: [
        {
          type: 'text',
          text:
            `${status}. ${detail.error?.message ?? 'No error message returned.'}\n\n` +
            `Fix hint: if the prompt was very short or abstract, try a more concrete ` +
            `description (layout, lighting, materials). If this keeps happening, the ` +
            `account may be out of quota — check labs.aholo3d.com.`,
        },
      ],
    };
  }

  // PENDING or RUNNING
  return {
    structuredContent: { worldId: detail.worldId, status: status || 'UNKNOWN' },
    content: [
      {
        type: 'text',
        text:
          `${status || 'IN PROGRESS'} — not done yet.\n\n` +
          `This is normal. World jobs take 5-15 minutes total. Wait ~30 seconds, ` +
          `then call aholo_get_world again with worldId ${detail.worldId}.`,
      },
    ],
  };
}

function renderSnippet(splatUrl: string): string {
  return [
    '```ts',
    "import { mountViewer, loadSplatFromUrl } from '@3d-incubators/viewer-helpers';",
    '',
    "const view = mountViewer(document.getElementById('stage')!);",
    'view.start();',
    `await loadSplatFromUrl(view, ${JSON.stringify(splatUrl)});`,
    '```',
  ].join('\n');
}

function toolError(tool: string, err: unknown): ToolResult {
  let text: string;
  if (err instanceof AholoApiError) {
    text =
      `${tool} failed (HTTP ${err.httpStatus}): ${err.message}\n\n` +
      (err.httpStatus === 401
        ? 'Fix hint: the Authorization header must be the raw API key with NO "Bearer" ' +
          'prefix. Check AHOLO_API_KEY in the MCP server env.'
        : 'Fix hint: inspect the message above; Aholo returns human-readable errors.');
  } else {
    text = `${tool} failed: ${(err as Error).message ?? String(err)}`;
  }
  return { isError: true, content: [{ type: 'text', text }] };
}
