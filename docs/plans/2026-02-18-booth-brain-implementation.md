# Booth Brain Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an AI chat assistant (Booth Brain) to Production Hub that translates MOD natural language into system commands via Claude API tool use.

**Architecture:** Booth Brain is a module inside Production Hub (`src/brain/`). It receives chat messages through the existing ModWebSocket on port 3001, calls Claude API with tool definitions that map to Production Hub capabilities, and either proposes or executes actions depending on the configured mode. The UI is a bottom drawer in the existing React MOD interface.

**Tech Stack:** TypeScript, `@anthropic-ai/sdk`, React 19, WebSocket (ws), existing Production Hub infrastructure.

**Design Doc:** `docs/plans/2026-02-18-booth-brain-design.md`

---

### Task 1: Install Anthropic SDK and add config

**Files:**
- Modify: `package.json`
- Modify: `config.yml`
- Modify: `src/config.ts` (if it exists; otherwise this is handled inline in hub.ts)

**Step 1: Install the SDK**

Run: `cd /Users/dave/projects/productionhub && npm install @anthropic-ai/sdk`

**Step 2: Add brain config to config.yml**

Append to the end of `config.yml`:

```yaml
# Booth Brain — AI assistant for MOD natural language control
brain:
  enabled: true
  model: "claude-sonnet-4-5-20250929"
  mode: "confirm"   # "confirm" = propose then confirm, "trusted" = execute immediately
```

**Step 3: Commit**

```bash
git add package.json package-lock.json config.yml
git commit -m "feat: add @anthropic-ai/sdk dependency and brain config"
```

---

### Task 2: Brain types

**Files:**
- Create: `src/brain/types.ts`

**Step 1: Create the types file**

```typescript
/**
 * Booth Brain Types
 *
 * Chat message types, proposed actions, and tool result shapes
 * for the AI reasoning layer.
 */

export type BrainMode = 'confirm' | 'trusted';

export interface BrainConfig {
  enabled: boolean;
  model: string;
  mode: BrainMode;
  manualPath?: string;
}

export interface ChatRequest {
  requestId: string;
  text: string;
}

export interface ProposedAction {
  tool: string;
  args: Record<string, any>;
  label: string;
}

export interface ChatResponse {
  requestId: string;
  text: string;
  actions?: ProposedAction[];
}

export interface ChatExecuted {
  requestId: string;
  actions: ProposedAction[];
  results: string[];
}

export interface ChatError {
  requestId: string;
  error: string;
}

/** Tool execution result returned by tool handlers */
export interface ToolResult {
  success: boolean;
  label: string;
  detail?: string;
}
```

**Step 2: Commit**

```bash
git add src/brain/types.ts
git commit -m "feat(brain): add chat message and tool result types"
```

---

### Task 3: System prompt builder

**Files:**
- Create: `src/brain/system-prompt.ts`

This builds the system prompt dynamically from the operations manual, action registry, and current device state.

**Step 1: Save a text version of the operations manual**

Run: `textutil -convert txt -stdout "/Users/dave/projects/booth-brain/Booth_Brain_Operations_Manual_V1.docx" > /Users/dave/projects/productionhub/docs/booth-brain-operations-manual.txt`

**Step 2: Create the system prompt builder**

```typescript
/**
 * System Prompt Builder
 *
 * Constructs the Claude system prompt from:
 * 1. Operations manual (static, loaded at startup)
 * 2. Action registry (current actions.yml content)
 * 3. Device states (injected per-message)
 * 4. Decision boundaries
 */

import * as fs from 'fs';
import * as path from 'path';
import { ActionRegistry } from '../actions/registry';

export class SystemPromptBuilder {
  private manual: string = '';

  constructor(manualPath?: string) {
    const resolved = manualPath ?? path.join(process.cwd(), 'docs', 'booth-brain-operations-manual.txt');
    try {
      this.manual = fs.readFileSync(resolved, 'utf-8');
      console.log(`[Brain] Loaded operations manual (${this.manual.length} chars)`);
    } catch (err: any) {
      console.warn(`[Brain] Could not load operations manual: ${err.message}`);
    }
  }

  /**
   * Build the full system prompt for a Claude API call.
   */
  build(actionRegistry: ActionRegistry, deviceStates: Record<string, any>): string {
    const parts: string[] = [];

    parts.push(`You are Booth Brain, the intelligent assistant for the Draylen Mason Music Studio (DMMS) production booth. You help the Manager on Duty (MOD) control the booth through natural language.

You translate MOD requests into system commands via the tools provided. You have direct access to all booth systems through Production Hub.

CRITICAL RULES:
- You NEVER guide a MOD into tasks beyond their training. If something requires an A1 (audio engineer), L1 (lighting engineer), or Dave, say so and do NOT attempt the action.
- A1 tasks: multi-mic setups (3+), band audio, live mixing, monitor mixes, significant cable runs
- L1 tasks: programming new lighting cues, busking live, DMX patching, fixture troubleshooting
- Dave tasks: Production Hub config, network infrastructure, QLab show file creation, system integration, terminal commands, code
- Recording is ALWAYS on. Every event gets recorded. Treat "start recording" as a default, not a request.
- NEVER shut down the Mac computers. Monitors and boards get powered off. Macs stay on 24/7.
- NEVER delete, modify, or "clean up" network patches, QLab cues, or system configuration during a live show.
- When you execute actions, be concise. The MOD is busy running a show. Short confirmations, not essays.`);

    // Action vocabulary
    const categories = actionRegistry.getCategoryList();
    if (categories.length > 0) {
      parts.push('\n## Available Actions\nThese are the named actions you can execute via the execute_action tool:\n');
      for (const cat of categories) {
        parts.push(`### ${cat.icon} ${cat.category}`);
        for (const item of cat.items) {
          parts.push(`- **${item.id}**: ${item.label} — ${item.desc}`);
        }
      }
    }

    // Current device states
    if (Object.keys(deviceStates).length > 0) {
      parts.push('\n## Current Device States\n');
      for (const [device, state] of Object.entries(deviceStates)) {
        if (state) {
          parts.push(`### ${device}\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\``);
        }
      }
    }

    // Operations manual
    if (this.manual) {
      parts.push('\n## Operations Manual Reference\n');
      parts.push(this.manual);
    }

    return parts.join('\n');
  }
}
```

**Step 3: Commit**

```bash
git add docs/booth-brain-operations-manual.txt src/brain/system-prompt.ts
git commit -m "feat(brain): add system prompt builder with operations manual"
```

---

### Task 4: Tool definitions

**Files:**
- Create: `src/brain/tools.ts`

These are the Claude tool definitions (JSON schemas) and their execution handlers.

**Step 1: Create the tools file**

```typescript
/**
 * Booth Brain Tool Definitions
 *
 * Each tool has a Claude-compatible schema and an execute() handler
 * that performs the action against Production Hub.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ActionRegistry } from '../actions/registry';
import { CueEngine } from '../cue-engine/engine';
import { ToolResult } from './types';

export type RouteOSCFn = (address: string, args: any[]) => void;

export interface ToolDeps {
  actionRegistry: ActionRegistry;
  cueEngine: CueEngine;
  routeOSC: RouteOSCFn;
  getDeviceStates: () => Record<string, any>;
}

/** Claude tool definitions sent in API requests */
export function getToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: 'execute_action',
      description: 'Execute a named action from the action registry. Actions are pre-defined command bundles like "house-half" or "stream-start". Use get_actions first if unsure which action ID to use.',
      input_schema: {
        type: 'object' as const,
        properties: {
          action_id: {
            type: 'string',
            description: 'The action ID from the registry (e.g. "house-half", "stream-start", "cam-wide")',
          },
        },
        required: ['action_id'],
      },
    },
    {
      name: 'send_osc',
      description: 'Send a raw OSC command to any device. Use this for commands not covered by named actions. The address must include the device prefix (e.g. "/avantis/ch/5/mix/fader").',
      input_schema: {
        type: 'object' as const,
        properties: {
          address: {
            type: 'string',
            description: 'Full OSC address including device prefix (e.g. "/avantis/ch/5/mix/fade", "/lights/pb/1/1", "/obs/scene/Interview")',
          },
          args: {
            type: 'array',
            items: {},
            description: 'OSC arguments (numbers, strings). E.g. [0.8] for a fader value, [0.0, 3.0, "scurve"] for a fade.',
          },
        },
        required: ['address'],
      },
    },
    {
      name: 'fire_cue',
      description: 'Fire the next cue in the cue stack, or go to standby. Use "go" to fire the next cue, "standby" to return to the top of the show.',
      input_schema: {
        type: 'object' as const,
        properties: {
          command: {
            type: 'string',
            enum: ['go', 'standby'],
            description: '"go" fires the next cue. "standby" returns to the top of the show.',
          },
        },
        required: ['command'],
      },
    },
    {
      name: 'get_device_state',
      description: 'Get the current state of a device. Returns JSON with current settings (fader levels, scene, streaming status, etc.).',
      input_schema: {
        type: 'object' as const,
        properties: {
          device: {
            type: 'string',
            enum: ['avantis', 'obs', 'chamsys', 'visca', 'touchdesigner', 'all'],
            description: 'Device to query. Use "all" to get all device states.',
          },
        },
        required: ['device'],
      },
    },
    {
      name: 'get_show_state',
      description: 'Get the current show state: cue list, active cue index, fired cues. Use this to answer questions about cue position.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'get_actions',
      description: 'List all available actions from the action registry, grouped by category. Use this to discover what actions are available before executing one.',
      input_schema: {
        type: 'object' as const,
        properties: {
          category: {
            type: 'string',
            description: 'Optional: filter to a specific category (e.g. "House Lights", "Audio", "Camera")',
          },
        },
      },
    },
    {
      name: 'recall_scene',
      description: 'Recall an Avantis mixing scene by number. This changes the entire console state.',
      input_schema: {
        type: 'object' as const,
        properties: {
          scene_number: {
            type: 'number',
            description: 'The scene number to recall (1-based)',
          },
        },
        required: ['scene_number'],
      },
    },
    {
      name: 'camera_preset',
      description: 'Move a PTZ camera to a saved preset position.',
      input_schema: {
        type: 'object' as const,
        properties: {
          camera: {
            type: 'string',
            enum: ['cam1', 'cam2', 'cam3'],
            description: 'Which camera to move',
          },
          preset: {
            type: 'number',
            description: 'Preset number (1-based)',
          },
        },
        required: ['camera', 'preset'],
      },
    },
  ];
}

/** Execute a tool call and return the result */
export function executeTool(name: string, args: Record<string, any>, deps: ToolDeps): ToolResult {
  switch (name) {
    case 'execute_action': {
      const actionId = args.action_id as string;
      const action = deps.actionRegistry.getAction(actionId);
      if (!action) {
        return { success: false, label: `Unknown action: ${actionId}` };
      }
      // Execute by routing each command through the hub
      for (const cmd of action.commands) {
        const prefix = cmd.prefix ? `/${cmd.prefix}` : resolvePrefix(cmd.device);
        deps.routeOSC(`${prefix}${cmd.address}`, cmd.args ?? []);
      }
      return { success: true, label: `${action.category}: ${action.label}`, detail: action.description };
    }

    case 'send_osc': {
      const address = args.address as string;
      const oscArgs = (args.args as any[]) ?? [];
      deps.routeOSC(address, oscArgs);
      return { success: true, label: `OSC: ${address}`, detail: `args: ${JSON.stringify(oscArgs)}` };
    }

    case 'fire_cue': {
      const command = args.command as string;
      if (command === 'go') {
        deps.cueEngine.go();
        const state = deps.cueEngine.getState();
        const cueName = state.activeCueIndex !== null ? state.cues[state.activeCueIndex]?.name : 'none';
        return { success: true, label: `Fired cue: ${cueName}` };
      } else if (command === 'standby') {
        deps.cueEngine.standby();
        return { success: true, label: 'Returned to standby' };
      }
      return { success: false, label: `Unknown cue command: ${command}` };
    }

    case 'get_device_state': {
      const device = args.device as string;
      const states = deps.getDeviceStates();
      if (device === 'all') {
        return { success: true, label: 'All device states', detail: JSON.stringify(states, null, 2) };
      }
      const state = states[device];
      if (!state) {
        return { success: true, label: `${device}: no state available` };
      }
      return { success: true, label: `${device} state`, detail: JSON.stringify(state, null, 2) };
    }

    case 'get_show_state': {
      const state = deps.cueEngine.getState();
      return { success: true, label: 'Show state', detail: JSON.stringify(state, null, 2) };
    }

    case 'get_actions': {
      const category = args.category as string | undefined;
      const categories = deps.actionRegistry.getCategoryList();
      const filtered = category
        ? categories.filter(c => c.category.toLowerCase() === category.toLowerCase())
        : categories;
      const summary = filtered.map(c =>
        `${c.icon} ${c.category}: ${c.items.map(i => `${i.id} (${i.label})`).join(', ')}`
      ).join('\n');
      return { success: true, label: 'Available actions', detail: summary };
    }

    case 'recall_scene': {
      const sceneNumber = args.scene_number as number;
      deps.routeOSC('/avantis/scene/recall', [sceneNumber]);
      return { success: true, label: `Recalled Avantis scene ${sceneNumber}` };
    }

    case 'camera_preset': {
      const camera = args.camera as string;
      const preset = args.preset as number;
      deps.routeOSC(`/${camera}/preset/recall/${preset}`, []);
      return { success: true, label: `${camera} to preset ${preset}` };
    }

    default:
      return { success: false, label: `Unknown tool: ${name}` };
  }
}

function resolvePrefix(device: string): string {
  const defaults: Record<string, string> = {
    avantis: '/avantis',
    chamsys: '/lights',
    obs: '/obs',
    visca: '/cam1',
    touchdesigner: '/td',
  };
  return defaults[device] ?? `/${device}`;
}
```

**Step 2: Commit**

```bash
git add src/brain/tools.ts
git commit -m "feat(brain): add Claude tool definitions and execution handlers"
```

---

### Task 5: BrainService

**Files:**
- Create: `src/brain/brain-service.ts`

The core service: receives chat messages, calls Claude API, handles confirm/execute flow.

**Step 1: Create the brain service**

```typescript
/**
 * BrainService
 *
 * Core AI reasoning layer. Receives natural language from the MOD,
 * calls Claude API with tool definitions, and returns proposed or
 * executed actions.
 *
 * Flow:
 * 1. MOD sends chat message
 * 2. BrainService builds system prompt (manual + actions + device state)
 * 3. Calls Claude API with tools
 * 4. If Claude returns tool_use blocks:
 *    - Confirm mode: return ProposedActions for MOD to approve
 *    - Trusted mode: execute immediately, return results
 * 5. If Claude returns text only: return as chat response
 */

import Anthropic from '@anthropic-ai/sdk';
import { ActionRegistry } from '../actions/registry';
import { CueEngine } from '../cue-engine/engine';
import { SystemPromptBuilder } from './system-prompt';
import { getToolDefinitions, executeTool, ToolDeps, RouteOSCFn } from './tools';
import {
  BrainConfig,
  BrainMode,
  ChatRequest,
  ChatResponse,
  ChatExecuted,
  ChatError,
  ProposedAction,
} from './types';

/** Actions that always require confirmation regardless of mode */
const ALWAYS_CONFIRM_TOOLS = new Set<string>([
  // No tools are forced-confirm for now; hub/panic goes through send_osc
  // and we check the address there
]);

const ALWAYS_CONFIRM_ADDRESSES = ['/hub/panic', '/fade/stop'];

export class BrainService {
  private client: Anthropic;
  private model: string;
  private mode: BrainMode;
  private promptBuilder: SystemPromptBuilder;
  private actionRegistry: ActionRegistry;
  private cueEngine: CueEngine;
  private routeOSC: RouteOSCFn;
  private getDeviceStates: () => Record<string, any>;
  private processing = false;
  private queue: Array<{ request: ChatRequest; resolve: (result: ChatResponse | ChatError) => void }> = [];

  /** Pending confirmations: requestId → proposed actions */
  private pendingConfirms = new Map<string, ProposedAction[]>();

  constructor(
    config: BrainConfig,
    actionRegistry: ActionRegistry,
    cueEngine: CueEngine,
    routeOSC: RouteOSCFn,
    getDeviceStates: () => Record<string, any>,
  ) {
    this.client = new Anthropic();  // reads ANTHROPIC_API_KEY from env
    this.model = config.model;
    this.mode = config.mode;
    this.promptBuilder = new SystemPromptBuilder(config.manualPath);
    this.actionRegistry = actionRegistry;
    this.cueEngine = cueEngine;
    this.routeOSC = routeOSC;
    this.getDeviceStates = getDeviceStates;
  }

  getMode(): BrainMode {
    return this.mode;
  }

  setMode(mode: BrainMode): void {
    this.mode = mode;
    console.log(`[Brain] Mode set to: ${mode}`);
  }

  /** Process a chat message from the MOD */
  async handleMessage(request: ChatRequest): Promise<ChatResponse | ChatExecuted | ChatError> {
    // Queue if already processing
    if (this.processing) {
      return new Promise((resolve) => {
        this.queue.push({ request, resolve });
      });
    }

    this.processing = true;
    try {
      return await this.process(request);
    } finally {
      this.processing = false;
      this.processQueue();
    }
  }

  /** Confirm pending actions */
  confirmActions(requestId: string): ChatExecuted | ChatError {
    const actions = this.pendingConfirms.get(requestId);
    if (!actions) {
      return { requestId, error: 'No pending actions for this request' };
    }

    this.pendingConfirms.delete(requestId);
    const results: string[] = [];

    for (const action of actions) {
      const result = executeTool(action.tool, action.args, this.getToolDeps());
      results.push(result.label);
    }

    return { requestId, actions, results };
  }

  /** Reject pending actions */
  rejectActions(requestId: string): void {
    this.pendingConfirms.delete(requestId);
  }

  private async process(request: ChatRequest): Promise<ChatResponse | ChatExecuted | ChatError> {
    try {
      const systemPrompt = this.promptBuilder.build(this.actionRegistry, this.getDeviceStates());

      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: systemPrompt,
        tools: getToolDefinitions(),
        messages: [
          { role: 'user', content: request.text },
        ],
      });

      // Extract text and tool use blocks
      const textBlocks = response.content.filter(b => b.type === 'text');
      const toolBlocks = response.content.filter(b => b.type === 'tool_use');
      const text = textBlocks.map(b => b.type === 'text' ? b.text : '').join('\n').trim();

      // No tool calls — just text response
      if (toolBlocks.length === 0) {
        return { requestId: request.requestId, text };
      }

      // Build proposed actions from tool calls
      const proposed: ProposedAction[] = toolBlocks.map(block => {
        if (block.type !== 'tool_use') throw new Error('unreachable');
        return {
          tool: block.name,
          args: block.input as Record<string, any>,
          label: this.labelForTool(block.name, block.input as Record<string, any>),
        };
      });

      // Check if any action requires forced confirmation
      const forceConfirm = proposed.some(a => this.requiresConfirmation(a));

      if (this.mode === 'trusted' && !forceConfirm) {
        // Execute immediately
        const results: string[] = [];
        for (const action of proposed) {
          const result = executeTool(action.tool, action.args, this.getToolDeps());
          results.push(result.label);
        }
        return { requestId: request.requestId, actions: proposed, results };
      }

      // Confirm mode: store pending and return proposed
      this.pendingConfirms.set(request.requestId, proposed);
      return { requestId: request.requestId, text: text || 'I\'d like to do the following:', actions: proposed };

    } catch (err: any) {
      console.error(`[Brain] API error: ${err.message}`);
      return { requestId: request.requestId, error: `Brain error: ${err.message}` };
    }
  }

  private requiresConfirmation(action: ProposedAction): boolean {
    if (ALWAYS_CONFIRM_TOOLS.has(action.tool)) return true;
    if (action.tool === 'send_osc') {
      const address = (action.args.address as string ?? '').toLowerCase();
      return ALWAYS_CONFIRM_ADDRESSES.some(a => address.startsWith(a));
    }
    return false;
  }

  private labelForTool(name: string, args: Record<string, any>): string {
    switch (name) {
      case 'execute_action': {
        const action = this.actionRegistry.getAction(args.action_id);
        return action ? `${action.category}: ${action.label}` : `Action: ${args.action_id}`;
      }
      case 'send_osc':
        return `OSC: ${args.address} ${JSON.stringify(args.args ?? [])}`;
      case 'fire_cue':
        return args.command === 'go' ? 'Fire next cue' : 'Return to standby';
      case 'get_device_state':
        return `Check ${args.device} state`;
      case 'get_show_state':
        return 'Check show state';
      case 'get_actions':
        return args.category ? `List ${args.category} actions` : 'List all actions';
      case 'recall_scene':
        return `Recall Avantis scene ${args.scene_number}`;
      case 'camera_preset':
        return `${args.camera} to preset ${args.preset}`;
      default:
        return `${name}(${JSON.stringify(args)})`;
    }
  }

  private getToolDeps(): ToolDeps {
    return {
      actionRegistry: this.actionRegistry,
      cueEngine: this.cueEngine,
      routeOSC: this.routeOSC,
      getDeviceStates: this.getDeviceStates,
    };
  }

  private processQueue(): void {
    if (this.queue.length === 0) return;
    const next = this.queue.shift()!;
    this.processing = true;
    this.process(next.request)
      .then(result => next.resolve(result as ChatResponse | ChatError))
      .finally(() => {
        this.processing = false;
        this.processQueue();
      });
  }
}
```

**Step 2: Commit**

```bash
git add src/brain/brain-service.ts
git commit -m "feat(brain): add BrainService with Claude API integration and confirm/trusted modes"
```

---

### Task 6: Wire BrainService into ModWebSocket and Hub

**Files:**
- Modify: `src/server/websocket.ts`
- Modify: `src/hub.ts`

**Step 1: Extend ModWebSocket to accept BrainService and handle chat messages**

In `src/server/websocket.ts`:

1. Add import for BrainService at the top:
```typescript
import { BrainService } from '../brain/brain-service';
```

2. Add a `brainService` property and update the constructor to accept an optional BrainService:
   - Add `private brainService?: BrainService;` field
   - Add parameter to constructor: `brainService?: BrainService`
   - Assign: `this.brainService = brainService;`

3. On new client connection, send current brain mode if brain is enabled:
```typescript
if (this.brainService) {
  this.send(ws, { type: 'chat-mode', mode: this.brainService.getMode() });
}
```

4. Add chat message cases in `handleMessage()` before the `default` case:

```typescript
case 'chat-message': {
  if (!this.brainService) {
    this.broadcast({ type: 'chat-error', requestId: msg.requestId ?? 'unknown', error: 'Brain is not enabled' });
    break;
  }
  const requestId = msg.requestId ?? `req-${Date.now()}`;
  this.brainService.handleMessage({ requestId, text: msg.text })
    .then(result => {
      if ('error' in result) {
        this.broadcast({ type: 'chat-error', ...result });
      } else if ('results' in result) {
        this.broadcast({ type: 'chat-executed', ...result });
      } else {
        this.broadcast({ type: 'chat-response', ...result });
      }
    })
    .catch(err => {
      this.broadcast({ type: 'chat-error', requestId, error: err.message });
    });
  break;
}

case 'chat-confirm': {
  if (!this.brainService) break;
  const result = this.brainService.confirmActions(msg.requestId);
  if ('error' in result) {
    this.broadcast({ type: 'chat-error', ...result });
  } else {
    this.broadcast({ type: 'chat-executed', ...result });
  }
  break;
}

case 'chat-reject': {
  if (!this.brainService) break;
  this.brainService.rejectActions(msg.requestId);
  this.broadcast({ type: 'chat-response', requestId: msg.requestId, text: 'Action cancelled.' });
  break;
}

case 'chat-set-mode': {
  if (!this.brainService) break;
  const mode = msg.mode;
  if (mode === 'confirm' || mode === 'trusted') {
    this.brainService.setMode(mode);
    this.broadcast({ type: 'chat-mode', mode });
  }
  break;
}
```

**Step 2: Update Hub to instantiate BrainService**

In `src/hub.ts`:

1. Add imports:
```typescript
import { BrainService } from './brain/brain-service';
import { BrainConfig } from './brain/types';
```

2. Add `brain?: BrainConfig` to the `HubConfig` interface.

3. Add `private brainService?: BrainService;` field to the class.

4. In the constructor, after `this.macroEngine` setup (~line 182), add:
```typescript
// Booth Brain AI assistant
if (config.brain?.enabled) {
  this.brainService = new BrainService(
    config.brain,
    this.actionRegistry,
    this.cueEngine,
    (address, args) => this.routeOSC(address, args),
    () => this.getDeviceStatesSnapshot(),
  );
}
```

5. Add a helper method to the class:
```typescript
/** Get a snapshot of all device states for Brain context */
private getDeviceStatesSnapshot(): Record<string, any> {
  const states: Record<string, any> = {};
  for (const driver of this.driverManager.getDrivers()) {
    if ('getState' in driver && typeof (driver as any).getState === 'function') {
      states[driver.name] = (driver as any).getState();
    }
  }
  return states;
}
```

6. In the `start()` method, update the ModWebSocket constructor call (~line 265) to pass brainService:
```typescript
this.modWebSocket = new ModWebSocket(
  { port: this.uiConfig.port },
  this.cueEngine,
  this.actionRegistry,
  this.templateLoader,
  this.showPersistence,
  (address, args) => this.routeOSC(address, args),
  this.brainService,  // <-- add this
);
```

**Step 3: Commit**

```bash
git add src/server/websocket.ts src/hub.ts
git commit -m "feat(brain): wire BrainService into ModWebSocket and Hub"
```

---

### Task 7: Update config parser

**Files:**
- Modify: `src/config.ts` (or wherever config.yml is parsed into HubConfig)
- Alternatively, modify `src/index.ts` if config parsing happens there

**Step 1: Find where config is parsed**

Run: `grep -rn "config.yml\|parseYaml\|HubConfig" /Users/dave/projects/productionhub/src/index.ts /Users/dave/projects/productionhub/src/config.ts 2>/dev/null`

Read the relevant file and add parsing for the `brain` section so it gets passed to `HubConfig.brain`.

The brain config shape:
```typescript
brain: {
  enabled: boolean;
  model: string;
  mode: 'confirm' | 'trusted';
  manualPath?: string;
}
```

Map it from the YAML `brain:` section into `HubConfig.brain`.

**Step 2: Commit**

```bash
git add src/index.ts  # or src/config.ts, whichever was modified
git commit -m "feat(brain): parse brain config from config.yml"
```

---

### Task 8: Update UI types for chat messages

**Files:**
- Modify: `ui/src/types.ts`

**Step 1: Add chat-related types to the UI types file**

Add these types:

```typescript
// Chat / Brain types
export interface ProposedAction {
  tool: string;
  args: Record<string, any>;
  label: string;
}

export type BrainMode = 'confirm' | 'trusted';
```

Add these to `ServerMessage` union:

```typescript
| { type: 'chat-response'; requestId: string; text: string; actions?: ProposedAction[] }
| { type: 'chat-executed'; requestId: string; actions: ProposedAction[]; results: string[] }
| { type: 'chat-error'; requestId: string; error: string }
| { type: 'chat-mode'; mode: BrainMode }
```

Add these to `ClientMessage` union:

```typescript
| { type: 'chat-message'; requestId: string; text: string }
| { type: 'chat-confirm'; requestId: string }
| { type: 'chat-reject'; requestId: string }
| { type: 'chat-set-mode'; mode: BrainMode }
```

**Step 2: Commit**

```bash
git add ui/src/types.ts
git commit -m "feat(brain): add chat message types to UI type definitions"
```

---

### Task 9: useChat hook

**Files:**
- Create: `ui/src/hooks/useChat.ts`

**Step 1: Create the hook**

```typescript
import { useState, useCallback } from 'react';
import type { ProposedAction, BrainMode, ClientMessage, ServerMessage } from '../types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'brain';
  text: string;
  actions?: ProposedAction[];
  results?: string[];
  status: 'sent' | 'pending' | 'confirmed' | 'rejected' | 'executed' | 'error';
  error?: string;
}

export function useChat(
  send: (msg: ClientMessage) => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<BrainMode>('confirm');
  const [thinking, setThinking] = useState(false);

  const sendMessage = useCallback((text: string) => {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Add user message
    setMessages(prev => [...prev, {
      id: requestId,
      role: 'user',
      text,
      status: 'sent',
    }]);

    setThinking(true);
    send({ type: 'chat-message', requestId, text });
  }, [send]);

  const confirm = useCallback((requestId: string) => {
    send({ type: 'chat-confirm', requestId });
    setMessages(prev => prev.map(m =>
      m.id === requestId ? { ...m, status: 'confirmed' as const } : m
    ));
  }, [send]);

  const reject = useCallback((requestId: string) => {
    send({ type: 'chat-reject', requestId });
    setMessages(prev => prev.map(m =>
      m.id === requestId ? { ...m, status: 'rejected' as const } : m
    ));
  }, [send]);

  const toggleMode = useCallback(() => {
    const newMode = mode === 'confirm' ? 'trusted' : 'confirm';
    send({ type: 'chat-set-mode', mode: newMode });
  }, [mode, send]);

  /** Handle incoming server messages — call this from useProductionHub */
  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'chat-response':
        setThinking(false);
        setMessages(prev => [...prev, {
          id: msg.requestId,
          role: 'brain',
          text: msg.text,
          actions: msg.actions,
          status: msg.actions && msg.actions.length > 0 ? 'pending' : 'sent',
        }]);
        break;

      case 'chat-executed':
        setThinking(false);
        setMessages(prev => {
          // Check if there's already a pending message for this requestId
          const existing = prev.find(m => m.id === msg.requestId && m.role === 'brain');
          if (existing) {
            return prev.map(m =>
              m.id === msg.requestId && m.role === 'brain'
                ? { ...m, results: msg.results, status: 'executed' as const }
                : m
            );
          }
          // Trusted mode: no prior brain message, add one
          return [...prev, {
            id: msg.requestId,
            role: 'brain',
            text: 'Done.',
            actions: msg.actions,
            results: msg.results,
            status: 'executed',
          }];
        });
        break;

      case 'chat-error':
        setThinking(false);
        setMessages(prev => [...prev, {
          id: msg.requestId,
          role: 'brain',
          text: '',
          status: 'error',
          error: msg.error,
        }]);
        break;

      case 'chat-mode':
        setMode(msg.mode);
        break;
    }
  }, []);

  return { messages, mode, thinking, sendMessage, confirm, reject, toggleMode, handleServerMessage };
}
```

**Step 2: Commit**

```bash
git add ui/src/hooks/useChat.ts
git commit -m "feat(brain): add useChat hook for chat state management"
```

---

### Task 10: ChatDrawer, ChatMessage, and ActionCard components

**Files:**
- Create: `ui/src/components/ChatDrawer.tsx`
- Create: `ui/src/components/ChatMessage.tsx`
- Create: `ui/src/components/ActionCard.tsx`

**Step 1: Create ActionCard**

`ui/src/components/ActionCard.tsx`:

```tsx
import type { ProposedAction } from '../types';

interface Props {
  action: ProposedAction;
  index: number;
  status: 'pending' | 'confirmed' | 'rejected' | 'executed';
  result?: string;
}

export default function ActionCard({ action, status, result }: Props) {
  const bgColor = status === 'executed' ? '#064E3B'
    : status === 'rejected' ? '#7F1D1D'
    : '#1E293B';

  const borderColor = status === 'executed' ? '#10B981'
    : status === 'rejected' ? '#EF4444'
    : '#334155';

  return (
    <div style={{
      background: bgColor,
      border: `1px solid ${borderColor}`,
      borderRadius: 6,
      padding: '6px 10px',
      marginTop: 4,
      fontSize: 12,
    }}>
      <div style={{ color: '#E2E8F0', fontWeight: 500 }}>{action.label}</div>
      {result && (
        <div style={{ color: '#94A3B8', fontSize: 11, marginTop: 2 }}>{result}</div>
      )}
    </div>
  );
}
```

**Step 2: Create ChatMessage**

`ui/src/components/ChatMessage.tsx`:

```tsx
import type { ChatMessage as ChatMsg } from '../hooks/useChat';
import ActionCard from './ActionCard';

interface Props {
  message: ChatMsg;
  onConfirm: (requestId: string) => void;
  onReject: (requestId: string) => void;
}

export default function ChatMessage({ message, onConfirm, onReject }: Props) {
  const isUser = message.role === 'user';

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 8,
    }}>
      <div style={{
        maxWidth: '85%',
        background: isUser ? '#1D4ED8' : '#1E293B',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 13,
        color: '#E2E8F0',
      }}>
        {message.error && (
          <div style={{ color: '#F87171' }}>{message.error}</div>
        )}

        {message.text && <div>{message.text}</div>}

        {message.actions && message.actions.map((action, i) => (
          <ActionCard
            key={i}
            action={action}
            index={i}
            status={message.status === 'executed' ? 'executed' : message.status === 'rejected' ? 'rejected' : 'pending'}
            result={message.results?.[i]}
          />
        ))}

        {message.status === 'pending' && message.actions && message.actions.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              onClick={() => onConfirm(message.id)}
              style={{
                background: '#10B981', color: '#fff', border: 'none',
                borderRadius: 4, padding: '4px 12px', fontSize: 12,
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              Confirm
            </button>
            <button
              onClick={() => onReject(message.id)}
              style={{
                background: '#EF4444', color: '#fff', border: 'none',
                borderRadius: 4, padding: '4px 12px', fontSize: 12,
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 3: Create ChatDrawer**

`ui/src/components/ChatDrawer.tsx`:

```tsx
import { useState, useRef, useEffect } from 'react';
import type { ChatMessage as ChatMsg } from '../hooks/useChat';
import type { BrainMode } from '../types';
import ChatMessage from './ChatMessage';

interface Props {
  messages: ChatMsg[];
  mode: BrainMode;
  thinking: boolean;
  onSend: (text: string) => void;
  onConfirm: (requestId: string) => void;
  onReject: (requestId: string) => void;
  onToggleMode: () => void;
}

export default function ChatDrawer({
  messages, mode, thinking, onSend, onConfirm, onReject, onToggleMode,
}: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput('');
  };

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: 'fixed',
          bottom: open ? undefined : 16,
          right: 16,
          zIndex: 300,
          background: '#6366F1',
          color: '#fff',
          border: 'none',
          borderRadius: open ? '6px 6px 0 0' : 24,
          padding: open ? '6px 16px' : '10px 16px',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          display: open ? 'none' : 'flex',
          alignItems: 'center',
          gap: 6,
          boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
        }}
      >
        Brain
      </button>

      {/* Drawer */}
      {open && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: 340,
          background: '#0F172A',
          borderTop: '2px solid #6366F1',
          zIndex: 300,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            borderBottom: '1px solid #1E293B',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#E2E8F0' }}>
                Booth Brain
              </span>
              <button
                onClick={onToggleMode}
                style={{
                  background: mode === 'trusted' ? '#DC2626' : '#1E293B',
                  color: mode === 'trusted' ? '#fff' : '#94A3B8',
                  border: `1px solid ${mode === 'trusted' ? '#DC2626' : '#334155'}`,
                  borderRadius: 12,
                  padding: '2px 10px',
                  fontSize: 11,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {mode === 'confirm' ? 'Confirm Mode' : 'Trusted Mode'}
              </button>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: 'none', border: 'none', color: '#94A3B8',
                cursor: 'pointer', fontSize: 18, lineHeight: 1,
              }}
            >
              x
            </button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 16px',
          }}>
            {messages.length === 0 && (
              <div style={{ color: '#475569', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
                Type a command or ask a question.
              </div>
            )}
            {messages.map((msg, i) => (
              <ChatMessage
                key={`${msg.id}-${msg.role}-${i}`}
                message={msg}
                onConfirm={onConfirm}
                onReject={onReject}
              />
            ))}
            {thinking && (
              <div style={{ color: '#6366F1', fontSize: 12, padding: '4px 0' }}>
                Thinking...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} style={{
            display: 'flex',
            padding: '8px 16px',
            borderTop: '1px solid #1E293B',
            gap: 8,
          }}>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Tell Booth Brain what you need..."
              disabled={thinking}
              style={{
                flex: 1,
                background: '#1E293B',
                border: '1px solid #334155',
                borderRadius: 6,
                padding: '8px 12px',
                color: '#E2E8F0',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={thinking || !input.trim()}
              style={{
                background: '#6366F1',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                cursor: thinking ? 'not-allowed' : 'pointer',
                opacity: thinking || !input.trim() ? 0.5 : 1,
              }}
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
```

**Step 4: Commit**

```bash
git add ui/src/components/ActionCard.tsx ui/src/components/ChatMessage.tsx ui/src/components/ChatDrawer.tsx
git commit -m "feat(brain): add ChatDrawer, ChatMessage, and ActionCard UI components"
```

---

### Task 11: Wire chat into App and useProductionHub

**Files:**
- Modify: `ui/src/App.tsx`
- Modify: `ui/src/hooks/useProductionHub.ts`

**Step 1: Update useProductionHub to expose chat message handler**

In `ui/src/hooks/useProductionHub.ts`, add chat message types to the switch in `ws.onmessage`:

After the existing cases (`state`, `actions`, `templates`), add:

```typescript
case 'chat-response':
case 'chat-executed':
case 'chat-error':
case 'chat-mode':
  // Forward to chat handler (set via callback)
  if (chatHandlerRef.current) {
    chatHandlerRef.current(msg);
  }
  break;
```

Add a ref for the chat handler:
```typescript
const chatHandlerRef = useRef<((msg: ServerMessage) => void) | null>(null);

const setChatHandler = useCallback((handler: (msg: ServerMessage) => void) => {
  chatHandlerRef.current = handler;
}, []);
```

Return `setChatHandler` from the hook alongside existing returns.

**Step 2: Update App.tsx**

Add imports:
```typescript
import ChatDrawer from './components/ChatDrawer';
import { useChat } from './hooks/useChat';
```

Inside `App()`, after the existing hooks:
```typescript
const chat = useChat(send);

// Wire chat message handler
useEffect(() => {
  setChatHandler(chat.handleServerMessage);
}, [setChatHandler, chat.handleServerMessage]);
```

Add `<ChatDrawer>` before the closing `</div>` of the root:
```tsx
<ChatDrawer
  messages={chat.messages}
  mode={chat.mode}
  thinking={chat.thinking}
  onSend={chat.sendMessage}
  onConfirm={chat.confirm}
  onReject={chat.reject}
  onToggleMode={chat.toggleMode}
/>
```

**Step 3: Commit**

```bash
git add ui/src/App.tsx ui/src/hooks/useProductionHub.ts
git commit -m "feat(brain): wire ChatDrawer into App with message forwarding"
```

---

### Task 12: Add barrel export for brain module

**Files:**
- Create: `src/brain/index.ts`

**Step 1: Create the barrel export**

```typescript
export { BrainService } from './brain-service';
export { SystemPromptBuilder } from './system-prompt';
export { getToolDefinitions, executeTool } from './tools';
export * from './types';
```

**Step 2: Commit**

```bash
git add src/brain/index.ts
git commit -m "feat(brain): add barrel export for brain module"
```

---

### Task 13: Test BrainService tool execution

**Files:**
- Create: `test/brain-tools.test.ts`

**Step 1: Write tests for tool execution (no API calls — just tool handlers)**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { executeTool, ToolDeps } from '../src/brain/tools';
import { ActionRegistry } from '../src/actions/registry';
import { CueEngine } from '../src/cue-engine/engine';

function makeDeps(overrides?: Partial<ToolDeps>): ToolDeps {
  const registry = new ActionRegistry('/dev/null');
  const cueEngine = new CueEngine(registry, () => {});

  return {
    actionRegistry: registry,
    cueEngine,
    routeOSC: vi.fn(),
    getDeviceStates: () => ({}),
    ...overrides,
  };
}

describe('brain tools', () => {
  describe('send_osc', () => {
    it('routes OSC command', () => {
      const routeOSC = vi.fn();
      const deps = makeDeps({ routeOSC });
      const result = executeTool('send_osc', { address: '/avantis/ch/5/mix/fader', args: [0.8] }, deps);
      expect(result.success).toBe(true);
      expect(routeOSC).toHaveBeenCalledWith('/avantis/ch/5/mix/fader', [0.8]);
    });

    it('defaults args to empty array', () => {
      const routeOSC = vi.fn();
      const deps = makeDeps({ routeOSC });
      executeTool('send_osc', { address: '/lights/pb/1/1' }, deps);
      expect(routeOSC).toHaveBeenCalledWith('/lights/pb/1/1', []);
    });
  });

  describe('fire_cue', () => {
    it('fires next cue on "go"', () => {
      const deps = makeDeps();
      const goSpy = vi.spyOn(deps.cueEngine, 'go');
      const result = executeTool('fire_cue', { command: 'go' }, deps);
      expect(result.success).toBe(true);
      expect(goSpy).toHaveBeenCalled();
    });

    it('returns to standby', () => {
      const deps = makeDeps();
      const standbySpy = vi.spyOn(deps.cueEngine, 'standby');
      const result = executeTool('fire_cue', { command: 'standby' }, deps);
      expect(result.success).toBe(true);
      expect(standbySpy).toHaveBeenCalled();
    });
  });

  describe('get_device_state', () => {
    it('returns specific device state', () => {
      const deps = makeDeps({
        getDeviceStates: () => ({ obs: { streaming: true, recording: false } }),
      });
      const result = executeTool('get_device_state', { device: 'obs' }, deps);
      expect(result.success).toBe(true);
      expect(result.detail).toContain('streaming');
    });

    it('returns all device states', () => {
      const deps = makeDeps({
        getDeviceStates: () => ({ obs: { streaming: true }, avantis: { currentScene: 1 } }),
      });
      const result = executeTool('get_device_state', { device: 'all' }, deps);
      expect(result.success).toBe(true);
      expect(result.detail).toContain('obs');
      expect(result.detail).toContain('avantis');
    });
  });

  describe('get_show_state', () => {
    it('returns current show state', () => {
      const deps = makeDeps();
      const result = executeTool('get_show_state', {}, deps);
      expect(result.success).toBe(true);
      expect(result.detail).toContain('cues');
    });
  });

  describe('recall_scene', () => {
    it('sends scene recall OSC', () => {
      const routeOSC = vi.fn();
      const deps = makeDeps({ routeOSC });
      const result = executeTool('recall_scene', { scene_number: 3 }, deps);
      expect(result.success).toBe(true);
      expect(routeOSC).toHaveBeenCalledWith('/avantis/scene/recall', [3]);
    });
  });

  describe('camera_preset', () => {
    it('sends preset recall for correct camera', () => {
      const routeOSC = vi.fn();
      const deps = makeDeps({ routeOSC });
      const result = executeTool('camera_preset', { camera: 'cam2', preset: 4 }, deps);
      expect(result.success).toBe(true);
      expect(routeOSC).toHaveBeenCalledWith('/cam2/preset/recall/4', []);
    });
  });

  describe('unknown tool', () => {
    it('returns failure', () => {
      const deps = makeDeps();
      const result = executeTool('nonexistent', {}, deps);
      expect(result.success).toBe(false);
    });
  });
});
```

**Step 2: Run tests**

Run: `cd /Users/dave/projects/productionhub && npx vitest run test/brain-tools.test.ts`
Expected: All tests pass.

**Step 3: Commit**

```bash
git add test/brain-tools.test.ts
git commit -m "test(brain): add tool execution tests"
```

---

### Task 14: Smoke test — verify the backend compiles and starts

**Step 1: Check TypeScript compilation**

Run: `cd /Users/dave/projects/productionhub && npx tsc --noEmit`
Expected: No errors (or only pre-existing ones).

**Step 2: Fix any compilation errors**

Address whatever the compiler reports. Common issues:
- Missing import for `useEffect` in App.tsx
- Type mismatch in ModWebSocket constructor signature
- Missing `chatHandlerRef` import in useProductionHub

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix(brain): resolve TypeScript compilation errors"
```

---

### Task 15: End-to-end manual verification

**Step 1: Set API key**

Run: `export ANTHROPIC_API_KEY=<key>` (ask Dave for the key if not already in environment)

**Step 2: Start Production Hub**

Run: `cd /Users/dave/projects/productionhub && npm run dev`
Expected: See `[Brain] Loaded operations manual` in the log output.

**Step 3: Start the UI**

Run: `cd /Users/dave/projects/productionhub && npm run dev:ui`

**Step 4: Open the UI in browser, click the Brain button, type "what actions are available?"**

Expected: Booth Brain responds with a list of actions from the registry.

**Step 5: Type "house to half"**

Expected in confirm mode: See a proposed action card "House Lights: Half" with Confirm/Reject buttons. Click Confirm. Action executes.

**Step 6: Commit anything needed from manual testing**

```bash
git add -A
git commit -m "feat(brain): Booth Brain v1 complete"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Install SDK + config | `package.json`, `config.yml` |
| 2 | Brain types | `src/brain/types.ts` |
| 3 | System prompt builder | `src/brain/system-prompt.ts`, `docs/booth-brain-operations-manual.txt` |
| 4 | Tool definitions | `src/brain/tools.ts` |
| 5 | BrainService | `src/brain/brain-service.ts` |
| 6 | Wire into WS + Hub | `src/server/websocket.ts`, `src/hub.ts` |
| 7 | Config parser | `src/index.ts` or `src/config.ts` |
| 8 | UI types | `ui/src/types.ts` |
| 9 | useChat hook | `ui/src/hooks/useChat.ts` |
| 10 | Chat UI components | `ui/src/components/ChatDrawer.tsx`, `ChatMessage.tsx`, `ActionCard.tsx` |
| 11 | Wire into App | `ui/src/App.tsx`, `ui/src/hooks/useProductionHub.ts` |
| 12 | Barrel export | `src/brain/index.ts` |
| 13 | Tests | `test/brain-tools.test.ts` |
| 14 | Compilation check | Fix any TS errors |
| 15 | Manual smoke test | Verify end-to-end |
