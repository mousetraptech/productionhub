import streamDeck, {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
  type KeyAction,
} from "@elgato/streamdeck";
import { HubClient, HubClientConfig } from '../lib/hub-client';
import { getDeckButtonState, ActionCommandRef, ButtonState } from '../lib/state-matcher';
import { renderButton, renderDisconnected } from '../lib/button-renderer';

interface GridSlot {
  row: number;
  col: number;
  button: {
    id: string;
    label: string;
    icon: string;
    color: string;
    actions: Array<{ actionId: string; osc?: { address: string; args: any[]; label: string } }>;
    mode: 'parallel' | 'series';
    seriesGap: number;
  };
}

function coordKey(row: number, col: number): string {
  return `${row}:${col}`;
}

@action({ UUID: "com.productionhub.deck.button" })
export class PHButton extends SingletonAction {
  private hub: HubClient;
  private actionMap = new Map<string, KeyAction>();
  private actionCommands = new Map<string, ActionCommandRef[]>();
  private lastRendered = new Map<string, string>();

  constructor() {
    super();

    const config: HubClientConfig = {
      hubHost: 'localhost',
      modWsPort: 3001,
      dashboardPort: 8081,
      profileName: 'main',
    };

    this.hub = new HubClient(config);

    this.hub.on('profile-loaded', () => this.renderAll());
    this.hub.on('actions-loaded', () => {
      this.buildCommandLookup();
      this.renderAll();
    });
    this.hub.on('device-state', () => this.renderAll());
    this.hub.on('connected', () => this.renderAll());
    this.hub.on('disconnected', () => this.renderAllDisconnected());

    this.hub.start();
  }

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const coords = (ev.payload as any).coordinates;
    if (!coords) return;
    const key = coordKey(coords.row, coords.column);
    if (ev.action.isKey()) {
      this.actionMap.set(key, ev.action);
      this.renderKey(key, ev.action);
    }
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    const coords = (ev.payload as any).coordinates;
    if (!coords) return;
    const key = coordKey(coords.row, coords.column);
    this.actionMap.delete(key);
    this.lastRendered.delete(key);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const coords = ev.action.coordinates;
    if (!coords) return;

    const button = this.getButton(coords.row, coords.column);
    if (!button) return;

    // Fire
    this.hub.fire(button);

    // Flash animation
    const key = coordKey(coords.row, coords.column);
    const state = this.getButtonState(button);
    const flashSvg = this.toDataUrl(renderButton(button, state, true));
    await ev.action.setImage(flashSvg);

    setTimeout(() => {
      const action = this.actionMap.get(key);
      if (action) this.renderKey(key, action);
    }, 200);
  }

  private getButton(row: number, col: number): GridSlot['button'] | null {
    const slot = this.hub.grid.find(s => s.row === row && s.col === col);
    return slot?.button ?? null;
  }

  private getButtonState(button: GridSlot['button']): ButtonState {
    return getDeckButtonState(
      button as any,
      this.hub.deviceStates as any,
      this.actionCommands,
    );
  }

  private buildCommandLookup(): void {
    this.actionCommands.clear();
    for (const cat of this.hub.categories) {
      for (const item of cat.items) {
        if (item.commands?.length) {
          this.actionCommands.set(item.id, item.commands);
        }
      }
    }
  }

  private renderAll(): void {
    for (const [key, action] of this.actionMap) {
      this.renderKey(key, action);
    }
  }

  private renderAllDisconnected(): void {
    const svg = this.toDataUrl(renderDisconnected());
    for (const [key, action] of this.actionMap) {
      action.setImage(svg);
      this.lastRendered.set(key, svg);
    }
  }

  private renderKey(key: string, action: KeyAction): void {
    if (!this.hub.connected) {
      const svg = this.toDataUrl(renderDisconnected());
      action.setImage(svg);
      this.lastRendered.set(key, svg);
      return;
    }

    const [row, col] = key.split(':').map(Number);
    const button = this.getButton(row, col);
    const state = button
      ? this.getButtonState(button)
      : { level: null, active: false, live: false };
    const svg = this.toDataUrl(renderButton(button, state, false));

    // Skip if unchanged
    if (this.lastRendered.get(key) === svg) return;
    this.lastRendered.set(key, svg);

    action.setImage(svg);
  }

  private toDataUrl(svg: string): string {
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
}
