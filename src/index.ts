#!/usr/bin/env node
/**
 * @fileoverview Entry point for the Agent Bridge MCP Server.
 * Supports Stdio transport for pairing coding assistants (Driver & Navigator).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveConfig } from './config.js';
import { Store } from './store.js';
import { registerProposalTools } from './tools/proposals.js';
import { registerChatTools } from './tools/chat.js';
import { registerDiffTools } from './tools/diff.js';
import { registerInboxTools } from './tools/inbox.js';

async function main() {
  const config = resolveConfig();
  const store = new Store(config.storageDir);
  await store.init();

  const server = new McpServer({
    name: 'agent-bridge',
    version: '0.1.0',
  });

  // Register all tools with contextual role binding
  registerProposalTools({ server, store, role: config.role });
  registerChatTools({ server, store, role: config.role });
  registerDiffTools({ server, store, role: config.role });
  registerInboxTools({ server, store, role: config.role });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log diagnostic info to stderr so stdout remains exclusively clean for JSON-RPC
  console.error(`[agent-bridge] MCP server started in stdio mode (role: ${config.role})`);
}

main().catch((err) => {
  console.error('[agent-bridge] Fatal server error:', err);
  process.exit(1);
});
