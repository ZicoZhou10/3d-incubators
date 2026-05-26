/**
 * World tools — 3D Gaussian Splatting generation & reconstruction.
 *
 * Tools registered here:
 *   aholo_generate_world      — text (+ optional image URL) → 3DGS world  [submit]
 *   aholo_reconstruct_world   — local paths and/or public URLs → 3DGS    [submit, with OUS upload]
 *   aholo_get_world           — poll a world job, get download URLs       [status]
 */

import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  AholoApiError,
  createGeneration,
  createReconstruction,
  getWorld,
  getUploadToken,
  listWorlds,
  uploadSingleFile,
  type ClientConfig,
  type Resource,
  type TaskQuality,
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
  // aholo_reconstruct_world
  // -------------------------------------------------------------------------
  server.registerTool(
    'aholo_reconstruct_world',
    {
      title: 'Reconstruct a 3DGS world from your own images or video',
      description:
        'Submit a World **reconstruction** job from a set of your own assets — ' +
        "≥20 photos of the same scene, OR a video walking through it.\n\n" +
        'Accepts two input shapes (you can mix them):\n' +
        '  • `imagePaths`/`videoPath`: local filesystem paths. The server uploads ' +
        "them through Aholo's OUS object storage on your behalf — you do NOT " +
        'need to know about the OUS protocol, the upload token, or the separate ' +
        'globalDomain. The tool absorbs that complexity.\n' +
        '  • `resourceUrls`: public HTTPS URLs that the gateway can already fetch.\n\n' +
        'Submits an async job and returns immediately with a `worldId`. World ' +
        'reconstruction is the slowest path on the platform — observed total time ' +
        '5–15 minutes including PENDING queueing. Poll with `aholo_get_world`.\n\n' +
        'Input rule: pass EITHER `imagePaths` (≥20 entries) OR `videoPath` (one ' +
        'file), or a mix that includes `resourceUrls`. Mixing local + URL is fine.',
      inputSchema: {
        imagePaths: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'Local filesystem paths to ≥20 photos of the same scene. The server ' +
              'reads + uploads each via OUS and feeds the resulting URLs to the ' +
              'reconstruction job. Files larger than the OUS single-upload block ' +
              'size will error — split or compress beforehand.'
          ),
        videoPath: z
          .string()
          .optional()
          .describe('Local filesystem path to one walkthrough video (.mp4/.mov/.webm).'),
        resourceUrls: z
          .array(z.string().url())
          .optional()
          .describe('Public HTTPS URLs the gateway can fetch (skip OUS upload).'),
        scene: z
          .string()
          .min(1)
          .describe('Scene tag, e.g. "model" or "space". Required by the World API.'),
        taskQuality: z
          .enum(['low', 'normal', 'high'])
          .default('normal')
          .describe('Reconstruction quality. "high" is slower but sharper.'),
      },
    },
    async ({ imagePaths, videoPath, resourceUrls, scene, taskQuality }) => {
      try {
        const resources: Resource[] = [];

        // 1. Pre-resolved public URLs pass through unchanged.
        for (const url of resourceUrls ?? []) {
          resources.push({ url });
        }

        // 2. Local files — request one OUS token, upload each, collect URLs.
        const allLocal = [
          ...(imagePaths ?? []).map((p) => ({ p, type: 'image' as const })),
          ...(videoPath ? [{ p: videoPath, type: 'video' as const }] : []),
        ];

        if (allLocal.length > 0) {
          const token = await getUploadToken(cfg);
          for (const { p, type } of allLocal) {
            const stats = await stat(p);
            if (stats.size > token.blockSize) {
              throw new Error(
                `Local file ${basename(p)} is ${stats.size} bytes — exceeds OUS single-upload ` +
                  `blockSize (${token.blockSize}). Chunked upload is not yet wired in this tool; ` +
                  `for now, compress or split the file.`
              );
            }
            const bytes = await readFile(p);
            const blob = new Blob([new Uint8Array(bytes)], { type: mimeOf(p) });
            const { url } = await uploadSingleFile(token, blob);
            resources.push({ url, type });
          }
        }

        if (resources.length === 0) {
          return toolError(
            'aholo_reconstruct_world',
            new Error('Provide at least one of imagePaths, videoPath, or resourceUrls.')
          );
        }

        const op = await createReconstruction(cfg, {
          resources,
          scene,
          taskQuality: (taskQuality ?? 'normal') as TaskQuality,
        });
        return {
          structuredContent: { worldId: op.worldId, status: 'PENDING', resourceCount: resources.length },
          content: [
            {
              type: 'text',
              text:
                `Submitted. worldId = ${op.worldId}\n` +
                `Resources sent: ${resources.length} (${(imagePaths?.length ?? 0)} local images, ` +
                `${videoPath ? 1 : 0} local video, ${resourceUrls?.length ?? 0} URLs).\n\n` +
                `Next: poll with aholo_get_world. World reconstruction takes 5-15 min ` +
                `including queue time. PENDING does not mean stuck.`,
            },
          ],
        };
      } catch (err) {
        return toolError('aholo_reconstruct_world', err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // aholo_list_worlds
  // -------------------------------------------------------------------------
  server.registerTool(
    'aholo_list_worlds',
    {
      title: 'List your World jobs',
      description:
        'Page through World jobs owned by the current API key. Useful for ' +
        'recovering forgotten worldIds, or for "what did I generate last week" ' +
        'queries. Status filter is optional — when omitted, returns all ' +
        'statuses (PENDING/RUNNING/SUCCEEDED/FAILED/...).',
      inputSchema: {
        pageNum: z.number().int().min(1).default(1).describe('1-indexed page number.'),
        pageSize: z.number().int().min(1).max(100).default(20).describe('Items per page.'),
        statusList: z
          .array(z.string())
          .optional()
          .describe('Filter to specific statuses, e.g. ["SUCCEEDED"]. Empty = all.'),
      },
    },
    async ({ pageNum, pageSize, statusList }) => {
      try {
        const resp = await listWorlds(cfg, {
          pageNum,
          pageSize,
          ...(statusList ? { statusList } : {}),
        });
        const list = resp.list ?? [];
        const lines = list.map((w) => {
          const name = w.name ? `"${w.name}"` : '';
          const created = w.createTime ? new Date(w.createTime).toISOString() : '?';
          return `  ${w.worldId}  [${w.status}]  ${name}  created=${created}`;
        });
        return {
          structuredContent: {
            total: resp.total ?? list.length,
            pageNum: resp.pageNum ?? pageNum,
            pageSize: resp.pageSize ?? pageSize,
            list,
          },
          content: [
            {
              type: 'text',
              text:
                `Page ${resp.pageNum ?? pageNum} of worlds (total ${resp.total ?? '?'}, returned ${list.length}):\n` +
                (lines.length > 0 ? lines.join('\n') : '  (none)'),
            },
          ],
        };
      } catch (err) {
        return toolError('aholo_list_worlds', err);
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

/** Minimal extension → MIME map for OUS uploads. */
function mimeOf(path: string): string {
  const ext = extname(path).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.mp4':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.webm':
      return 'video/webm';
    default:
      return 'application/octet-stream';
  }
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
