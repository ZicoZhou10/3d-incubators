#!/usr/bin/env node
/**
 * Aholo MCP server — entry point.
 *
 * Exposes the Aholo Spatial APIs (World 3DGS, Lux3D, RenderCloud) as MCP tools
 * so any MCP-aware agent (Claude Code, Cursor, ...) can generate and render 3D.
 *
 * Design stance (see docs in README):
 *   - Composite tools fuse multi-step flows (upload + submit) but do NOT block
 *     for the full 5-15 min generation time. They submit and return; the agent
 *     polls with a `get` tool. Blocking an MCP call for 15 minutes would hang
 *     the host.
 *   - The API key is read from env, never from tool args.
 *   - Every tool description carries the orchestration know-how an agent would
 *     otherwise have to discover by trial and error.
 *
 * Transport: stdio (works with Claude Code, Claude Desktop, Cursor).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadClientConfig, SERVER_INFO } from './config.js';
import { registerWorldTools } from './tools/world.js';
import { registerLux3DTools } from './tools/lux3d.js';
import { registerUtilityTools } from './tools/utility.js';

async function main(): Promise<void> {
  // Fail fast and loud if the key is missing — before the transport connects.
  const clientConfig = loadClientConfig();

  const server = new McpServer(SERVER_INFO);

  registerWorldTools(server, clientConfig);
  registerLux3DTools(server, clientConfig);
  registerUtilityTools(server);
  // RenderCloud + reconstruction-with-upload + resources land in the next pass.

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Note: do not console.log to stdout — stdio transport owns it.
  // Diagnostics go to stderr.
  process.stderr.write(`[aholo-mcp] ready (${SERVER_INFO.version})\n`);
}

main().catch((err) => {
  process.stderr.write(`[aholo-mcp] fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
