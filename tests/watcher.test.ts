/**
 * @fileoverview Test suite for the event-driven single-shot watcher (agent-bridge watch).
 * Verifies peer activity detection, echo filtering, peer review notifications,
 * startup t=0 detection, coalescence batching, abort signals, and timeouts.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.js';
import { runWatcher } from '../src/watcher.js';

describe('Watcher (agent-bridge watch)', () => {
  let tempDir: string;
  let store: Store;
  let abortControllers: AbortController[];

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bridge-watch-test-'));
    store = new Store(tempDir);
    await store.init();
    abortControllers = [];
  });

  afterEach(async () => {
    for (const ac of abortControllers) {
      ac.abort();
    }
    // Give event loop a tick to close open watchers
    await new Promise((r) => setTimeout(r, 20));
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore directory cleanup error
    }
  });

  function createSignal(): AbortSignal {
    const ac = new AbortController();
    abortControllers.push(ac);
    return ac.signal;
  }

  it('filters echo: does not trigger when own role writes a message', async () => {
    const watchPromise = runWatcher({
      role: 'driver',
      store,
      coalescenceMs: 30,
      timeoutMs: 150,
      signal: createSignal(),
    });

    // Write a message authored by driver (echo)
    await store.createMessage({
      author: 'driver',
      message: 'Message from driver to navigator',
    });

    const result = await watchPromise;
    expect(result.reason).toBe('timeout');
    expect(result.detectedItems).toBe(0);
  });

  it('triggers when peer writes a chat message', async () => {
    const watchPromise = runWatcher({
      role: 'navigator',
      store,
      coalescenceMs: 30,
      timeoutMs: 1000,
      signal: createSignal(),
    });

    // Driver writes message to navigator
    await store.createMessage({
      author: 'driver',
      message: 'Wake up navigator!',
    });

    const result = await watchPromise;
    expect(result.reason).toBe('peer_activity');
    expect(result.detectedItems).toBe(1);
  });

  it('triggers when peer reviews a proposal (peer review dispatch)', async () => {
    // Driver creates proposal
    const proposal = await store.createProposal({
      title: 'Add watcher capability',
      proposal: 'Implement single-shot reactive watcher',
      author: 'driver',
    });

    // Initialize driver cursor so driver considers this proposal already known
    await store.getInbox({ role: 'driver', filter: 'unread', markAsRead: true });

    // Start watcher for driver
    const watchPromise = runWatcher({
      role: 'driver',
      store,
      coalescenceMs: 30,
      timeoutMs: 1000,
      signal: createSignal(),
    });

    // Navigator reviews driver proposal
    await store.reviewProposal({
      proposalId: proposal.id,
      reviewer: 'navigator',
      verdict: 'APPROVED',
      critique: 'Plan looks solid and clean.',
    });

    const result = await watchPromise;
    expect(result.reason).toBe('peer_activity');
    expect(result.detectedItems).toBe(1);
  });

  it('detects unread items at t=0 immediately without waiting for fs events', async () => {
    // Write message prior to watcher starting
    await store.createMessage({
      author: 'navigator',
      message: 'Pre-existing message waiting in inbox',
    });

    // Watcher should resolve immediately
    const start = Date.now();
    const result = await runWatcher({
      role: 'driver',
      store,
      coalescenceMs: 500,
      timeoutMs: 5000,
      signal: createSignal(),
    });
    const elapsed = Date.now() - start;

    expect(result.reason).toBe('peer_activity');
    expect(result.detectedItems).toBe(1);
    expect(elapsed).toBeLessThan(200);
  });

  it('coalesces rapid flurries into a single wake up event', async () => {
    const watchPromise = runWatcher({
      role: 'driver',
      store,
      coalescenceMs: 80,
      timeoutMs: 1000,
      signal: createSignal(),
    });

    // Flurry of 3 messages in rapid succession
    await store.createMessage({ author: 'navigator', message: 'Message 1' });
    await new Promise((r) => setTimeout(r, 10));
    await store.createMessage({ author: 'navigator', message: 'Message 2' });
    await new Promise((r) => setTimeout(r, 10));
    await store.createMessage({ author: 'navigator', message: 'Message 3' });

    const result = await watchPromise;
    expect(result.reason).toBe('peer_activity');
    expect(result.detectedItems).toBe(3);
  });

  it('terminates gracefully when AbortSignal is triggered', async () => {
    const ac = new AbortController();
    abortControllers.push(ac);

    const watchPromise = runWatcher({
      role: 'driver',
      store,
      timeoutMs: 5000,
      signal: ac.signal,
    });

    setTimeout(() => {
      ac.abort();
    }, 50);

    const result = await watchPromise;
    expect(result.reason).toBe('aborted');
    expect(result.detectedItems).toBe(0);
  });

  it('times out when no peer activity occurs', async () => {
    const result = await runWatcher({
      role: 'driver',
      store,
      timeoutMs: 60,
      signal: createSignal(),
    });

    expect(result.reason).toBe('timeout');
    expect(result.detectedItems).toBe(0);
  });
});
