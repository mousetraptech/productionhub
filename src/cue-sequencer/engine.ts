/**
 * Cue Sequencer Engine
 *
 * Manages a sequential cue list with GO/STOP/BACK controls.
 * Each cue contains direct OSC address/args actions that are
 * routed through the hub's OSC router.
 *
 * Supports:
 *   - Sequential GO (fire next cue)
 *   - Direct GO by cue ID
 *   - STOP (cancel all pending/active actions)
 *   - BACK (move playhead backward without firing)
 *   - Pre-wait and post-wait delays
 *   - Auto-follow chains
 *   - Delayed actions within a cue
 */

import { EventEmitter } from 'events';
import { Cue, CueAction, CueList, CueSequencerState } from './types';

export type OscRouter = (address: string, args: any[]) => void;

export class CueSequencer extends EventEmitter {
  private cueList: CueList | null = null;
  private playheadIndex = -1;
  private isRunning = false;
  private pendingTimers: ReturnType<typeof setTimeout>[] = [];
  private routeOSC: OscRouter;
  private verbose: boolean;

  constructor(routeOSC: OscRouter, verbose = false) {
    super();
    this.routeOSC = routeOSC;
    this.verbose = verbose;
  }

  /** Load a cue list */
  loadCueList(cueList: CueList): void {
    this.stop();
    this.cueList = cueList;
    this.playheadIndex = -1;
    this.isRunning = false;
    console.log(`[CueSeq] Loaded cue list "${cueList.name}" with ${cueList.cues.length} cues`);
    this.emitState();
  }

  /** Get the loaded cue list (for API/dashboard) */
  getCueList(): CueList | null {
    return this.cueList;
  }

  /** Get current sequencer state */
  getState(): CueSequencerState {
    return {
      loaded: this.cueList !== null,
      cueListName: this.cueList?.name ?? '',
      cueCount: this.cueList?.cues.length ?? 0,
      playheadIndex: this.playheadIndex,
      activeCueId: this.playheadIndex >= 0 && this.cueList
        ? this.cueList.cues[this.playheadIndex]?.id ?? null
        : null,
      isRunning: this.isRunning,
    };
  }

  /** Fire the next cue in sequence */
  go(): void {
    if (!this.cueList || this.cueList.cues.length === 0) {
      if (this.verbose) console.warn('[CueSeq] No cue list loaded');
      return;
    }

    const nextIndex = this.playheadIndex + 1;
    if (nextIndex >= this.cueList.cues.length) {
      if (this.verbose) console.log('[CueSeq] End of cue list');
      return;
    }

    this.fireCueAtIndex(nextIndex);
  }

  /** Fire a specific cue by ID */
  goCue(cueId: string): void {
    if (!this.cueList) return;

    const index = this.cueList.cues.findIndex(c => c.id === cueId);
    if (index === -1) {
      console.warn(`[CueSeq] Cue not found: ${cueId}`);
      return;
    }

    this.fireCueAtIndex(index);
  }

  /** Stop all running cue actions */
  stop(): void {
    for (const timer of this.pendingTimers) {
      clearTimeout(timer);
    }
    this.pendingTimers = [];
    this.isRunning = false;
    if (this.verbose) console.log('[CueSeq] Stopped all actions');
    this.emitState();
  }

  /** Move playhead back one position (does not fire) */
  back(): void {
    if (this.playheadIndex > 0) {
      this.playheadIndex--;
      if (this.verbose) {
        const cue = this.cueList?.cues[this.playheadIndex];
        console.log(`[CueSeq] Back to cue ${this.playheadIndex}: "${cue?.name}"`);
      }
    } else if (this.playheadIndex === 0) {
      this.playheadIndex = -1;
      if (this.verbose) console.log('[CueSeq] Back to start');
    }
    this.emitState();
  }

  /** Shutdown — stop everything and release */
  shutdown(): void {
    this.stop();
    this.cueList = null;
    this.playheadIndex = -1;
  }

  // --- Internal ---

  private fireCueAtIndex(index: number): void {
    if (!this.cueList) return;
    const cue = this.cueList.cues[index];
    if (!cue) return;

    // Cancel any pending actions from previous cue
    this.stop();

    this.playheadIndex = index;
    this.isRunning = true;

    console.log(`[CueSeq] GO cue ${index}: "${cue.name}" (${cue.actions.length} actions)`);

    const preWait = cue.preWaitMs ?? 0;

    if (preWait > 0) {
      const timer = setTimeout(() => {
        this.executeCueActions(cue);
      }, preWait);
      this.pendingTimers.push(timer);
    } else {
      this.executeCueActions(cue);
    }

    this.emit('cue-fired', index, cue);
    this.emitState();
  }

  private executeCueActions(cue: Cue): void {
    let maxDelay = 0;

    for (const action of cue.actions) {
      const actionDelay = action.delayMs ?? 0;
      maxDelay = Math.max(maxDelay, actionDelay);

      if (actionDelay > 0) {
        const timer = setTimeout(() => {
          this.sendAction(action);
        }, actionDelay);
        this.pendingTimers.push(timer);
      } else {
        this.sendAction(action);
      }
    }

    // Schedule cue completion
    const completionDelay = maxDelay + (cue.postWaitMs ?? 0);
    const completionTimer = setTimeout(() => {
      this.onCueComplete(cue);
    }, completionDelay);
    this.pendingTimers.push(completionTimer);
  }

  private sendAction(action: CueAction): void {
    const args = (action.args ?? []).map(a => {
      if (typeof a === 'number') {
        return Number.isInteger(a)
          ? { type: 'i', value: a }
          : { type: 'f', value: a };
      }
      return { type: 's', value: String(a) };
    });

    if (this.verbose) {
      console.log(`[CueSeq] -> ${action.address} [${action.args?.join(', ') ?? ''}]`);
    }

    this.routeOSC(action.address, args);
  }

  private onCueComplete(cue: Cue): void {
    this.isRunning = false;
    this.emit('cue-complete', this.playheadIndex, cue);

    if (this.verbose) {
      console.log(`[CueSeq] Cue complete: "${cue.name}"`);
    }

    this.emitState();

    // Auto-follow: fire next cue
    if (cue.autoFollow && this.cueList) {
      const nextIndex = this.playheadIndex + 1;
      if (nextIndex < this.cueList.cues.length) {
        if (this.verbose) console.log('[CueSeq] Auto-follow -> next cue');
        this.fireCueAtIndex(nextIndex);
      }
    }
  }

  private emitState(): void {
    this.emit('state', this.getState());
  }
}
