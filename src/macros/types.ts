/**
 * Macro / Group Command Types
 *
 * Macros are config-defined groups of OSC commands triggered
 * by a single OSC address. They support:
 *   - Multiple actions per macro
 *   - Per-action delay offsets
 *   - Pass-through arguments ($$1, $$2 placeholders)
 *   - Nested macros (with cycle detection)
 */

/** A single action within a macro */
export interface MacroAction {
  address: string;            // OSC address to send
  args?: (number | string)[]; // static args (may contain $$N placeholders)
  delayMs?: number;           // offset from macro trigger time
}

/** A macro definition from config */
export interface MacroDef {
  address: string;            // trigger address, e.g. "/hub/macro/blackout"
  name: string;               // human-readable name
  actions: MacroAction[];     // list of actions to execute
}

/** Config section for macros */
export interface MacroConfig {
  macros: MacroDef[];
}
