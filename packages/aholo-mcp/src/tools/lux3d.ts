/**
 * Lux3D tools — single-object image/text to 3D mesh (GLB).
 *
 * Tools registered here:
 *   aholo_generate_model_from_text   — prompt + style → GLB         [submit]
 *   aholo_generate_model_from_image  — local image or URL → GLB     [submit]
 *   aholo_get_model                  — poll a Lux3D task            [status]
 *
 * Lux3D differs from World: it produces a single textured mesh (GLB + PBR),
 * not a scene-level Gaussian splat. It is faster (minutes, not 5-15) and the
 * result URL is only valid ~2 hours, so download promptly after SUCCEEDED.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, dirname, resolve as resolvePath } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  AholoApiError,
  createImageTo3D,
  createTextTo3D,
  getLux3DTask,
  type ClientConfig,
  type Lux3DTaskDetail,
} from '@3d-incubators/aholo-client';
import { repackLux3DZip } from '../repack.js';

const LUX3D_STYLES = [
  'photorealistic',
  'cartoon',
  'anime',
  'hand_painted',
  'cyberpunk',
  'fantasy',
  'glass',
] as const;

export function registerLux3DTools(server: McpServer, cfg: ClientConfig): void {
  // -------------------------------------------------------------------------
  // aholo_generate_model_from_text
  // -------------------------------------------------------------------------
  server.registerTool(
    'aholo_generate_model_from_text',
    {
      title: 'Generate a 3D model from text',
      description:
        'Generate a single 3D object (GLB mesh + PBR textures) from a text prompt ' +
        'using Lux3D. Use this for props, products, characters, furniture — one ' +
        'object, not a whole scene (for scenes use aholo_generate_world).\n\n' +
        'Submits an async task and returns a taskid immediately. Poll with ' +
        'aholo_get_model. Lux3D is faster than World (usually a few minutes). ' +
        'The result ZIP URL is valid ~2 hours, so fetch it soon after SUCCEEDED.',
      inputSchema: {
        prompt: z.string().min(1).describe('Description of the object to generate.'),
        style: z
          .enum(LUX3D_STYLES)
          .describe('Visual style. One of: ' + LUX3D_STYLES.join(', ') + '.'),
      },
    },
    async ({ prompt, style }) => {
      try {
        const task = await createTextTo3D(cfg, { prompt, style });
        return submitted(task.taskid, 'aholo_get_model');
      } catch (err) {
        return toolError('aholo_generate_model_from_text', err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // aholo_generate_model_from_image
  // -------------------------------------------------------------------------
  server.registerTool(
    'aholo_generate_model_from_image',
    {
      title: 'Generate a 3D model from an image',
      description:
        'Generate a single 3D object (GLB mesh + PBR textures) from one input ' +
        'image using Lux3D.\n\n' +
        'Provide EITHER `imagePath` (a local file path — the server reads and ' +
        'encodes it for you) OR `imageDataUrl` (an already-encoded data URL). ' +
        'Submits an async task; poll with aholo_get_model. Result URL valid ~2h.',
      inputSchema: {
        imagePath: z
          .string()
          .optional()
          .describe('Local filesystem path to the source image. The server reads and encodes it.'),
        imageDataUrl: z
          .string()
          .optional()
          .describe('Alternative to imagePath: a complete data URL (data:image/...;base64,...).'),
      },
    },
    async ({ imagePath, imageDataUrl }) => {
      try {
        let img = imageDataUrl;
        if (!img && imagePath) {
          img = await fileToDataUrl(imagePath);
        }
        if (!img) {
          return {
            isError: true,
            content: [
              { type: 'text', text: 'Provide either imagePath or imageDataUrl.' },
            ],
          };
        }
        const task = await createImageTo3D(cfg, { img });
        return submitted(task.taskid, 'aholo_get_model');
      } catch (err) {
        return toolError('aholo_generate_model_from_image', err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // aholo_get_model
  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // aholo_get_model_textured_glb
  // -------------------------------------------------------------------------
  server.registerTool(
    'aholo_get_model_textured_glb',
    {
      title: 'Download a Lux3D result + repack into a textured GLB',
      description:
        'Fetch a SUCCEEDED Lux3D task and write a SELF-CONTAINED, renderable .glb ' +
        'file to disk.\n\n' +
        'Lux3D returns a ZIP containing a GLB plus 9 separate PBR PNGs (V-Ray-style ' +
        'names — see aholo_get_model). The bare GLB renders as grey clay because it ' +
        'embeds only an 80-byte placeholder. This tool downloads the ZIP, embeds ' +
        'the three PNGs that map cleanly to standard glTF PBR slots ' +
        '(RawDiffuseFilter → baseColorTexture, TangentSpaceNormal → normalTexture, ' +
        'RawSelfIlluminationFilter → emissiveTexture), rewrites the material, and ' +
        'writes a finished GLB to `outputPath`.\n\n' +
        'V-Ray-only channels (reflect / refract / fresnel) are intentionally ' +
        'skipped — they need channel composition out of scope for this tool.\n\n' +
        'Prerequisite: the task must already be SUCCEEDED. If not, call ' +
        '`aholo_get_model` first to confirm.',
      inputSchema: {
        taskid: z.string().min(1).describe('The taskid of a SUCCEEDED Lux3D task.'),
        outputPath: z
          .string()
          .min(1)
          .describe(
            'Absolute or relative filesystem path to write the textured .glb to. ' +
              'Parent directories are created if needed.'
          ),
      },
    },
    async ({ taskid, outputPath }) => {
      try {
        const detail = await getLux3DTask(cfg, taskid);
        const status = (detail.status ?? '').toUpperCase();
        if (status !== 'SUCCEEDED') {
          return toolError(
            'aholo_get_model_textured_glb',
            new Error(
              `Task ${taskid} is ${status || 'in unknown state'}, not SUCCEEDED. ` +
                `Call aholo_get_model to poll first.`
            )
          );
        }
        const zipUrl = detail.result?.url;
        if (!zipUrl) {
          return toolError(
            'aholo_get_model_textured_glb',
            new Error(`Task ${taskid} succeeded but has no result URL — gateway may have changed shape.`)
          );
        }
        const zipBytes = await downloadBinary(zipUrl);
        const { glb, report } = repackLux3DZip(zipBytes);
        const finalPath = resolvePath(outputPath);
        await mkdir(dirname(finalPath), { recursive: true });
        await writeFile(finalPath, glb);
        return {
          structuredContent: {
            taskid,
            outputPath: finalPath,
            outputBytes: report.outputBytes,
            embedded: report.embedded,
            skipped: report.skipped,
            vRayOnly: report.vRayOnly,
          },
          content: [
            {
              type: 'text',
              text:
                `Wrote textured GLB to ${finalPath} (${(report.outputBytes / 1024).toFixed(0)} KB).\n\n` +
                `Embedded (${report.embedded.length}):\n${report.embedded.map((l) => '  ' + l).join('\n')}\n\n` +
                (report.skipped.length
                  ? `Skipped (${report.skipped.length}):\n${report.skipped.map((l) => '  ' + l).join('\n')}\n\n`
                  : '') +
                `V-Ray-only PNGs not mapped to standard glTF PBR (${report.vRayOnly.length}):\n${report.vRayOnly.map((l) => '  ' + l).join('\n')}\n\n` +
                `The resulting .glb is self-contained — load it with @manycore/aholo-viewer's GLTFLoader, model-viewer, three.js, or any standard glTF renderer and the textures will appear.`,
            },
          ],
        };
      } catch (err) {
        return toolError('aholo_get_model_textured_glb', err);
      }
    }
  );

  // -------------------------------------------------------------------------
  // aholo_get_model
  // -------------------------------------------------------------------------
  server.registerTool(
    'aholo_get_model',
    {
      title: 'Check a Lux3D model task',
      description:
        'Check the status of a Lux3D image-to-3D or text-to-3D task and get the ' +
        'result URL when ready.\n\n' +
        'Status: PENDING / RUNNING / SUCCEEDED / FAILED. Recommended poll interval ' +
        'is 10-15s. On SUCCEEDED, `result.url` points to a ZIP containing a GLB ' +
        'model and 9 separate PBR PNG textures — the URL expires in ~2 hours.\n\n' +
        '⚠ IMPORTANT: the GLB *inside* that ZIP is NOT directly renderable. It ' +
        'embeds only an 80-byte placeholder texture and does not reference the ' +
        'sibling PBR PNGs (Aholo uses V-Ray-style naming: RawDiffuseFilter, ' +
        'TangentSpaceNormal, etc. — not standard glTF). Loading it raw produces ' +
        'grey clay. To get a textured, renderable GLB use `aholo_get_model_textured_glb` ' +
        '(it downloads the ZIP, repacks the textures into standard glTF PBR slots, ' +
        'and writes a self-contained .glb file).',
      inputSchema: {
        taskid: z.string().min(1).describe('The taskid returned by a generate-model tool.'),
      },
    },
    async ({ taskid }) => {
      try {
        const detail = await getLux3DTask(cfg, taskid);
        return formatLux3D(detail);
      } catch (err) {
        return toolError('aholo_get_model', err);
      }
    }
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function downloadBinary(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`download failed ${res.status} ${res.statusText} (${url.slice(0, 80)}…)`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

interface ToolResult {
  [x: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

function submitted(taskid: string, pollTool: string): ToolResult {
  return {
    structuredContent: { taskid, status: 'PENDING' },
    content: [
      {
        type: 'text',
        text:
          `Submitted. taskid = ${taskid}\n\n` +
          `Next: call ${pollTool} with this taskid. Lux3D usually finishes in a ` +
          `few minutes. Poll every 10-15s.`,
      },
    ],
  };
}

function formatLux3D(detail: Lux3DTaskDetail): ToolResult {
  const status = (detail.status ?? '').toUpperCase();
  // The Lux3D gateway is terse and undocumented — always echo the raw payload
  // so an agent can read fields the typed parse may have missed.
  const rawLine =
    detail.raw !== undefined ? `\n\nRaw gateway payload: ${JSON.stringify(detail.raw)}` : '';
  if (status === 'SUCCEEDED' && detail.result?.url) {
    return {
      structuredContent: {
        taskid: detail.taskid,
        status,
        resultUrl: detail.result.url,
        raw: detail.raw,
      },
      content: [
        {
          type: 'text',
          text:
            `SUCCEEDED.\n\nResult ZIP (GLB + PBR textures): ${detail.result.url}\n\n` +
            `This URL expires in ~2 hours — download it now if you need to keep it. ` +
            `The GLB inside can be loaded with @manycore/aholo-viewer's GLTFLoader.` +
            rawLine,
        },
      ],
    };
  }
  if (status === 'FAILED' || status === 'CANCELLED') {
    return {
      isError: true,
      structuredContent: {
        taskid: detail.taskid,
        status,
        error: detail.error ?? null,
        raw: detail.raw,
      },
      content: [
        {
          type: 'text',
          text: `${status}. ${detail.error?.message ?? 'No error message.'}` + rawLine,
        },
      ],
    };
  }
  return {
    structuredContent: { taskid: detail.taskid, status: status || 'UNKNOWN', raw: detail.raw },
    content: [
      {
        type: 'text',
        text:
          `${status || 'IN PROGRESS'}. Not done yet — wait 10-15s and call ` +
          `aholo_get_model again with taskid ${detail.taskid}.` +
          rawLine,
      },
    ],
  };
}

async function fileToDataUrl(path: string): Promise<string> {
  const buf = await readFile(path);
  const ext = extname(path).toLowerCase().replace('.', '');
  const mime =
    ext === 'jpg' || ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'png'
        ? 'image/png'
        : ext === 'webp'
          ? 'image/webp'
          : 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function toolError(tool: string, err: unknown): ToolResult {
  let text: string;
  if (err instanceof AholoApiError) {
    text =
      `${tool} failed (HTTP ${err.httpStatus}): ${err.message}\n\n` +
      (err.httpStatus === 401
        ? 'Fix hint: AHOLO_API_KEY must be the raw key, no "Bearer" prefix.'
        : 'Fix hint: read the message above; Aholo returns human-readable errors.');
  } else {
    text = `${tool} failed: ${(err as Error).message ?? String(err)}`;
  }
  return { isError: true, content: [{ type: 'text', text }] };
}
