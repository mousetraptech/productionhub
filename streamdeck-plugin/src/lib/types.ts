export interface DeckAction {
  actionId: string;
  osc?: { address: string; args: any[]; label: string };
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

export interface ActionCategory {
  name: string;
  items: Array<{
    id: string;
    label: string;
    desc: string;
    commands: Array<{ device: string; prefix?: string; address: string }>;
  }>;
}

export interface DeviceStates {
  avantis: any;
  obs: any;
  chamsys: any;
  visca: any;
  touchdesigner: any;
}
