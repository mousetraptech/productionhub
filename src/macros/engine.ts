/**
 * Macro Engine
 *
 * Resolves and executes macro definitions triggered by OSC addresses.
 * Supports:
 *   - Direct OSC actions with optional delays
 *   - Pass-through arguments ($$1, $$2, etc. in args)
 *   - Nested macros (one macro can trigger another)
 *   - Cycle detection to prevent infinite loops
 *   - Built-in /hub/panic system macro
 */

import { EventEmitter } from 'events';
import { MacroDef, MacroAction, MacroConfig } from './types';

export type OscSender = (address: string, args: any[]) => void;

export class MacroEngine extends EventEmitter {
  private macros: Map<string, MacroDef> = new Map();
  private pendingTimers: ReturnType<typeof setTimeout>[] = [];
  private sendOSC: OscSender;
  private verbose: boolean;

  constructor(sendOSC: OscSender, verbose = false) {
    super();
    this.sendOSC = sendOSC;
    this.verbose = verbose;
  }

  /** Load macros from config */
  loadMacros(config: MacroConfig): void {
    this.macros.clear();
    for (const macro of config.macros) {
      const addr = macro.address.toLowerCase();
      if (this.macros.has(addr)) {
        console.warn(`[Macro] Duplicate macro address: ${macro.address}`);
      }
      this.macros.set(addr, macro);
    }
    console.log(`[Macro] Loaded ${this.macros.size} macro(s)`);
  }

  /** Check if an address matches a registered macro */
  hasMacro(address: string): boolean {
    return this.macros.has(address.toLowerCase());
  }

  /** Get all registered macros */
  getMacros(): MacroDef[] {
    return Array.from(this.macros.values());
  }

  /**
   * Execute a macro by address.
   * @param address The trigger address
   * @param args Pass-through arguments from the trigger
   * @returns true if a macro was found and executed
   */
  execute(address: string, args: any[]): boolean {
    const addr = address.toLowerCase();
    const macro = this.macros.get(addr);
    if (!macro) return false;

    if (this.verbose) {
      console.log(`[Macro] Executing "${macro.name}" (${macro.actions.length} actions)`);
    }

    this.executeMacro(macro, args, new Set([addr]));
    this.emit('macro-fired', macro.address, macro.name);
    return true;
  }

  /** Stop all pending macro actions */
  stop(): void {
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers = [];
  }

  /** Shutdown */
  shutdown(): void {
    this.stop();
    this.macros.clear();
  }

  // --- Internal ---

  private executeMacro(macro: MacroDef, triggerArgs: any[], visited: Set<string>): void {
    for (const action of macro.actions) {
      const resolvedArgs = this.resolveArgs(action.args ?? [], triggerArgs);
      const delay = action.delayMs ?? 0;

      if (delay > 0) {
        const timer = setTimeout(() => {
          this.dispatchAction(action.address, resolvedArgs, triggerArgs, visited);
        }, delay);
        this.pendingTimers.push(timer);
      } else {
        this.dispatchAction(action.address, resolvedArgs, triggerArgs, visited);
      }
    }
  }

  private dispatchAction(address: string, args: any[], triggerArgs: any[], visited: Set<string>): void {
    const addr = address.toLowerCase();

    // Check if the action itself triggers another macro
    const nestedMacro = this.macros.get(addr);
    if (nestedMacro) {
      // Cycle detection
      if (visited.has(addr)) {
        console.warn(`[Macro] Cycle detected: ${address} already in chain [${Array.from(visited).join(' -> ')}]`);
        return;
      }
      const newVisited = new Set(visited);
      newVisited.add(addr);

      if (this.verbose) {
        console.log(`[Macro] Nested macro: "${nestedMacro.name}"`);
      }

      this.executeMacro(nestedMacro, triggerArgs, newVisited);
      return;
    }

    // Send the OSC command
    const oscArgs = this.toOscArgs(args);
    if (this.verbose) {
      console.log(`[Macro] -> ${address} [${args.join(', ')}]`);
    }
    this.sendOSC(address, oscArgs);
  }

  /**
   * Resolve pass-through arguments.
   * $$1, $$2, etc. in static args are replaced with values from triggerArgs.
   */
  private resolveArgs(staticArgs: (number | string)[], triggerArgs: any[]): (number | string)[] {
    return staticArgs.map(arg => {
      if (typeof arg === 'string' && arg.startsWith('$$')) {
        const idx = parseInt(arg.slice(2), 10) - 1; // $$1 = index 0
        if (idx >= 0 && idx < triggerArgs.length) {
          const val = triggerArgs[idx];
          // Extract value from OSC arg objects
          return typeof val === 'object' && val !== null && val.value !== undefined
            ? val.value
            : val;
        }
        return arg; // leave placeholder if no matching arg
      }
      return arg;
    });
  }

  /** Convert args to OSC format */
  private toOscArgs(args: (number | string)[]): any[] {
    return args.map(a => {
      if (typeof a === 'number') {
        return Number.isInteger(a)
          ? { type: 'i', value: a }
          : { type: 'f', value: a };
      }
      return { type: 's', value: String(a) };
    });
  }
}
