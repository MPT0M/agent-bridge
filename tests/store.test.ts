import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.js';

describe('Store', () => {
  let tmpDir: string;
  let store: Store;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-bridge-test-'));
    store = new Store(tmpDir);
    await store.init();
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors in tests
    }
  });

  it('creates and lists proposals correctly', async () => {
    const p1 = await store.createProposal({
      title: 'Adopt BM25+ tokenization',
      targetFiles: ['src/retrieval/bm25.ts'],
      proposal: 'Implement Okapi BM25+ with NFC unicode normalization.',
      focusAreas: 'Memory overhead during chunking',
      author: 'driver',
    });

    expect(p1.id).toBeDefined();
    expect(p1.status).toBe('PENDING_REVIEW');
    expect(p1.author).toBe('driver');

    const list = await store.listProposals();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(p1.id);
  });

  it('enforces cross-review rule: author cannot review their own proposal', async () => {
    const proposal = await store.createProposal({
      title: 'Self-review test',
      targetFiles: ['test.ts'],
      proposal: 'Should not allow self approval.',
      author: 'driver',
    });

    await expect(
      store.reviewProposal({
        proposalId: proposal.id,
        verdict: 'APPROVED',
        critique: 'Looks good to me',
        reviewer: 'driver',
      })
    ).rejects.toThrow(/Cross-review violation/);

    const reviewed = await store.reviewProposal({
      proposalId: proposal.id,
      verdict: 'APPROVED',
      critique: 'Thoroughly checked and verified.',
      reviewer: 'navigator',
    });

    expect(reviewed.status).toBe('APPROVED');
    expect(reviewed.review?.reviewer).toBe('navigator');
  });

  it('handles chat messages with chronological ordering and replies', async () => {
    const m1 = await store.createMessage({
      author: 'driver',
      message: 'Hello Navigator!',
    });

    const m2 = await store.createMessage({
      author: 'navigator',
      message: 'Hello Driver! Ready for the review.',
      replyToId: m1.id,
    });

    const messages = await store.listMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe(m1.id);
    expect(messages[1].id).toBe(m2.id);
    expect(messages[1].replyToId).toBe(m1.id);
  });

  it('stores and retrieves code diffs', async () => {
    const diff = await store.createDiff({
      author: 'driver',
      description: 'Add NFC normalization to text chunker',
      diffOrPatch: '--- a/chunker.ts\n+++ b/chunker.ts\n@@ -1 +1 @@\n-text\n+text.normalize("NFC")',
      branchOrCommit: 'feat/nfc-norm',
    });

    expect(diff.id).toBeDefined();
    expect(diff.author).toBe('driver');

    const diffs = await store.listDiffs();
    expect(diffs).toHaveLength(1);
    expect(diffs[0].description).toBe('Add NFC normalization to text chunker');
  });

  it('isolates cursors and tracks unread counts independently for driver and navigator', async () => {
    // Driver creates proposal and message
    await store.createProposal({
      title: 'Proposal 1',
      targetFiles: ['a.ts'],
      proposal: 'Content 1',
      author: 'driver',
    });
    await store.createMessage({
      author: 'driver',
      message: 'Message from driver',
    });

    // Driver should see 0 unread (they are the author of both)
    const driverInboxBefore = await store.getInbox({ role: 'driver', filter: 'unread' });
    expect(driverInboxBefore.unreadCount).toBe(0);

    // Navigator should see 2 unread items
    const navigatorInboxBefore = await store.getInbox({
      role: 'navigator',
      filter: 'unread',
      markAsRead: true,
    });
    expect(navigatorInboxBefore.unreadCount).toBe(2);

    // After markAsRead: true, Navigator should now see 0 unread items
    const navigatorInboxAfter = await store.getInbox({ role: 'navigator', filter: 'unread' });
    expect(navigatorInboxAfter.unreadCount).toBe(0);

    // Navigator responds with a message
    await store.createMessage({
      author: 'navigator',
      message: 'Response from navigator',
    });

    // Driver now has 1 unread item (from navigator)
    const driverInboxAfter = await store.getInbox({ role: 'driver', filter: 'unread' });
    expect(driverInboxAfter.unreadCount).toBe(1);
  });

  it('notifies proposal author when peer completes review', async () => {
    // Driver creates proposal
    const proposal = await store.createProposal({
      title: 'Architecture revamp',
      targetFiles: ['core.ts'],
      proposal: 'Major refactor',
      author: 'driver',
    });

    // Driver checks inbox: 0 unread
    const driverInbox1 = await store.getInbox({ role: 'driver', filter: 'unread', markAsRead: true });
    expect(driverInbox1.unreadCount).toBe(0);

    // Wait a brief moment to ensure timestamp progression
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Navigator reviews and approves the proposal
    await store.reviewProposal({
      proposalId: proposal.id,
      verdict: 'APPROVED',
      critique: 'Clean and well structured.',
      reviewer: 'navigator',
    });

    // Driver now checks inbox: must see the reviewed proposal as unread!
    const driverInbox2 = await store.getInbox({ role: 'driver', filter: 'unread' });
    expect(driverInbox2.unreadCount).toBe(1);
    expect(driverInbox2.proposals).toHaveLength(1);
    expect(driverInbox2.proposals[0].id).toBe(proposal.id);
    expect(driverInbox2.proposals[0].status).toBe('APPROVED');
    expect(driverInbox2.proposals[0].review?.reviewer).toBe('navigator');
  });

  it('does not advance cursor past unviewed proposals when filtering only chat', async () => {
    // Navigator creates proposal
    await store.createProposal({
      title: 'Peer proposal',
      targetFiles: ['b.ts'],
      proposal: 'Proposal body',
      author: 'navigator',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Navigator also creates a message
    await store.createMessage({
      author: 'navigator',
      message: 'Quick chat ping',
    });

    // Driver only checks chat with markAsRead: true
    const driverChat = await store.getInbox({ role: 'driver', filter: 'chat', markAsRead: true });
    expect(driverChat.messages).toHaveLength(1);
    expect(driverChat.proposals).toHaveLength(0);

    // Driver now queries proposals: proposal must STILL be unread
    const driverProposals = await store.getInbox({ role: 'driver', filter: 'unread' });
    expect(driverProposals.unreadCount).toBe(1);
    expect(driverProposals.proposals).toHaveLength(1);
    expect(driverProposals.proposals[0].title).toBe('Peer proposal');
  });

  it('executes concurrent writes without data loss or file corruption', async () => {
    const totalWrites = 50;
    const promises: Promise<any>[] = [];

    for (let i = 0; i < totalWrites; i++) {
      promises.push(
        store.createMessage({
          author: i % 2 === 0 ? 'driver' : 'navigator',
          message: `Concurrent message ${i}`,
        })
      );
    }

    const results = await Promise.all(promises);
    expect(results).toHaveLength(totalWrites);

    const storedMessages = await store.listMessages();
    expect(storedMessages).toHaveLength(totalWrites);
  });
});
