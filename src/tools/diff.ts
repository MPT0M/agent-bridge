/**
 * @fileoverview MCP tool handler for submitting code diffs for peer inspection.
 */

import { z } from 'zod';
import { Store } from '../store.js';
import { AgentRole } from '../types.js';

export const submitDiffSchema = {
  description: z.string().min(5).describe('Summary of the changes made and the intention behind them'),
  diff_or_patch: z.string().max(500_000, 'Diff payload exceeds the 500KB safe context limit').describe('Unified diff or code patch to be audited'),
  branch_or_commit: z.string().optional().describe('Git branch name or commit hash reference'),
};

export function registerDiffTools(params: {
  server: any;
  store: Store;
  role: AgentRole;
}) {
  const { server, store, role } = params;

  server.tool(
    'submit_diff_for_review',
    'Submit code changes or a unified diff for peer review and quality auditing before committing.',
    submitDiffSchema,
    async (args: z.infer<z.ZodObject<typeof submitDiffSchema>>) => {
      try {
        const diffEntry = await store.createDiff({
          author: role,
          description: args.description,
          diffOrPatch: args.diff_or_patch,
          branchOrCommit: args.branch_or_commit,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Diff submitted for peer review.\nID: ${diffEntry.id}\nAuthor: ${role}\nDescription: ${diffEntry.description}\nTimestamp: ${diffEntry.timestamp}`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to submit diff: ${err.message}` }],
        };
      }
    }
  );
}
