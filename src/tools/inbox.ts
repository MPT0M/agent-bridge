/**
 * @fileoverview MCP tool handler for checking the shared blackboard and pending peer messages.
 */

import { z } from 'zod';
import { Store } from '../store.js';
import { AgentRole } from '../types.js';

export const readBridgeSchema = {
  filter: z.enum(['all', 'unread', 'proposals', 'chat']).default('unread').describe('Filter criteria: "unread" (default), "all", "proposals", or "chat"'),
  mark_as_read: z.boolean().default(true).describe('Whether to update the current agent role cursor to the latest timestamp'),
};

export function registerInboxTools(params: {
  server: any;
  store: Store;
  role: AgentRole;
}) {
  const { server, store, role } = params;

  server.tool(
    'read_bridge',
    'Check the shared board for peer messages, proposals awaiting review, or audited diffs.',
    readBridgeSchema,
    async (args: z.infer<z.ZodObject<typeof readBridgeSchema>>) => {
      try {
        const inbox = await store.getInbox({
          role,
          filter: args.filter,
          markAsRead: args.mark_as_read,
        });

        const lines: string[] = [
          `=== AGENT BRIDGE INBOX (${role.toUpperCase()}) ===`,
          `Filter: ${args.filter || 'unread'} | Unread count: ${inbox.unreadCount}`,
          '',
        ];

        if (inbox.proposals.length > 0) {
          lines.push(`--- Proposals (${inbox.proposals.length}) ---`);
          for (const p of inbox.proposals) {
            lines.push(`[${p.status}] ID: ${p.id} | Author: ${p.author} | Title: ${p.title}`);
            lines.push(`Target files: ${p.targetFiles.join(', ') || 'none specified'}`);
            lines.push(`Proposal: ${p.proposal}`);
            if (p.focusAreas) lines.push(`Focus: ${p.focusAreas}`);
            if (p.review) {
              lines.push(`Review by ${p.review.reviewer} (${p.review.verdict}): ${p.review.critique}`);
            }
            lines.push('');
          }
        }

        if (inbox.messages.length > 0) {
          lines.push(`--- Chat Messages (${inbox.messages.length}) ---`);
          for (const m of inbox.messages) {
            const replyInfo = m.replyToId ? ` (reply to ${m.replyToId})` : '';
            lines.push(`[${m.timestamp}] ${m.author}${replyInfo}: ${m.message}`);
          }
          lines.push('');
        }

        if (inbox.diffs.length > 0) {
          lines.push(`--- Code Diffs (${inbox.diffs.length}) ---`);
          for (const d of inbox.diffs) {
            lines.push(`ID: ${d.id} | Author: ${d.author} | Desc: ${d.description}`);
            if (d.branchOrCommit) lines.push(`Ref: ${d.branchOrCommit}`);
            lines.push(`Diff preview (first 500 chars):\n${d.diffOrPatch.slice(0, 500)}...`);
            lines.push('');
          }
        }

        if (inbox.unreadCount === 0 && (args.filter === 'unread' || !args.filter)) {
          lines.push('No new unread items from peer.');
        }

        return {
          content: [
            {
              type: 'text',
              text: lines.join('\n'),
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to read bridge: ${err.message}` }],
        };
      }
    }
  );
}
