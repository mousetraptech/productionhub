/**
 * Cue Engine Types
 *
 * Runtime show state managed by the cue engine.
 * The UI receives ShowState over WebSocket.
 */

export interface InlineOSC {
  address: string;        // e.g. "/avantis/ch/3/mix/fader"
  args: any[];            // e.g. [0.8]
  label: string;          // e.g. "Fader 3 → 80%"
}

export interface CueAction {
  actionId: string;       // references actions.yml, or synthetic id for inline commands
  delay?: number;         // ms offset within this cue
  osc?: InlineOSC;        // present for inline OSC commands (bypasses action registry)
}

export interface Cue {
  id: string;
  name: string;
  actions: CueAction[];
  autoFollow?: number;    // ms before auto-firing next cue
}

export interface ShowState {
  name: string;
  cues: Cue[];
  activeCueIndex: number | null;
  firedCues: number[];    // indices of fired cues (serializable, unlike Set)
}
