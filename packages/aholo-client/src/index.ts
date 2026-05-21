/**
 * @3d-incubators/aholo-client
 *
 * A typed, zero-dep REST client for the Aholo Open Platform.
 * Designed to be readable by coding agents in <2 min.
 *
 * Quick start:
 *
 * ```ts
 * import { generateAndWait } from '@3d-incubators/aholo-client';
 *
 * const world = await generateAndWait(
 *   { baseUrl: 'https://api.aholo3d.com', apiKey: process.env.AHOLO_API_KEY! },
 *   { prompt: 'a sun-lit nordic living room' }
 * );
 * console.log(world.assets?.splats?.urls?.spzPath);
 * ```
 */

export type { ClientConfig } from './http.js';
export { AholoApiError, request } from './http.js';
export { pollUntilDone, type PollOptions, type PollResult } from './polling.js';

export * from './types.js';

// World
export {
  createGeneration,
  createReconstruction,
  generateAndWait,
  reconstructAndWait,
  getWorld,
  pollWorld,
} from './world.js';

// Lux3D
export {
  createImageTo3D,
  createTextTo3D,
  getLux3DTask,
  pollLux3D,
  type ImageTo3DInput,
  type TextTo3DInput,
} from './lux3d.js';

// Asset upload
export { getUploadToken, uploadSingleFile, type UploadResult } from './asset.js';

// RenderCloud (stub — re-exports a friendly error string for now)
export { RENDERCLOUD_NOT_IMPLEMENTED } from './rendercloud.js';
