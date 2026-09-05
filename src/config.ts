/**
 * @fileoverview Configuration resolver for the agent-bridge server instance.
 */

import { AgentRole } from './types.js';

export interface BridgeConfig {
  role: AgentRole;
  storageDir?: string;
  isWatch: boolean;
}

/**
 * Resolves the agent role from command line arguments or environment variables.
 * Command-line arguments take precedence over environment variables.
 * Default role is 'driver'.
 */
export function resolveConfig(args: string[] = process.argv.slice(2)): BridgeConfig {
  let role: AgentRole | undefined;
  let storageDir: string | undefined;
  let isWatch = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === 'watch' || arg === '--watch') {
      isWatch = true;
    } else if (arg === '--role' && args[i + 1]) {
      const candidate = args[i + 1].toLowerCase();
      if (candidate === 'driver' || candidate === 'navigator') {
        role = candidate;
      }
      i++;
    } else if (arg.startsWith('--role=')) {
      const candidate = arg.slice(7).toLowerCase();
      if (candidate === 'driver' || candidate === 'navigator') {
        role = candidate;
      }
    } else if (arg === '--storage-dir' && args[i + 1]) {
      storageDir = args[i + 1];
      i++;
    } else if (arg.startsWith('--storage-dir=')) {
      storageDir = arg.slice(14);
    }
  }

  if (!role && process.env.AGENT_ROLE) {
    const candidate = process.env.AGENT_ROLE.toLowerCase();
    if (candidate === 'driver' || candidate === 'navigator') {
      role = candidate;
    }
  }

  if (!storageDir && process.env.AGENT_BRIDGE_DIR) {
    storageDir = process.env.AGENT_BRIDGE_DIR;
  }

  return {
    role: role || 'driver',
    storageDir,
    isWatch,
  };
}
