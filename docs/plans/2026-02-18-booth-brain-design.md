# Booth Brain Design

**Author:** Dave Lilly
**Date:** 2026-02-18
**Status:** Approved

## Overview

Booth Brain is an AI reasoning layer embedded in Production Hub that translates natural language from the MOD into system commands. It uses Claude API with tool use to interpret intent, propose (or execute) actions, and enforce decision boundaries from the DMMS operations manual.

## Architecture

Booth Brain is a module inside Production Hub — not a separate service. It has direct access to the action registry, cue engine, and device state.

```
┌─────────────────────────────────────────────┐
│              MOD UI (React)                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
│  │ CueStack │  │ Actions  │  │ChatDrawer │  │
│  └──────────┘  └──────────┘  └─────┬─────┘  │
└─────────────────────────────────────┼────────┘
                                      │ WS :3001
┌─────────────────────────────────────┼────────┐
│         Production Hub (Node)       │        │
│  ┌──────────────────────────────────┴──┐     │
│  │         BrainService                │     │
│  │  - Claude API (tool use)            │     │
│  │  - Operations manual as context     │     │
│  │  - Action registry access           │     │
│  │  - Device state access              │     │
│  │  - Confirm / trusted mode           │     │
│  └──────────────┬─────────────────────┘     │
│                  │                            │
│  ┌───────────┐  │  ┌──────────┐              │
│  │ CueEngine │◄─┼─►│ Drivers  │              │
│  └───────────┘  │  └──────────┘              │
│  ┌──────────────▼──┐                         │
│  │  ActionRegistry  │                         │
│  └─────────────────┘                         │
└──────────────────────────────────────────────┘
```

## LLM Runtime

Claude API (cloud) via `@anthropic-ai/sdk`. Local model migration is a future concern — the interface is clean enough to swap later.

## Tool Definitions

Claude receives these tools and decides which to call based on MOD input:

| Tool | Purpose | Example |
|------|---------|---------|
| `execute_action` | Fire a named action from the registry | "House to half" |
| `send_osc` | Send a raw OSC command | "Fade channel 5 to 80%" |
| `fire_cue` | Fire next cue or a specific cue | "Go" / "Fire cue 3" |
| `get_device_state` | Read current device state | "Is the stream running?" |
| `get_show_state` | Read cue stack position | "What cue are we on?" |
| `get_actions` | List available actions | "What can I do with lights?" |
| `recall_scene` | Recall an Avantis scene | "Load the concert scene" |
| `camera_preset` | Move camera to preset | "Camera to wide shot" |

## Execution Modes

**Confirm (default):** Claude proposes tool calls. BrainService formats them as `ProposedAction` objects with human-readable labels. MOD sees action cards with Confirm/Reject buttons. Execution happens only after confirm.

**Trusted:** Claude proposes tool calls. BrainService executes immediately and reports results.

**Always-confirm actions:** `hub/panic` and any config/cue-stack modifications always require confirmation regardless of mode.

## WebSocket Protocol

Extends existing ModWebSocket on port 3001. No new ports.

### Client → Server

| Type | Payload | Description |
|------|---------|-------------|
| `chat-message` | `{ text: string }` | MOD sends a message |
| `chat-confirm` | `{ requestId: string }` | MOD confirms proposed actions |
| `chat-reject` | `{ requestId: string }` | MOD rejects proposed actions |
| `chat-set-mode` | `{ mode: "confirm" \| "trusted" }` | Toggle execution mode |

### Server → Client

| Type | Payload | Description |
|------|---------|-------------|
| `chat-response` | `{ requestId, text, actions? }` | Brain reply with optional proposed actions |
| `chat-executed` | `{ requestId, actions, results }` | Actions were executed |
| `chat-error` | `{ requestId, error }` | Something went wrong |
| `chat-mode` | `{ mode }` | Current mode broadcast |

### ProposedAction Shape

```typescript
{
  tool: string;          // tool name
  args: Record<string, any>;
  label: string;         // human-readable description
}
```

## UI Design

**Bottom drawer** — slides up from the bottom of the screen. Doesn't displace existing panels (ActionPalette, CueStack, device states all stay where they are).

Components:
- `ChatDrawer` — container, open/collapse toggle
- `ChatMessage` — renders MOD messages (right) and Brain messages (left)
- `ActionCard` — proposed action with Confirm/Reject, or executed action with Done badge

Mode toggle switch at top of drawer: Confirm / Trusted.

No message persistence in V1. State lives in React. Refresh clears.

## System Prompt

Built dynamically per request from:
1. The operations manual (static, loaded at startup)
2. Current actions.yml content (hot-reloaded)
3. Current device states (injected per-message)
4. Decision boundaries (MOD vs A1 vs L1 vs Dave)

## Error Handling

- Escalation enforcement: Claude knows boundaries. A1/L1/Dave tasks get text responses, no tool calls.
- Tool failures: caught by BrainService, returned as `chat-error` with plain-English explanation.
- Rate limiting: one Claude API call at a time per session. Second message queues.
- No destructive defaults: panic and config changes always require confirmation.

## File Structure

### New Files

```
src/brain/
  brain-service.ts     — Core: Claude API calls, tool dispatch, mode logic
  tools.ts             — Tool definitions (schemas + execution handlers)
  system-prompt.ts     — Builds system prompt from manual + actions + state
  types.ts             — Chat types: messages, ProposedAction, etc.

ui/src/components/
  ChatDrawer.tsx        — Bottom drawer container
  ChatMessage.tsx       — Individual message rendering
  ActionCard.tsx        — Proposed/executed action with confirm/reject

ui/src/hooks/
  useChat.ts            — Chat state, WS send/receive
```

### Modified Files

```
src/server/websocket.ts    — Add chat message handlers, wire BrainService
src/hub.ts                 — Instantiate BrainService
ui/src/App.tsx             — Add ChatDrawer
ui/src/hooks/useProductionHub.ts — Handle chat message types
package.json               — Add @anthropic-ai/sdk
config.yml                 — Add brain: section
```

## Config

```yaml
brain:
  enabled: true
  model: "claude-sonnet-4-5-20250929"
  mode: "confirm"          # default execution mode
  manualPath: "./docs/booth-brain-operations-manual.txt"
```

API key via environment variable `ANTHROPIC_API_KEY`.
