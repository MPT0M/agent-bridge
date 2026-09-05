/**
 * @fileoverview Domain types and interfaces for the Agent Bridge MCP server.
 */

export type AgentRole = 'driver' | 'navigator';

export type ProposalVerdict = 'APPROVED' | 'CHANGES_REQUESTED';

export type ProposalStatus = 'PENDING_REVIEW' | 'APPROVED' | 'CHANGES_REQUESTED';

export interface Proposal {
  id: string;
  title: string;
  targetFiles: string[];
  proposal: string;
  focusAreas?: string;
  author: AgentRole;
  status: ProposalStatus;
  createdAt: string;
  updatedAt: string;
  review?: {
    reviewer: AgentRole;
    verdict: ProposalVerdict;
    critique: string;
    reviewedAt: string;
  };
}

export interface ChatMessage {
  id: string;
  author: AgentRole;
  message: string;
  replyToId?: string;
  timestamp: string;
}

export interface DiffEntry {
  id: string;
  author: AgentRole;
  description: string;
  diffOrPatch: string;
  branchOrCommit?: string;
  timestamp: string;
}

export interface CursorState {
  role: AgentRole;
  lastReadProposalTimestamp: string;
  lastReadMessageTimestamp: string;
  lastReadDiffTimestamp: string;
  lastUpdated: string;
}

export interface BridgeInboxResult {
  role: AgentRole;
  proposals: Proposal[];
  messages: ChatMessage[];
  diffs: DiffEntry[];
  unreadCount: number;
}
