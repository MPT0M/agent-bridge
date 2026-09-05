/**
 * @fileoverview Event-driven filesystem watcher for reactive agent pairing.
 * Implements a single-shot sentinel that terminates upon peer activity or timeout,
 * enabling zero-token idle pairing for Claude Code and Antigravity.
 */

import { watch as fsWatch, type FSWatcher } from 'node:fs';
import { AgentRole } from './types.js';
import { Store } from './store.js';

export interface WatcherOptions {
  role: AgentRole;
  storageDir?: string;
  coalescenceMs?: number;
  timeoutMs?: number;
  store?: Store;
  signal?: AbortSignal;
}

export interface WatcherResult {
  reason: 'peer_activity' | 'timeout' | 'aborted';
  detectedItems: number;
}

/**
 * Runs a single-shot filesystem watcher on the agent-bridge directory.
 * Resolves when peer activity is detected, when the operation times out,
 * or when the passed AbortSignal is triggered.
 */
export async function runWatcher(options: WatcherOptions): Promise<WatcherResult> {
  const store = options.store ?? new Store(options.storageDir);
  await store.init();

  const role = options.role;
  const coalescenceMs = options.coalescenceMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 900_000;

  if (options.signal?.aborted) {
    return { reason: 'aborted', detectedItems: 0 };
  }

  return new Promise<WatcherResult>((resolve, reject) => {
    let resolved = false;
    const watchers: FSWatcher[] = [];
    let coalesceTimer: NodeJS.Timeout | null = null;
    let globalTimeoutTimer: NodeJS.Timeout | null = null;

    const teardown = () => {
      if (coalesceTimer) {
        clearTimeout(coalesceTimer);
        coalesceTimer = null;
      }
      if (globalTimeoutTimer) {
        clearTimeout(globalTimeoutTimer);
        globalTimeoutTimer = null;
      }
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          // Ignore errors during watcher closing
        }
      }
      watchers.length = 0;
      if (options.signal && onAbort) {
        options.signal.removeEventListener('abort', onAbort);
      }
    };

    const finish = (result: WatcherResult) => {
      if (resolved) return;
      resolved = true;
      teardown();
      resolve(result);
    };

    let onAbort: (() => void) | null = null;
    if (options.signal) {
      onAbort = () => {
        finish({ reason: 'aborted', detectedItems: 0 });
      };
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    // Set global timeout (15 minutes default)
    globalTimeoutTimer = setTimeout(() => {
      finish({ reason: 'timeout', detectedItems: 0 });
    }, timeoutMs);
    globalTimeoutTimer.unref();

    const checkInboxAfterCoalescence = async () => {
      try {
        const inbox = await store.getInbox({ role, filter: 'unread' });
        if (inbox.unreadCount > 0) {
          finish({ reason: 'peer_activity', detectedItems: inbox.unreadCount });
        }
      } catch (err) {
        console.error('[agent-bridge watcher] Error querying inbox during coalescence:', err);
      }
    };

    const onFsEvent = () => {
      if (resolved) return;
      if (coalesceTimer) {
        clearTimeout(coalesceTimer);
      }
      coalesceTimer = setTimeout(checkInboxAfterCoalescence, coalescenceMs);
      coalesceTimer.unref();
    };

    const watchDirs = [
      store.getMessagesDir(),
      store.getProposalsDir(),
      store.getDiffsDir(),
    ];

    // 1. Attach FS watchers first so no filesystem events are dropped
    for (const dir of watchDirs) {
      try {
        const w = fsWatch(dir, onFsEvent);
        w.on('error', (err) => {
          console.error(`[agent-bridge watcher] Watch error on ${dir}:`, err);
        });
        watchers.push(w);
      } catch (err) {
        teardown();
        reject(err);
        return;
      }
    }

    // 2. Pre-check at t=0 to resolve immediately if unread items already exist
    store.getInbox({ role, filter: 'unread' })
      .then((initial) => {
        if (!resolved && initial.unreadCount > 0) {
          finish({ reason: 'peer_activity', detectedItems: initial.unreadCount });
        }
      })
      .catch((err) => {
        console.error('[agent-bridge watcher] Initial inbox check error:', err);
      });
  });
}
