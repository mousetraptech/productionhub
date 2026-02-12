/**
 * Cue Engine
 *
 * Manages runtime show state: loading templates, firing cues,
 * and editing the cue list. Emits events for state changes so
 * the WebSocket server can push updates to the UI.
 */

import { EventEmitter } from 'events';
import { Cue, CueAction, ShowState } from './types';
import { ActionRegistry } from '../actions/registry';
import { ActionCommand } from '../actions/types';

let cueCounter = 0;

function generateCueId(): string {
  cueCounter++;
  return `cue-${cueCounter}-${Date.now()}`;
}

export class CueEngine extends EventEmitter {
  private state: ShowState;
  private actionRegistry: ActionRegistry;
  private routeCommand: (prefix: string, address: string, args: any[]) => void;
  private autoFollowTimer?: ReturnType<typeof setTimeout>;

  constructor(
    actionRegistry: ActionRegistry,
    routeCommand: (prefix: string, address: string, args: any[]) => void,
  ) {
    super();
    this.actionRegistry = actionRegistry;
    this.routeCommand = routeCommand;
    this.state = {
      name: '',
      cues: [],
      activeCueIndex: null,
      firedCues: [],
    };
  }

  /** Get current show state (for UI sync) */
  getState(): ShowState {
    return { ...this.state, firedCues: [...this.state.firedCues] };
  }

  /** Load a cue list from a template's cue definitions */
  loadTemplate(name: string, cues: Array<{ name: string; actions: string[] }>): void {
    this.clearAutoFollow();
    this.state = {
      name,
      cues: cues.map(c => ({
        id: generateCueId(),
        name: c.name,
        actions: c.actions.map(actionId => ({ actionId })),
      })),
      activeCueIndex: null,
      firedCues: [],
    };
    this.emitState();
    console.log(`[CueEngine] Loaded template "${name}" with ${this.state.cues.length} cues`);
  }

  /** Load from a raw ShowState (for loading saved shows) */
  loadState(state: ShowState): void {
    this.clearAutoFollow();
    this.state = state;
    this.emitState();
  }

  /** Fire the next cue */
  go(): void {
    this.clearAutoFollow();
    const { cues, activeCueIndex } = this.state;
    if (cues.length === 0) return;

    let nextIndex: number;
    if (activeCueIndex === null) {
      nextIndex = 0;
    } else if (activeCueIndex < cues.length - 1) {
      nextIndex = activeCueIndex + 1;
    } else {
      return; // show complete
    }

    // Mark previous cue as fired
    if (activeCueIndex !== null && !this.state.firedCues.includes(activeCueIndex)) {
      this.state.firedCues.push(activeCueIndex);
    }

    this.state.activeCueIndex = nextIndex;
    const cue = cues[nextIndex];

    // Execute all actions in this cue
    this.executeCue(cue);

    this.emit('cue-fired', nextIndex, cue);
    this.emitState();

    // Set up auto-follow if configured
    if (cue.autoFollow && cue.autoFollow > 0 && nextIndex < cues.length - 1) {
      this.autoFollowTimer = setTimeout(() => {
        this.go();
      }, cue.autoFollow);
    }
  }

  /** Reset to standby (no active cue) */
  reset(): void {
    this.clearAutoFollow();
    this.state.activeCueIndex = null;
    this.state.firedCues = [];
    this.emitState();
  }

  /** Add a cue at a specific index (or end) */
  addCue(cue: Partial<Cue>, atIndex?: number): void {
    const newCue: Cue = {
      id: cue.id ?? generateCueId(),
      name: cue.name ?? '',
      actions: cue.actions ?? [],
      autoFollow: cue.autoFollow,
    };

    if (atIndex !== undefined && atIndex >= 0 && atIndex <= this.state.cues.length) {
      this.state.cues.splice(atIndex, 0, newCue);
      // Adjust active index if needed
      if (this.state.activeCueIndex !== null && atIndex <= this.state.activeCueIndex) {
        this.state.activeCueIndex++;
      }
    } else {
      this.state.cues.push(newCue);
    }

    this.emitState();
  }

  /** Remove a cue by ID */
  removeCue(cueId: string): void {
    const idx = this.state.cues.findIndex(c => c.id === cueId);
    if (idx === -1) return;

    this.state.cues.splice(idx, 1);

    // Adjust active index
    if (this.state.activeCueIndex !== null) {
      if (idx === this.state.activeCueIndex) {
        this.state.activeCueIndex = null;
      } else if (idx < this.state.activeCueIndex) {
        this.state.activeCueIndex--;
      }
    }

    // Adjust fired cues
    this.state.firedCues = this.state.firedCues
      .filter(i => i !== idx)
      .map(i => i > idx ? i - 1 : i);

    this.emitState();
  }

  /** Move a cue up (-1) or down (+1) */
  moveCue(cueId: string, direction: -1 | 1): void {
    const idx = this.state.cues.findIndex(c => c.id === cueId);
    if (idx === -1) return;

    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= this.state.cues.length) return;

    const cues = this.state.cues;
    [cues[idx], cues[newIdx]] = [cues[newIdx], cues[idx]];

    // Adjust active cue index to follow the swap
    if (this.state.activeCueIndex === idx) {
      this.state.activeCueIndex = newIdx;
    } else if (this.state.activeCueIndex === newIdx) {
      this.state.activeCueIndex = idx;
    }

    this.emitState();
  }

  /** Update a cue's properties */
  updateCue(cueId: string, changes: Partial<Pick<Cue, 'name' | 'actions' | 'autoFollow'>>): void {
    const cue = this.state.cues.find(c => c.id === cueId);
    if (!cue) return;

    if (changes.name !== undefined) cue.name = changes.name;
    if (changes.actions !== undefined) cue.actions = changes.actions;
    if (changes.autoFollow !== undefined) cue.autoFollow = changes.autoFollow;

    this.emitState();
  }

  /** Add an action to a cue */
  addActionToCue(cueId: string, actionId: string, delay?: number): void {
    const cue = this.state.cues.find(c => c.id === cueId);
    if (!cue) return;

    cue.actions.push({ actionId, delay });
    this.emitState();
  }

  /** Remove an action from a cue by index */
  removeActionFromCue(cueId: string, actionIndex: number): void {
    const cue = this.state.cues.find(c => c.id === cueId);
    if (!cue) return;
    if (actionIndex < 0 || actionIndex >= cue.actions.length) return;

    cue.actions.splice(actionIndex, 1);
    this.emitState();
  }

  /** Execute a cue: resolve all actions to OSC commands and send them */
  private executeCue(cue: Cue): void {
    console.log(`[CueEngine] Firing cue: "${cue.name}"`);

    for (const cueAction of cue.actions) {
      const action = this.actionRegistry.getAction(cueAction.actionId);
      if (!action) {
        console.warn(`[CueEngine] Unknown action: ${cueAction.actionId}`);
        continue;
      }

      const delay = cueAction.delay ?? 0;
      if (delay > 0) {
        setTimeout(() => this.sendCommands(action.commands), delay);
      } else {
        this.sendCommands(action.commands);
      }
    }
  }

  /** Send a list of OSC commands through the hub router */
  private sendCommands(commands: ActionCommand[]): void {
    for (const cmd of commands) {
      // Resolve the prefix: either explicit prefix override or derive from device type
      const prefix = cmd.prefix ? `/${cmd.prefix}` : this.resolvePrefix(cmd.device);
      if (!prefix) {
        console.warn(`[CueEngine] Cannot resolve prefix for device: ${cmd.device}`);
        continue;
      }
      this.routeCommand(prefix, cmd.address, cmd.args ?? []);
    }
  }

  /** Map device type to its configured prefix */
  private resolvePrefix(device: string): string | null {
    // Device type to default prefix mapping
    // These match the convention in config.yml
    const defaults: Record<string, string> = {
      avantis: '/avantis',
      chamsys: '/lights',
      obs: '/obs',
      visca: '/cam1',
      touchdesigner: '/td',
    };
    return defaults[device] ?? null;
  }

  private emitState(): void {
    this.emit('state', this.getState());
  }

  private clearAutoFollow(): void {
    if (this.autoFollowTimer) {
      clearTimeout(this.autoFollowTimer);
      this.autoFollowTimer = undefined;
    }
  }
}
