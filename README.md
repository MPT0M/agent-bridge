# Agent Bridge MCP

A local, zero-cloud Model Context Protocol (MCP) server designed for AI-to-AI pair programming and technical peer review (Driver & Navigator).

## Overview

When developing with multiple AI coding assistants (e.g., **Claude Code** and **Google Antigravity**), developers often juggle multiple terminal windows, manually copying and pasting plans, code snippets, and review critiques between models.

**Agent Bridge MCP** turns two local AI agents into a true pair programming duo:
- **Driver (Implementer):** Focuses on code changes, implementation details, and refactoring.
- **Navigator (Architect & Auditor):** Focuses on architectural integrity, edge-cases, design review, and code diff auditing.

Both agents communicate through standardized, typed MCP tools backed by an atomic, partitioned local filesystem store (`.agent-bridge/`) in the target project.

---

## Key Features

1. **Local-First & Zero-Cloud:** Runs via standard `stdio`. No remote servers, no databases, and no extra API keys required.
2. **Atomic & Partitioned Storage:** Append-only message and proposal files (`<timestamp>-<uuid>.json`) prevent data corruption and race conditions across independent operating system processes.
3. **Role-Aware Inboxes:** Driver and Navigator maintain independent read cursors (`cursors/<role>.json`), ensuring that `unread` queries never clobber each other's pending items.
4. **Enforced Cross-Review:** Authors cannot approve their own proposals (`review_proposal` strictly requires peer evaluation).
5. **Payload Context Guard:** 500KB guard against oversized diffs, protecting the model context window.

---

## Storage Architecture

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/storage-dark.svg">
  <img alt="Storage layout of .agent-bridge/: proposals, diffs, messages and per-role cursors, with atomic tmp-and-rename writes" src="docs/storage-light.svg">
</picture>

---

## MCP Tools Exposed

| Tool Name | Purpose | Key Inputs |
|---|---|---|
| `post_proposal` | Submit a formal plan or architecture proposal for review | `title`, `target_files`, `proposal`, `focus_areas` |
| `review_proposal` | Issue a verdict (`APPROVED` or `CHANGES_REQUESTED`) | `proposal_id`, `verdict`, `critique` |
| `submit_diff_for_review` | Submit code changes or a unified diff for inspection | `description`, `diff_or_patch`, `branch_or_commit` |
| `chat_with_peer` | Send a quick direct message or technical question to peer | `message`, `reply_to_id` (optional) |
| `read_bridge` | Read unread messages, active proposals, and recent diffs | `filter` (`unread`, `all`, `proposals`, `chat`), `mark_as_read` |

---

## Installation & Setup

### Prerequisites
- Node.js 18+

### 1. Build from source
```bash
git clone https://github.com/MPT0M/agent-bridge.git
cd agent-bridge
npm install
npm run build
```

### 2. Configure Claude Code (Driver)
Add to your Claude Code MCP configuration (`~/.claude/settings.json` or run CLI):
```bash
claude mcp add agent-bridge node /path/to/agent-bridge/dist/index.js --role driver
```

### 3. Configure Antigravity / Gemini CLI (Navigator)
Add to your Antigravity MCP settings or configuration:
```json
{
  "mcpServers": {
    "agent-bridge": {
      "command": "node",
      "args": ["/path/to/agent-bridge/dist/index.js", "--role", "navigator"]
    }
  }
}
```

---

## Typical Workflow

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/workflow-dark.svg">
  <img alt="Typical Workflow: Driver posts a proposal, Navigator reads and approves it, Driver implements and submits a diff, Navigator reviews and clears it" src="docs/workflow-light.svg">
</picture>

---

## Autonomous Continuous Pairing (Zero-Token Sentinel)

By default, an AI agent cannot receive unsolicited external pushes while idle. Waiting via continuous polling loops burns tokens and context quota rapidly.

`agent-bridge` solves this with a **single-shot filesystem sentinel** (`agent-bridge watch`). The sentinel sleeps on kernel filesystem notifications (`fs.watch`) using **0 tokens while waiting in silence**. When peer activity is detected (a message, proposal, or diff), it coalesces rapid events (2-second window), prints a diagnostic summary, and exits with code `0`. This process termination signals the agent harness to wake up automatically.

### Architecture

```
Agent A (Active)                           Agent B (Sleeping)
────────────────                           ──────────────────
Writes proposal or chat
  │
  ▼
.agent-bridge/ (atomic write) ───► fs.watch kernel event
                                           │
                                     Coalescence window (2s)
                                           │
                                     agent-bridge watch exits (code 0)
                                           │
                                           ▼
                                     Agent B wakes up automatically!
                                     Calls `read_bridge` (unread)
                                     Processes peer input
                                     Rearms watcher & goes to sleep
```

### 1. In Claude Code (Driver)

When Claude finishes a turn and needs to await Navigator input, run the watcher in the background:

```bash
node /path/to/agent-bridge/dist/index.js watch --role driver
```

In Claude Code, running a background command emits a `Background task completed` notification upon process exit. Instruct Claude:
> *"Whenever you finish a turn waiting for Navigator feedback, run `agent-bridge watch --role driver` in the background. When the background task notifies you of peer activity, call `read_bridge` to inspect the inbox and rearm the watcher."*

### 2. In Google Antigravity / Gemini CLI (Navigator)

Antigravity automatically wakes up when background tasks complete. Run the watcher as a background task:

```powershell
node C:/path/to/agent-bridge/dist/index.js watch --role navigator
```

When Antigravity receives the completion message:
1. Calls `read_bridge({ filter: 'unread' })`.
2. Evaluates the proposal or inspects the diff.
3. Submits feedback via `review_proposal` or `chat_with_peer`.
4. Relaunches `agent-bridge watch --role navigator` in the background and ends turn.

---

## Development & Tests

Run unit tests:
```bash
npm test
```

Build distribution:
```bash
npm run build
```

## License

MIT © MPT0M
