/**
 * @fileoverview Configuration resolver for the agent-bridge server instance.
 */

import { AgentRole } from './types.js';

export interface BridgeConfig {
  role: AgentRole;
  storageDir?: string;
}

/**
 * Resolves the agent role from command line arguments or environment variables.
 * Command-line arguments take precedence over environment variables.
 * Default role is 'driver'.
 */
export function resolveConfig(args: string[] = process.argv.slice(2)): BridgeConfig {
  let role: AgentRole | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--role' && args[i + 1]) {
      const candidate = args[i + 1].toLowerCase();
      if (candidate === 'driver' || candidate === 'navigator') {
        role = candidate;
      }
      i++;
    } else if (args[i].startsWith('--role=')) {
      const candidate = args[i].slice(7).toLowerCase();
      if (candidate === 'driver' || candidate === 'navigator') {
        role = candidate;
      }
    }
  }

  if (!role && process.env.AGENT_ROLE) {
    const candidate = process.env.AGENT_ROLE.toLowerCase();
    if (candidate === 'driver' || candidate === 'navigator') {
      role = candidate;
    }
  }

  return {
    role: role || 'driver',
    storageDir: process.env.AGENT_BRIDGE_DIR,
  };
}
