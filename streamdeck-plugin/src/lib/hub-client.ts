import { EventEmitter } from 'events';

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

interface ActionCategory {
  name: string;
  items: Array<{
    id: string;
    label: string;
    desc: string;
    commands: Array<{ device: string; prefix?: string; address: string }>;
  }>;
}

export interface HubClientConfig {
  hubHost: string;
  modWsPort: number;
  dashboardPort: number;
  profileName: string;
}

const RECONNECT_DELAY = 2000;

/**
 * Manages WebSocket connections to the Production Hub.
 *
 * Events:
 *   profile-loaded(grid: GridSlot[])
 *   actions-loaded(categories: ActionCategory[])
 *   device-state(deviceType: string, state: any)
 *   connected()
 *   disconnected()
 *   fired(buttonId: string)
 */
export class HubClient extends EventEmitter {
  private config: HubClientConfig;
  private modWs: WebSocket | null = null;
  private dashWs: WebSocket | null = null;
  private modReconnect: ReturnType<typeof setTimeout> | null = null;
  private dashReconnect: ReturnType<typeof setTimeout> | null = null;
  private _modConnected = false;
  private _dashConnected = false;

  grid: GridSlot[] = [];
  categories: ActionCategory[] = [];
  deviceStates: Record<string, any> = {};

  constructor(config: HubClientConfig) {
    super();
    this.config = config;
  }

  get connected(): boolean {
    return this._modConnected;
  }

  start(): void {
    this.connectMod();
    this.connectDash();
  }

  stop(): void {
    if (this.modReconnect) clearTimeout(this.modReconnect);
    if (this.dashReconnect) clearTimeout(this.dashReconnect);
    this.modWs?.close();
    this.dashWs?.close();
  }

  fire(button: GridSlot['button']): void {
    this.sendMod({
      type: 'deck-fire',
      buttonId: button.id,
      actions: button.actions,
      mode: button.mode,
      seriesGap: button.seriesGap,
    });
  }

  private connectMod(): void {
    const url = `ws://${this.config.hubHost}:${this.config.modWsPort}`;
    const ws = new WebSocket(url);
    this.modWs = ws;

    ws.addEventListener('open', () => {
      this._modConnected = true;
      this.emit('connected');
      this.sendMod({ type: 'deck-load', name: this.config.profileName });
      this.sendMod({ type: 'get-actions' });
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        switch (msg.type) {
          case 'deck-state':
            this.grid = msg.grid ?? [];
            this.emit('profile-loaded', this.grid);
            break;
          case 'actions':
            this.categories = msg.categories ?? [];
            this.emit('actions-loaded', this.categories);
            break;
          case 'deck-fired':
            this.emit('fired', msg.buttonId);
            break;
        }
      } catch { /* ignore */ }
    });

    ws.addEventListener('close', () => {
      if (this.modWs === ws) {
        this._modConnected = false;
        this.modWs = null;
        this.emit('disconnected');
        this.modReconnect = setTimeout(() => this.connectMod(), RECONNECT_DELAY);
      }
    });

    ws.addEventListener('error', () => ws.close());
  }

  private connectDash(): void {
    const url = `ws://${this.config.hubHost}:${this.config.dashboardPort}`;
    const ws = new WebSocket(url);
    this.dashWs = ws;

    ws.addEventListener('open', () => {
      this._dashConnected = true;
    });

    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.type === 'device-state') {
          this.deviceStates[msg.deviceType] = msg.state;
          this.emit('device-state', msg.deviceType, msg.state);
        }
      } catch { /* ignore */ }
    });

    ws.addEventListener('close', () => {
      if (this.dashWs === ws) {
        this._dashConnected = false;
        this.dashWs = null;
        this.dashReconnect = setTimeout(() => this.connectDash(), RECONNECT_DELAY);
      }
    });

    ws.addEventListener('error', () => ws.close());
  }

  private sendMod(msg: Record<string, any>): void {
    if (this.modWs?.readyState === WebSocket.OPEN) {
      this.modWs.send(JSON.stringify(msg));
    }
  }
}
