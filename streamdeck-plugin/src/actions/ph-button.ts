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
import { GridSlot, DeckButton } from '../lib/types';

function coordKey(row: number, col: number): string {
  return `${row}:${col}`;
}

const sdLog = streamDeck.logger.createScope("PHButton");
function log(msg: string): void {
  sdLog.info(msg);
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
      profileName: 'dave',
    };

    this.hub = new HubClient(config);

    this.hub.on('profile-loaded', () => {
      log(`Profile loaded — ${this.hub.grid.length} slots, ${this.actionMap.size} keys registered`);
      this.renderAll();
    });
    this.hub.on('actions-loaded', () => {
      this.buildCommandLookup();
      log(`Actions loaded — ${this.actionCommands.size} commands mapped`);
      this.renderAll();
    });
    this.hub.on('device-state', () => this.renderAll());
    this.hub.on('connected', () => {
      log('Hub connected, rendering all keys');
      this.renderAll();
    });
    this.hub.on('disconnected', () => {
      log('Hub disconnected');
      this.renderAllDisconnected();
    });

    this.hub.start();
  }

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const coords = (ev.payload as any).coordinates;
    if (!coords) {
      log('onWillAppear: no coordinates');
      return;
    }
    const key = coordKey(coords.row, coords.column);
    log(`onWillAppear: key ${key}`);
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

    // Compute toggle state and fire effective actions
    const state = this.getButtonState(button);
    const isToggled = !!(button.toggle && state.active);
    const effectiveButton = isToggled
      ? { ...button, actions: button.toggle!.activeActions }
      : button;
    this.hub.fire(effectiveButton);

    // Flash animation
    const key = coordKey(coords.row, coords.column);
    const flashSvg = this.toDataUrl(renderButton(button, state, true));
    await ev.action.setImage(flashSvg);

    setTimeout(() => {
      const action = this.actionMap.get(key);
      if (action) this.renderKey(key, action);
    }, 200);
  }

  private getButton(row: number, col: number): DeckButton | null {
    const slot = this.hub.grid.find(s => s.row === row && s.col === col);
    return slot?.button ?? null;
  }

  private getButtonState(button: DeckButton): ButtonState {
    return getDeckButtonState(
      button,
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
      log(`renderKey ${key}: disconnected`);
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

    log(`renderKey ${key}: ${button ? button.label : 'empty'} (level=${state.level}, active=${state.active}, live=${state.live}) svgLen=${svg.length}`);
    action.setImage(svg);
  }

  private toDataUrl(svg: string): string {
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  }
}
