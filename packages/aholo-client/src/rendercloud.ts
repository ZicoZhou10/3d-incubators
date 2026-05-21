/**
 * Aholo RenderCloud — OpenUSD offline & real-time rendering.
 *
 * Stub for now. Demo 1 doesn't need this; we'll grow it when a demo demands it.
 * Endpoints to cover when implementing:
 *   POST   /rendercloud/v1/jobs                     — offline
 *   POST   /rendercloud/v1/streams                  — realtime session create / poll
 *   POST   /rendercloud/v1/streams/{sessionId}:push — push USDA patch
 *   DELETE /rendercloud/v1/streams/{sessionId}      — close session
 *   POST   /rendercloud/v1/mesh-upload-process/task/create
 *   GET    /rendercloud/v1/mesh-upload-process/task/get
 *
 * Reference: @manycore/aholo-render-cloud (already wraps WS streaming protocol).
 */

export const RENDERCLOUD_NOT_IMPLEMENTED =
  'RenderCloud client not yet implemented in @3d-incubators/aholo-client. ' +
  'See @manycore/aholo-render-cloud (re-exported from @manycore/aholo-viewer as `RenderCloud`) ' +
  'for the realtime stream wrapper.';
