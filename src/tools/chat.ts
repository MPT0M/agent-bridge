/**
 * @fileoverview MCP tool handler for conversational peer dialogue.
 */

import { z } from 'zod';
import { Store } from '../store.js';
import { AgentRole } from '../types.js';

export const chatWithPeerSchema = {
  message: z.string().min(1).max(10_000).describe('Message, question, or technical comment directed to the peer agent'),
  reply_to_id: z.string().optional().describe('Optional message ID being replied to, keeping thread coherence'),
};

export function registerChatTools(params: {
  server: any;
  store: Store;
  role: AgentRole;
}) {
  const { server, store, role } = params;

  server.tool(
    'chat_with_peer',
    'Send a direct conversational message, quick technical query, or comment to the other agent in the pair.',
    chatWithPeerSchema,
    async (args: z.infer<z.ZodObject<typeof chatWithPeerSchema>>) => {
      try {
        const message = await store.createMessage({
          author: role,
          message: args.message,
          replyToId: args.reply_to_id,
        });

        return {
          content: [
            {
              type: 'text',
              text: `Message sent to peer.\nID: ${message.id}\nAuthor: ${role}\nTimestamp: ${message.timestamp}`,
            },
          ],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to send message: ${err.message}` }],
        };
      }
    }
  );
}
