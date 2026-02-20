export interface InlineOSC {
  address: string;
  args: any[];
  label: string;
}

export interface CueAction {
  actionId: string;
  delay?: number;
  osc?: InlineOSC;
}

export interface Cue {
  id: string;
  name: string;
  actions: CueAction[];
  autoFollow?: number;
}

export interface ShowState {
  name: string;
  cues: Cue[];
  activeCueIndex: number | null;
  firedCues: number[];
}

export interface ActionItem {
  id: string;
  label: string;
  desc: string;
}

export interface ActionCategory {
  category: string;
  icon: string;
  color: string;
  items: ActionItem[];
}

export interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
  cues: Array<{ name: string; actions: string[] }>;
}

// Chat / Brain types
export interface ProposedAction {
  tool: string;
  args: Record<string, any>;
  label: string;
}

export type BrainMode = 'confirm' | 'trusted';

// Deck types
export interface DeckAction {
  actionId: string;
  osc?: InlineOSC;
}

export interface DeckButton {
  id: string;
  label: string;
  icon: string;
  color: string;
  actions: DeckAction[];
  mode: 'parallel' | 'series';
  seriesGap: number;
}

export interface GridSlot {
  row: number;
  col: number;
  button: DeckButton;
}

// WebSocket message types
export type ServerMessage =
  | { type: 'state'; show: ShowState }
  | { type: 'actions'; categories: ActionCategory[] }
  | { type: 'templates'; templates: Template[] }
  | { type: 'cue-fired'; cueIndex: number; cue: Cue }
  | { type: 'chat-response'; requestId: string; text: string; actions?: ProposedAction[] }
  | { type: 'chat-executed'; requestId: string; actions: ProposedAction[]; results: string[] }
  | { type: 'chat-error'; requestId: string; error: string }
  | { type: 'chat-mode'; mode: BrainMode }
  | { type: 'deck-profiles'; profiles: string[] }
  | { type: 'deck-state'; name: string; grid: GridSlot[] }
  | { type: 'deck-saved'; name: string }
  | { type: 'deck-fired'; buttonId: string };

export type ClientMessage =
  | { type: 'get-actions' }
  | { type: 'get-templates' }
  | { type: 'load-template'; templateId: string }
  | { type: 'go' }
  | { type: 'standby' }
  | { type: 'reset' }
  | { type: 'add-cue'; cue?: Partial<Cue>; atIndex?: number }
  | { type: 'remove-cue'; cueId: string }
  | { type: 'move-cue'; cueId: string; direction: -1 | 1 }
  | { type: 'rename-cue'; cueId: string; name: string }
  | { type: 'add-action-to-cue'; cueId: string; actionId: string; osc?: InlineOSC; delay?: number }
  | { type: 'remove-action-from-cue'; cueId: string; actionIndex: number }
  | { type: 'save-show'; name: string }
  | { type: 'load-show'; name: string }
  | { type: 'osc'; address: string; args: any[] }
  | { type: 'chat-message'; requestId: string; text: string }
  | { type: 'chat-confirm'; requestId: string }
  | { type: 'chat-reject'; requestId: string }
  | { type: 'chat-set-mode'; mode: BrainMode }
  | { type: 'deck-list' }
  | { type: 'deck-load'; name: string }
  | { type: 'deck-save'; name: string; grid: GridSlot[] }
  | { type: 'deck-delete'; name: string }
  | { type: 'deck-fire'; buttonId: string; actions: DeckAction[]; mode: 'parallel' | 'series'; seriesGap: number };
