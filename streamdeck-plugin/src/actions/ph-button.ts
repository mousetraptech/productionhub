import streamDeck, {
  action,
  KeyDownEvent,
  KeyUpEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
  type KeyAction,
} from "@elgato/streamdeck";
import { HubClient, HubClientConfig } from '../lib/hub-client';
import { getDeckButtonState, ActionCommandRef, ButtonState } from '../lib/state-matcher';
import { renderButton, renderSpanTile, renderDisconnected } from '../lib/button-renderer';
import { DeckButton } from '../lib/types';

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
  private pulsePhase = false;
  private pulseTimer: ReturnType<typeof setInterval> | null = null;
  private spanFireDebounce = new Map<string, number>(); // buttonId -> timestamp

  // Long-press tracking, keyed by button ID (so spanned buttons share state)
  private holdTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private longPressFired = new Set<string>();

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
    this.hub.on('show-context', () => this.renderAll());
    this.hub.on('group-changed', () => this.renderAll());
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

    // Back button at (3, 0) when inside a group — fires on press, no long-press
    if (this.hub.inGroup && coords.row === 3 && coords.column === 0) {
      this.hub.groupBack();
      return;
    }

    const button = this.getButton(coords.row, coords.column);
    if (!button) return;

    // Group folder button — enter on press
    if (button.group) {
      this.hub.enterGroup(button.id);
      return;
    }

    // Debounce multi-key press on spanned buttons (50ms window)
    if (button.span && (button.span.cols > 1 || button.span.rows > 1)) {
      const now = Date.now();
      const lastFire = this.spanFireDebounce.get(button.id) ?? 0;
      if (now - lastFire < 50) return;
      this.spanFireDebounce.set(button.id, now);
    }

    // If button has long-press actions, schedule the timer.
    // The actual fire happens on KeyUp (or when the timer fires for long-press).
    if (button.longPressActions && button.longPressActions.length > 0) {
      this.longPressFired.delete(button.id);
      const threshold = button.longPressMs ?? 500;
      const timer = setTimeout(() => {
        this.holdTimers.delete(button.id);
        this.longPressFired.add(button.id);
        // Fire long-press actions
        const lpButton: DeckButton = { ...button, actions: button.longPressActions!, prompt: undefined };
        this.hub.fire(lpButton);
        this.flashButton(button, coords);
      }, threshold);
      this.holdTimers.set(button.id, timer);
      return;
    }

    // No long-press configured — fire immediately on press
    this.firePress(button, coords);
  }

  override async onKeyUp(ev: KeyUpEvent): Promise<void> {
    const coords = ev.action.coordinates;
    if (!coords) return;

    const button = this.getButton(coords.row, coords.column);
    if (!button) return;
    if (!button.longPressActions || button.longPressActions.length === 0) return;

    // Cancel pending hold timer
    const timer = this.holdTimers.get(button.id);
    if (timer) {
      clearTimeout(timer);
      this.holdTimers.delete(button.id);
    }

    // If long-press already fired, just clear the flag and stop
    if (this.longPressFired.has(button.id)) {
      this.longPressFired.delete(button.id);
      return;
    }

    // Released before threshold — fire normal press
    this.firePress(button, coords);
  }

  /** Fire the button's normal (non-long-press) action and flash. */
  private firePress(button: DeckButton, coords: { row: number; column: number }): void {
    const state = this.getButtonState(button);
    const isToggled = !!(button.toggle && state.active);
    const effectiveButton = isToggled
      ? { ...button, actions: button.toggle!.activeActions, prompt: undefined }
      : button;
    this.hub.fire(effectiveButton);
    this.flashButton(button, coords);
  }

  /** Flash the button (and all tiles if spanned) for visual feedback. */
  private flashButton(button: DeckButton, coords: { row: number; column: number }): void {
    const state = this.getButtonState(button);
    if (button.span && (button.span.cols > 1 || button.span.rows > 1)) {
      const anchor = this.getAnchorSlot(button.id);
      if (anchor) {
        for (let dr = 0; dr < button.span.rows; dr++) {
          for (let dc = 0; dc < button.span.cols; dc++) {
            const tileKey = coordKey(anchor.row + dr, anchor.col + dc);
            const tileAction = this.actionMap.get(tileKey);
            if (tileAction) {
              const flashSvg = this.toDataUrl(renderSpanTile(button, state, true, dr, dc, button.span.cols, button.span.rows));
              tileAction.setImage(flashSvg);
            }
          }
        }
        setTimeout(() => {
          for (let dr = 0; dr < button.span!.rows; dr++) {
            for (let dc = 0; dc < button.span!.cols; dc++) {
              const tileKey = coordKey(anchor.row + dr, anchor.col + dc);
              const tileAction = this.actionMap.get(tileKey);
              if (tileAction) this.renderKey(tileKey, tileAction);
            }
          }
        }, 200);
      }
      return;
    }
    const key = coordKey(coords.row, coords.column);
    const tileAction = this.actionMap.get(key);
    if (tileAction) {
      const flashSvg = this.toDataUrl(renderButton(button, state, true));
      tileAction.setImage(flashSvg);
      setTimeout(() => {
        const action = this.actionMap.get(key);
        if (action) this.renderKey(key, action);
      }, 200);
    }
  }

  private getButton(row: number, col: number): DeckButton | null {
    const grid = this.hub.displayGrid;
    // Exact match first
    const slot = grid.find(s => s.row === row && s.col === col);
    if (slot) return slot.button;
    // Check if (row, col) is covered by a spanned button
    for (const s of grid) {
      if (!s.button.span) continue;
      const { cols, rows } = s.button.span;
      if (row >= s.row && row < s.row + rows && col >= s.col && col < s.col + cols) {
        return s.button;
      }
    }
    return null;
  }

  /** Find the anchor GridSlot (top-left) for a spanned button by ID */
  private getAnchorSlot(buttonId: string): { row: number; col: number } | null {
    const grid = this.hub.displayGrid;
    const slot = grid.find(s => s.button.id === buttonId);
    return slot ? { row: slot.row, col: slot.col } : null;
  }

  private getButtonState(button: DeckButton): ButtonState {
    return getDeckButtonState(
      button,
      this.hub.deviceStates as any,
      this.actionCommands,
      { showActive: this.hub.showActive },
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
    let hasPulsing = false;
    for (const [key, action] of this.actionMap) {
      this.renderKey(key, action);
      if (!hasPulsing) {
        const [row, col] = key.split(':').map(Number);
        const button = this.getButton(row, col);
        if (button?.toggle?.pulse) {
          const state = this.getButtonState(button);
          if (state.active) hasPulsing = true;
        }
      }
    }
    this.managePulseTimer(hasPulsing);
  }

  private managePulseTimer(needed: boolean): void {
    if (needed && !this.pulseTimer) {
      this.pulseTimer = setInterval(() => {
        this.pulsePhase = !this.pulsePhase;
        this.renderPulsingButtons();
      }, 800);
    } else if (!needed && this.pulseTimer) {
      clearInterval(this.pulseTimer);
      this.pulseTimer = null;
      this.pulsePhase = false;
    }
  }

  private renderPulsingButtons(): void {
    for (const [key, action] of this.actionMap) {
      const [row, col] = key.split(':').map(Number);
      const button = this.getButton(row, col);
      if (!button?.toggle?.pulse) continue;
      const state = this.getButtonState(button);
      if (state.active) {
        const svg = this.toDataUrl(renderButton(button, state, false, this.pulsePhase));
        this.lastRendered.set(key, svg);
        action.setImage(svg);
      }
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

    // Render back button at (3, 0) when inside a group
    if (this.hub.inGroup && row === 3 && col === 0) {
      const backSvg = this.toDataUrl(renderButton(
        { id: 'back', label: '\u25C0 Back', icon: '', color: '#4444aa', actions: [], mode: 'parallel', seriesGap: 0 },
        { level: null, active: false, live: false }, false,
      ));
      if (this.lastRendered.get(key) !== backSvg) {
        this.lastRendered.set(key, backSvg);
        action.setImage(backSvg);
      }
      return;
    }

    const button = this.getButton(row, col);

    // Render group folder button with folder icon
    if (button?.group) {
      const folderSvg = this.toDataUrl(renderButton(
        { ...button, label: `\uD83D\uDCC1 ${button.label}` },
        { level: null, active: false, live: false }, false,
      ));
      if (this.lastRendered.get(key) !== folderSvg) {
        this.lastRendered.set(key, folderSvg);
        action.setImage(folderSvg);
      }
      return;
    }

    const state = button
      ? this.getButtonState(button)
      : { level: null, active: false, live: false };

    // Spanned button — render the correct tile slice
    let svg: string;
    if (button?.span && (button.span.cols > 1 || button.span.rows > 1)) {
      const anchor = this.getAnchorSlot(button.id);
      const tileCol = anchor ? col - anchor.col : 0;
      const tileRow = anchor ? row - anchor.row : 0;
      svg = this.toDataUrl(renderSpanTile(button, state, false, tileRow, tileCol, button.span.cols, button.span.rows));
    } else {
      svg = this.toDataUrl(renderButton(button, state, false));
    }

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
