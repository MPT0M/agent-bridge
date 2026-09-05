import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import { postProposalSchema, reviewProposalSchema } from '../src/tools/proposals.js';
import { chatWithPeerSchema } from '../src/tools/chat.js';
import { submitDiffSchema } from '../src/tools/diff.js';
import { readBridgeSchema } from '../src/tools/inbox.js';

describe('Tool Schemas & Input Validation', () => {
  it('validates postProposalSchema boundaries', () => {
    const schema = z.object(postProposalSchema);

    // Valid payload
    const valid = schema.parse({
      title: 'Valid Proposal Title',
      target_files: ['file.ts'],
      proposal: 'Valid proposal body with enough characters.',
    });
    expect(valid.title).toBe('Valid Proposal Title');
    expect(valid.target_files).toEqual(['file.ts']);

    // Title too short
    expect(() =>
      schema.parse({
        title: 'AB',
        proposal: 'Long enough body text.',
      })
    ).toThrow();

    // Proposal too short
    expect(() =>
      schema.parse({
        title: 'Valid Title',
        proposal: 'Too short',
      })
    ).toThrow();
  });

  it('validates reviewProposalSchema binary verdict', () => {
    const schema = z.object(reviewProposalSchema);

    const validApproved = schema.parse({
      proposal_id: '123',
      verdict: 'APPROVED',
      critique: 'Code looks clean and robust.',
    });
    expect(validApproved.verdict).toBe('APPROVED');

    const validChanges = schema.parse({
      proposal_id: '123',
      verdict: 'CHANGES_REQUESTED',
      critique: 'Missing error handling.',
    });
    expect(validChanges.verdict).toBe('CHANGES_REQUESTED');

    // Invalid verdict
    expect(() =>
      schema.parse({
        proposal_id: '123',
        verdict: 'MAYBE' as any,
        critique: 'Unsure.',
      })
    ).toThrow();
  });

  it('enforces 500KB safe payload limit on submitDiffSchema', () => {
    const schema = z.object(submitDiffSchema);

    // Normal diff
    const valid = schema.parse({
      description: 'Small fix',
      diff_or_patch: 'diff --git a/file b/file',
    });
    expect(valid.description).toBe('Small fix');

    // Oversized diff (> 500_000 chars)
    const giantDiff = 'x'.repeat(500_001);
    expect(() =>
      schema.parse({
        description: 'Giant diff',
        diff_or_patch: giantDiff,
      })
    ).toThrow(/500KB/);
  });

  it('validates chatWithPeerSchema message bounds', () => {
    const schema = z.object(chatWithPeerSchema);

    expect(schema.parse({ message: 'Hello' }).message).toBe('Hello');

    // Empty message
    expect(() => schema.parse({ message: '' })).toThrow();
  });

  it('applies default filters in readBridgeSchema', () => {
    const schema = z.object(readBridgeSchema);

    const defaultParsed = schema.parse({});
    expect(defaultParsed.filter).toBe('unread');
    expect(defaultParsed.mark_as_read).toBe(true);

    const custom = schema.parse({ filter: 'proposals', mark_as_read: false });
    expect(custom.filter).toBe('proposals');
    expect(custom.mark_as_read).toBe(false);
  });
});

describe('Tool Handler Execution & Error Formatting', () => {
  let tmpDir: string;
  let store: any;
  const tools: Map<string, Function> = new Map();

  const mockServer = {
    tool: (name: string, _desc: string, _schema: any, handler: Function) => {
      tools.set(name, handler);
    },
  };

  beforeEach(async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const { Store } = await import('../src/store.js');
    const { registerProposalTools } = await import('../src/tools/proposals.js');
    const { registerChatTools } = await import('../src/tools/chat.js');
    const { registerDiffTools } = await import('../src/tools/diff.js');
    const { registerInboxTools } = await import('../src/tools/inbox.js');

    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-bridge-tools-test-'));
    store = new Store(tmpDir);
    await store.init();

    tools.clear();
    registerProposalTools({ server: mockServer, store, role: 'driver' });
    registerChatTools({ server: mockServer, store, role: 'driver' });
    registerDiffTools({ server: mockServer, store, role: 'driver' });
    registerInboxTools({ server: mockServer, store, role: 'driver' });
  });

  afterEach(async () => {
    const fs = await import('node:fs/promises');
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('executes post_proposal and review_proposal handlers', async () => {
    const postHandler = tools.get('post_proposal')!;
    const postRes = await postHandler({
      title: 'New Architecture',
      target_files: ['index.ts'],
      proposal: 'Valid proposal content with details',
    });

    expect(postRes.content[0].text).toContain('Proposal submitted successfully');
    expect(postRes.content[0].text).toContain('Author: driver');

    // Attempt self review: should return isError: true
    const reviewHandler = tools.get('review_proposal')!;
    const proposals = await store.listProposals();
    const selfReviewRes = await reviewHandler({
      proposal_id: proposals[0].id,
      verdict: 'APPROVED',
      critique: 'Self approval',
    });
    expect(selfReviewRes.isError).toBe(true);
    expect(selfReviewRes.content[0].text).toContain('Cross-review violation');
  });

  it('executes chat_with_peer and read_bridge handlers', async () => {
    const chatHandler = tools.get('chat_with_peer')!;
    const chatRes = await chatHandler({ message: 'Hello peer agent!' });
    expect(chatRes.content[0].text).toContain('Message sent to peer');

    const inboxHandler = tools.get('read_bridge')!;
    const inboxRes = await inboxHandler({ filter: 'all', mark_as_read: true });
    expect(inboxRes.content[0].text).toContain('=== AGENT BRIDGE INBOX (DRIVER) ===');
    expect(inboxRes.content[0].text).toContain('Hello peer agent!');
  });
});

