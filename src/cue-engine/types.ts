/**
 * Cue Engine Types
 *
 * Runtime show state managed by the cue engine.
 * The UI receives ShowState over WebSocket.
 */

export interface CueAction {
  actionId: string;       // references actions.yml
  delay?: number;         // ms offset within this cue
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
