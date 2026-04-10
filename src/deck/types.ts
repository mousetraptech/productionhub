/**
 * Virtual StreamDeck Types
 *
 * Shared types for deck profiles, buttons, and WS messages.
 */

export interface DeckAction {
  actionId: string;
  osc?: { address: string; args: any[]; label: string };
  wait?: number; // delay in milliseconds
}

export interface DeckButton {
  id: string;
  label: string;
  icon: string;
  color: string;
  actions: DeckAction[];
  mode: 'parallel' | 'series';
  seriesGap: number;
  toggle?: {
    activeLabel: string;
    activeIcon: string;
    activeColor: string;
    activeActions: DeckAction[];
    pulse?: boolean;
  };
  prompt?: { message: string; default?: string };
  imperative?: boolean;
  group?: GridSlot[];
  span?: { cols: number; rows: number };
  vivid?: boolean;
  longPressActions?: DeckAction[];
  longPressMs?: number; // hold threshold, default 500
}

export interface GridSlot {
  row: number;
  col: number;
  button: DeckButton;
}

export interface DeckProfile {
  name: string;
  grid: GridSlot[];
}
