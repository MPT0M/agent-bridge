import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.js';

describe('Integration: Driver & Navigator Peer Lifecycle', () => {
  let tmpDir: string;
  let driverStore: Store;
  let navigatorStore: Store;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-bridge-integ-'));
    // Simulate two independent process instances sharing the same base directory
    driverStore = new Store(tmpDir);
    navigatorStore = new Store(tmpDir);
    await driverStore.init();
    await navigatorStore.init();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup failures
    }
  });

  it('completes a full driver-navigator peer review cycle via shared filesystem', async () => {
    // 1. Driver posts proposal
    const proposal = await driverStore.createProposal({
      title: 'Implement File Search Multimodal Engine',
      targetFiles: ['src/engine.ts', 'src/bm25.ts'],
      proposal: 'Build hybrid retrieval combining BM25+ and Gemini Embedding 2.',
      focusAreas: 'Ensure UTF-8 byte offset bugs in citations are prevented.',
      author: 'driver',
    });
    expect(proposal.id).toBeDefined();

    // 2. Navigator checks inbox (markAsRead: true)
    const navInbox1 = await navigatorStore.getInbox({
      role: 'navigator',
      filter: 'unread',
      markAsRead: true,
    });
    expect(navInbox1.unreadCount).toBe(1);
    expect(navInbox1.proposals[0].id).toBe(proposal.id);
    expect(navInbox1.proposals[0].status).toBe('PENDING_REVIEW');

    // 3. Navigator audits and approves proposal
    const reviewed = await navigatorStore.reviewProposal({
      proposalId: proposal.id,
      verdict: 'APPROVED',
      critique: 'Plan is clean. Verified UTF-8 normalization and concurrency boundaries.',
      reviewer: 'navigator',
    });
    expect(reviewed.status).toBe('APPROVED');

    // 4. Driver checks inbox: sees approved proposal
    const driverInbox1 = await driverStore.getInbox({
      role: 'driver',
      filter: 'unread',
      markAsRead: true,
    });
    expect(driverInbox1.unreadCount).toBe(1);
    expect(driverInbox1.proposals[0].id).toBe(proposal.id);
    expect(driverInbox1.proposals[0].status).toBe('APPROVED');
    expect(driverInbox1.proposals[0].review?.critique).toContain('Plan is clean');

    // 5. Driver asks a question in chat
    const chatMsg = await driverStore.createMessage({
      author: 'driver',
      message: 'Starting implementation now. Should BM25 use k1=1.2 or 1.5?',
    });

    // 6. Navigator checks inbox, sees message, and responds
    const navInbox2 = await navigatorStore.getInbox({
      role: 'navigator',
      filter: 'unread',
      markAsRead: true,
    });
    expect(navInbox2.unreadCount).toBe(1);
    expect(navInbox2.messages[0].message).toContain('k1=1.2 or 1.5');

    await navigatorStore.createMessage({
      author: 'navigator',
      message: 'Use k1=1.2 for technical documentation with concise passages.',
      replyToId: chatMsg.id,
    });

    // 7. Driver submits code diff for review
    const diff = await driverStore.createDiff({
      author: 'driver',
      description: 'Implement BM25 tokenizer with NFC normalization',
      diffOrPatch: '--- a/bm25.ts\n+++ b/bm25.ts\n+export function tokenize(text: string) { return text.normalize("NFC"); }',
      branchOrCommit: 'feat/bm25',
    });

    // 8. Navigator checks inbox and receives both the chat reply confirmation and the diff
    const navInbox3 = await navigatorStore.getInbox({
      role: 'navigator',
      filter: 'unread',
      markAsRead: true,
    });
    expect(navInbox3.diffs).toHaveLength(1);
    expect(navInbox3.diffs[0].id).toBe(diff.id);
    expect(navInbox3.diffs[0].description).toBe('Implement BM25 tokenizer with NFC normalization');
  });
});
