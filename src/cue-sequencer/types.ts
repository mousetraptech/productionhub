/**
 * Cue Sequencer Types
 *
 * YAML-driven cue system with direct OSC addresses.
 * Independent of the MOD action registry — cues reference
 * OSC addresses directly, not action IDs.
 */

/** A single OSC action within a cue */
export interface CueAction {
  address: string;           // full OSC address, e.g. "/avantis/dca/1/fader"
  args: (number | string)[]; // OSC arguments
  delayMs?: number;          // offset from cue start
}

/** A cue in the sequence */
export interface Cue {
  id: string;
  name: string;
  actions: CueAction[];
  preWaitMs?: number;        // delay before cue fires
  postWaitMs?: number;       // delay after cue completes before next cue can fire
  autoFollow?: boolean;      // automatically fire next cue after this one completes
}

/** A named cue list */
export interface CueList {
  name: string;
  cues: Cue[];
}

/** Runtime state of the cue sequencer */
export interface CueSequencerState {
  loaded: boolean;
  cueListName: string;
  cueCount: number;
  playheadIndex: number;     // -1 = not started
  activeCueId: string | null;
  isRunning: boolean;        // true if a cue is currently executing
}
