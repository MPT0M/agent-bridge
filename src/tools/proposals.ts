/**
 * @fileoverview MCP tool handlers for technical proposals and peer reviews.
 */

import { z } from 'zod';
import { Store } from '../store.js';
import { AgentRole } from '../types.js';

export const postProposalSchema = {
  title: z.string().min(3).max(120).describe('Short, descriptive title of the technical proposal or plan'),
  target_files: z.array(z.string()).default([]).describe('List of file paths affected or targeted by this change'),
  proposal: z.string().min(10).describe('Detailed explanation of the proposed changes, design decisions, and trade-offs'),
  focus_areas: z.string().optional().describe('Specific architectural areas, edge-cases, or blind spots where peer feedback is needed'),
};

export const reviewProposalSchema = {
  proposal_id: z.string().describe('ID of the proposal being reviewed'),
  verdict: z.enum(['APPROVED', 'CHANGES_REQUESTED']).describe('Binary review verdict: APPROVED or CHANGES_REQUESTED'),
  critique: z.string().min(5).describe('Technical justification, findings, or requested modifications'),
};

export function registerProposalTools(params: {
  server: any;
  store: Store;
  role: AgentRole;
}) {
  const { server, store, role } = params;

  server.tool(
    'post_proposal',
    'Submit a formal technical proposal or implementation plan for peer review before coding.',
    postProposalSchema,
    async (args: z.infer<z.ZodObject<typeof postProposalSchema>>) => {
      try {
        const created = await store.createProposal({
          title: args.title,
          targetFiles: args.target_files,
          proposal: args.proposal,
          focusAreas: args.focus_areas,
          author: role,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Proposal submitted successfully.\nID: ${created.id}\nStatus: ${created.status}\nAuthor: ${created.author}\nTitle: ${created.title}`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to submit proposal: ${err.message}` }],
        };
      }
    }
  );

  server.tool(
    'review_proposal',
    'Issue a formal review verdict (APPROVED or CHANGES_REQUESTED) on a peer proposal. Note: You cannot review your own proposal.',
    reviewProposalSchema,
    async (args: z.infer<z.ZodObject<typeof reviewProposalSchema>>) => {
      try {
        const updated = await store.reviewProposal({
          proposalId: args.proposal_id,
          verdict: args.verdict,
          critique: args.critique,
          reviewer: role,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Review recorded.\nProposal ID: ${updated.id}\nVerdict: ${updated.status}\nReviewer: ${role}\nCritique: ${args.critique}`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to review proposal: ${err.message}` }],
        };
      }
    }
  );
}
