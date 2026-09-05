#!/usr/bin/env node
/**
 * @fileoverview Entry point for the Agent Bridge MCP Server.
 * Supports Stdio transport for pairing coding assistants (Driver & Navigator).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { resolveConfig } from './config.js';
import { Store } from './store.js';
import { runWatcher } from './watcher.js';
import { registerProposalTools } from './tools/proposals.js';
import { registerChatTools } from './tools/chat.js';
import { registerDiffTools } from './tools/diff.js';
import { registerInboxTools } from './tools/inbox.js';

async function main() {
  const config = resolveConfig();

  if (config.isWatch) {
    const ac = new AbortController();
    const onSig = () => ac.abort();
    process.on('SIGINT', onSig);
    process.on('SIGTERM', onSig);

    try {
      const result = await runWatcher({
        role: config.role,
        storageDir: config.storageDir,
        signal: ac.signal,
      });

      if (result.reason === 'peer_activity') {
        console.log(`[agent-bridge] Peer activity detected: ${result.detectedItems} item(s). Exiting to trigger agent wakeup.`);
      } else if (result.reason === 'timeout') {
        console.log('[agent-bridge] Watch timed out after 15m. Exiting.');
      } else {
        console.log('[agent-bridge] Watcher aborted.');
      }
      process.exit(0);
    } finally {
      process.off('SIGINT', onSig);
      process.off('SIGTERM', onSig);
    }
  }

  const store = new Store(config.storageDir);
  await store.init();

  const server = new McpServer({
    name: 'agent-bridge',
    version: '0.2.0',
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
