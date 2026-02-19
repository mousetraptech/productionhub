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
