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
