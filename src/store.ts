/**
 * @fileoverview Partitioned, append-only file store for agent-bridge.
 * Provides atomic writes, Windows-safe file operations, and injectable paths for isolated testing.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AgentRole,
  Proposal,
  ProposalVerdict,
  ChatMessage,
  DiffEntry,
  CursorState,
  BridgeInboxResult,
} from './types.js';

export class Store {
  private readonly baseDir: string;
  private readonly proposalsDir: string;
  private readonly messagesDir: string;
  private readonly diffsDir: string;
  private readonly cursorsDir: string;
  private initialized = false;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || process.env.AGENT_BRIDGE_DIR || path.join(process.cwd(), '.agent-bridge');
    this.proposalsDir = path.join(this.baseDir, 'proposals');
    this.messagesDir = path.join(this.baseDir, 'messages');
    this.diffsDir = path.join(this.baseDir, 'diffs');
    this.cursorsDir = path.join(this.baseDir, 'cursors');
  }

  /**
   * Idempotently ensures all storage directories exist.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.proposalsDir, { recursive: true });
    await fs.mkdir(this.messagesDir, { recursive: true });
    await fs.mkdir(this.diffsDir, { recursive: true });
    await fs.mkdir(this.cursorsDir, { recursive: true });
    this.initialized = true;
  }

  /**
   * Returns the root storage directory of the bridge instance.
   */
  getBaseDir(): string {
    return this.baseDir;
  }

  /**
   * Returns the absolute path to the proposals storage directory.
   */
  getProposalsDir(): string {
    return this.proposalsDir;
  }

  /**
   * Returns the absolute path to the chat messages storage directory.
   */
  getMessagesDir(): string {
    return this.messagesDir;
  }

  /**
   * Returns the absolute path to the diffs storage directory.
   */
  getDiffsDir(): string {
    return this.diffsDir;
  }

  /**
   * Performs an atomic write using a temporary file and rename with exponential backoff
   * to gracefully handle Windows-specific EPERM/EBUSY locking edge-cases.
   */
  private async writeAtomic(targetPath: string, content: string): Promise<void> {
    await this.init();
    const dir = path.dirname(targetPath);
    const tmpPath = path.join(dir, `.tmp_${randomUUID()}`);

    await fs.writeFile(tmpPath, content, 'utf-8');

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fs.rename(tmpPath, targetPath);
        return;
      } catch (err: any) {
        if ((err.code === 'EPERM' || err.code === 'EBUSY') && attempt < 4) {
          await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
          continue;
        }
        try {
          await fs.unlink(tmpPath);
        } catch {
          // Ignore cleanup failure if file does not exist
        }
        throw err;
      }
    }
  }

  // ─── Proposals ─────────────────────────────────────────────────────────────

  async createProposal(params: {
    title: string;
    targetFiles: string[];
    proposal: string;
    focusAreas?: string;
    author: AgentRole;
  }): Promise<Proposal> {
    await this.init();
    const id = randomUUID();
    const now = new Date().toISOString();

    const proposal: Proposal = {
      id,
      title: params.title,
      targetFiles: params.targetFiles,
      proposal: params.proposal,
      focusAreas: params.focusAreas,
      author: params.author,
      status: 'PENDING_REVIEW',
      createdAt: now,
      updatedAt: now,
    };

    const filePath = path.join(this.proposalsDir, `${id}.json`);
    await this.writeAtomic(filePath, JSON.stringify(proposal, null, 2));
    return proposal;
  }

  async getProposal(id: string): Promise<Proposal | null> {
    await this.init();
    const filePath = path.join(this.proposalsDir, `${id}.json`);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data) as Proposal;
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async listProposals(): Promise<Proposal[]> {
    await this.init();
    const files = await fs.readdir(this.proposalsDir);
    const proposals: Proposal[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(this.proposalsDir, file), 'utf-8');
        proposals.push(JSON.parse(raw));
      } catch {
        // Skip transient or corrupted files
      }
    }

    return proposals.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async reviewProposal(params: {
    proposalId: string;
    verdict: ProposalVerdict;
    critique: string;
    reviewer: AgentRole;
  }): Promise<Proposal> {
    const existing = await this.getProposal(params.proposalId);
    if (!existing) {
      throw new Error(`Proposal not found: ${params.proposalId}`);
    }

    if (existing.author === params.reviewer) {
      throw new Error(`Cross-review violation: Author (${existing.author}) cannot review their own proposal`);
    }

    const now = new Date().toISOString();
    existing.status = params.verdict;
    existing.updatedAt = now;
    existing.review = {
      reviewer: params.reviewer,
      verdict: params.verdict,
      critique: params.critique,
      reviewedAt: now,
    };

    const filePath = path.join(this.proposalsDir, `${existing.id}.json`);
    await this.writeAtomic(filePath, JSON.stringify(existing, null, 2));
    return existing;
  }

  // ─── Chat Messages ─────────────────────────────────────────────────────────

  async createMessage(params: {
    author: AgentRole;
    message: string;
    replyToId?: string;
  }): Promise<ChatMessage> {
    await this.init();
    const id = randomUUID();
    const timestamp = new Date().toISOString();

    const chatMessage: ChatMessage = {
      id,
      author: params.author,
      message: params.message,
      replyToId: params.replyToId,
      timestamp,
    };

    // Sortable filename using timestamp
    const safeTimestamp = timestamp.replace(/[:.]/g, '-');
    const filePath = path.join(this.messagesDir, `${safeTimestamp}_${id}.json`);
    await this.writeAtomic(filePath, JSON.stringify(chatMessage, null, 2));
    return chatMessage;
  }

  async listMessages(): Promise<ChatMessage[]> {
    await this.init();
    const files = await fs.readdir(this.messagesDir);
    const messages: ChatMessage[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(this.messagesDir, file), 'utf-8');
        messages.push(JSON.parse(raw));
      } catch {
        // Skip unreadable files
      }
    }

    return messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  // ─── Diffs ─────────────────────────────────────────────────────────────────

  async createDiff(params: {
    author: AgentRole;
    description: string;
    diffOrPatch: string;
    branchOrCommit?: string;
  }): Promise<DiffEntry> {
    await this.init();
    const id = randomUUID();
    const timestamp = new Date().toISOString();

    const diffEntry: DiffEntry = {
      id,
      author: params.author,
      description: params.description,
      diffOrPatch: params.diffOrPatch,
      branchOrCommit: params.branchOrCommit,
      timestamp,
    };

    const safeTimestamp = timestamp.replace(/[:.]/g, '-');
    const filePath = path.join(this.diffsDir, `${safeTimestamp}_${id}.json`);
    await this.writeAtomic(filePath, JSON.stringify(diffEntry, null, 2));
    return diffEntry;
  }

  async listDiffs(): Promise<DiffEntry[]> {
    await this.init();
    const files = await fs.readdir(this.diffsDir);
    const diffs: DiffEntry[] = [];

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(this.diffsDir, file), 'utf-8');
        diffs.push(JSON.parse(raw));
      } catch {
        // Skip unreadable files
      }
    }

    return diffs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  // ─── Cursors & Inbox ───────────────────────────────────────────────────────

  async getCursor(role: AgentRole): Promise<CursorState> {
    await this.init();
    const filePath = path.join(this.cursorsDir, `${role}.json`);
    try {
      const data = await fs.readFile(filePath, 'utf-8');
      const raw = JSON.parse(data);
      const fallback = raw.lastReadTimestamp || '1970-01-01T00:00:00.000Z';
      return {
        role,
        lastReadProposalTimestamp: raw.lastReadProposalTimestamp || fallback,
        lastReadMessageTimestamp: raw.lastReadMessageTimestamp || fallback,
        lastReadDiffTimestamp: raw.lastReadDiffTimestamp || fallback,
        lastUpdated: raw.lastUpdated || new Date().toISOString(),
      };
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return {
          role,
          lastReadProposalTimestamp: '1970-01-01T00:00:00.000Z',
          lastReadMessageTimestamp: '1970-01-01T00:00:00.000Z',
          lastReadDiffTimestamp: '1970-01-01T00:00:00.000Z',
          lastUpdated: new Date().toISOString(),
        };
      }
      throw err;
    }
  }

  async updateCursor(params: {
    role: AgentRole;
    lastReadProposalTimestamp?: string;
    lastReadMessageTimestamp?: string;
    lastReadDiffTimestamp?: string;
  }): Promise<void> {
    await this.init();
    const current = await this.getCursor(params.role);
    const state: CursorState = {
      role: params.role,
      lastReadProposalTimestamp: params.lastReadProposalTimestamp || current.lastReadProposalTimestamp,
      lastReadMessageTimestamp: params.lastReadMessageTimestamp || current.lastReadMessageTimestamp,
      lastReadDiffTimestamp: params.lastReadDiffTimestamp || current.lastReadDiffTimestamp,
      lastUpdated: new Date().toISOString(),
    };
    const filePath = path.join(this.cursorsDir, `${params.role}.json`);
    await this.writeAtomic(filePath, JSON.stringify(state, null, 2));
  }

  async getInbox(params: {
    role: AgentRole;
    filter?: 'all' | 'unread' | 'proposals' | 'chat';
    markAsRead?: boolean;
  }): Promise<BridgeInboxResult> {
    const filter = params.filter || 'unread';
    const cursor = await this.getCursor(params.role);

    const allProposals = await this.listProposals();
    const allMessages = await this.listMessages();
    const allDiffs = await this.listDiffs();

    let filteredProposals = allProposals;
    let filteredMessages = allMessages;
    let filteredDiffs = allDiffs;

    if (filter === 'unread') {
      filteredProposals = allProposals.filter((p) => {
        // 1. Proposal created by peer after last read
        const isNewFromPeer = p.author !== params.role && p.createdAt > cursor.lastReadProposalTimestamp;
        // 2. Proposal reviewed by peer after last read
        const isReviewedByPeer = !!(
          p.review &&
          p.review.reviewer !== params.role &&
          p.review.reviewedAt > cursor.lastReadProposalTimestamp
        );
        return isNewFromPeer || isReviewedByPeer;
      });
      filteredMessages = allMessages.filter(
        (m) => m.timestamp > cursor.lastReadMessageTimestamp && m.author !== params.role
      );
      filteredDiffs = allDiffs.filter(
        (d) => d.timestamp > cursor.lastReadDiffTimestamp && d.author !== params.role
      );
    } else if (filter === 'proposals') {
      filteredMessages = [];
      filteredDiffs = [];
    } else if (filter === 'chat') {
      filteredProposals = [];
      filteredDiffs = [];
    }

    const unreadCount = filteredProposals.length + filteredMessages.length + filteredDiffs.length;

    if (params.markAsRead) {
      let newProposalTimestamp: string | undefined;
      let newMessageTimestamp: string | undefined;
      let newDiffTimestamp: string | undefined;

      if (filteredProposals.length > 0) {
        const pTimes = filteredProposals
          .map((p) => (p.review && p.review.reviewer !== params.role ? p.review.reviewedAt : p.createdAt))
          .sort()
          .reverse();
        if (pTimes[0] > cursor.lastReadProposalTimestamp) {
          newProposalTimestamp = pTimes[0];
        }
      }

      if (filteredMessages.length > 0) {
        const mTimes = filteredMessages.map((m) => m.timestamp).sort().reverse();
        if (mTimes[0] > cursor.lastReadMessageTimestamp) {
          newMessageTimestamp = mTimes[0];
        }
      }

      if (filteredDiffs.length > 0) {
        const dTimes = filteredDiffs.map((d) => d.timestamp).sort().reverse();
        if (dTimes[0] > cursor.lastReadDiffTimestamp) {
          newDiffTimestamp = dTimes[0];
        }
      }

      if (newProposalTimestamp || newMessageTimestamp || newDiffTimestamp) {
        await this.updateCursor({
          role: params.role,
          lastReadProposalTimestamp: newProposalTimestamp,
          lastReadMessageTimestamp: newMessageTimestamp,
          lastReadDiffTimestamp: newDiffTimestamp,
        });
      }
    }

    return {
      role: params.role,
      proposals: filteredProposals,
      messages: filteredMessages,
      diffs: filteredDiffs,
      unreadCount,
    };
  }
}
