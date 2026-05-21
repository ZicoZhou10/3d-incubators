/**
 * Shared types for Aholo Open Platform.
 *
 * Source of truth: OpenAPI spec at https://labs.aholo3d.com/api-docs/en/openapi.json
 * This file is hand-curated to match the spec for the subset of operations
 * the lighthouse demos actually call. If a field is missing, prefer to extend
 * the type narrowly rather than `as any`.
 */

export type TaskQuality = 'low' | 'normal' | 'high';

export type WorldStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | string; // server may evolve; treat unknowns as in-progress

export type ResourceType = 'image' | 'video';

export interface Resource {
  url: string;
  type?: ResourceType;
}

export interface ReconstructionRequest {
  resources: Resource[];
  scene: string;
  taskQuality: TaskQuality;
}

export interface GenerationRequest {
  prompt?: string;
  resources?: Resource[];
  scene?: string;
  taskQuality?: TaskQuality;
}

export interface WorldAsyncOperation {
  /** Encrypted world id used to poll details. */
  worldId: string;
  done?: boolean;
}

export interface SplatUrls {
  plyPath?: string;
  spzPath?: string;
  sogPath?: string;
  lodMetaPath?: string;
}

export interface WorldAssets {
  splats?: {
    urls?: SplatUrls;
  };
}

export interface WorldDetail {
  worldId: string;
  status: WorldStatus;
  scene?: string;
  taskQuality?: TaskQuality;
  /** Unix milliseconds. */
  createTime?: number;
  /** Unix milliseconds. */
  updateTime?: number;
  assets?: WorldAssets;
  error?: ApiError;
}

export interface ApiError {
  code?: string | number;
  message?: string;
  status?: string;
  details?: unknown;
}

export interface Lux3DTaskCreated {
  taskid: string;
}

export type Lux3DStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | string;

export interface Lux3DTaskDetail {
  taskid: string;
  status: Lux3DStatus;
  /** ZIP archive URL with GLB + PBR textures. Valid ~2h. */
  result?: { url?: string };
  error?: ApiError;
}

export interface AssetUploadToken {
  ousToken: string;
  /** Domain to POST upload to. Different from the gateway. */
  globalDomain: string;
  blockSize: number;
}
