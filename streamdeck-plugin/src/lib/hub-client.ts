import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { GridSlot, ActionCategory, DeckButton } from './types';

export interface HubClientConfig {
  hubHost: string;
  modWsPort: number;
  dashboardPort: number;
  profileName: string;
}

const RECONNECT_DELAY = 2000;

type LogFn = (msg: string) => void;
let log: LogFn = (msg) => console.log(`[PH] ${msg}`);

export function setHubLogger(fn: LogFn): void {
  log = fn;
}

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
  private static readonly WS_OPEN = 1;
  private modReconnect: ReturnType<typeof setTimeout> | null = null;
  private dashReconnect: ReturnType<typeof setTimeout> | null = null;
  private _modConnected = false;
  private _dashConnected = false;
  private loadedProfile: string | null = null;

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
    log(`Starting — hub ${this.config.hubHost}:${this.config.modWsPort}, dashboard :${this.config.dashboardPort}`);
    this.connectMod();
    this.connectDash();
  }

  stop(): void {
    if (this.modReconnect) clearTimeout(this.modReconnect);
    if (this.dashReconnect) clearTimeout(this.dashReconnect);
    this.modWs?.close();
    this.dashWs?.close();
  }

  fire(button: DeckButton): void {
    log(`Fire: ${button.label} (${button.actions.length} actions, ${button.mode})`);
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
    log(`ModWS connecting to ${url}`);
    const ws = new WebSocket(url);
    this.modWs = ws;

    ws.on('open', () => {
      this._modConnected = true;
      log('ModWS connected');
      this.emit('connected');
      // List profiles first, then load the right one
      this.sendMod({ type: 'deck-list' });
      this.sendMod({ type: 'get-actions' });
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(String(data));
        switch (msg.type) {
          case 'deck-profiles': {
            const profiles: string[] = msg.profiles ?? [];
            log(`Profiles available: [${profiles.join(', ')}]`);
            // Load configured profile, or first available
            const target = profiles.includes(this.config.profileName)
              ? this.config.profileName
              : profiles[0] ?? null;
            if (target) {
              log(`Loading profile: ${target}`);
              this.sendMod({ type: 'deck-load', name: target });
            } else {
              log('No profiles found');
            }
            break;
          }
          case 'deck-state':
            this.grid = msg.grid ?? [];
            this.loadedProfile = msg.name ?? null;
            log(`Profile loaded: "${this.loadedProfile}" with ${this.grid.length} buttons`);
            this.emit('profile-loaded', this.grid);
            break;
          case 'actions':
            this.categories = msg.categories ?? [];
            log(`Actions loaded: ${this.categories.length} categories`);
            this.emit('actions-loaded', this.categories);
            break;
          case 'deck-fired':
            log(`Fired confirmed: ${msg.buttonId}`);
            this.emit('fired', msg.buttonId);
            break;
          default:
            log(`Unknown message type: ${msg.type}`);
            break;
        }
      } catch (err) {
        log(`ModWS message parse error: ${err}`);
      }
    });

    ws.on('close', () => {
      if (this.modWs === ws) {
        this._modConnected = false;
        this.modWs = null;
        log('ModWS disconnected, reconnecting in 2s');
        this.emit('disconnected');
        this.modReconnect = setTimeout(() => this.connectMod(), RECONNECT_DELAY);
      }
    });

    ws.on('error', (err) => {
      log(`ModWS error: ${err.message}`);
      ws.close();
    });
  }

  private connectDash(): void {
    const url = `ws://${this.config.hubHost}:${this.config.dashboardPort}`;
    log(`DashWS connecting to ${url}`);
    const ws = new WebSocket(url);
    this.dashWs = ws;

    ws.on('open', () => {
      this._dashConnected = true;
      log('DashWS connected');
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg.type === 'device-state') {
          this.deviceStates[msg.deviceType] = msg.state;
          this.emit('device-state', msg.deviceType, msg.state);
        }
      } catch { /* ignore */ }
    });

    ws.on('close', () => {
      if (this.dashWs === ws) {
        this._dashConnected = false;
        this.dashWs = null;
        log('DashWS disconnected, reconnecting in 2s');
        this.dashReconnect = setTimeout(() => this.connectDash(), RECONNECT_DELAY);
      }
    });

    ws.on('error', (err) => {
      log(`DashWS error: ${err.message}`);
      ws.close();
    });
  }

  private sendMod(msg: Record<string, any>): void {
    if (this.modWs?.readyState === HubClient.WS_OPEN) {
      this.modWs.send(JSON.stringify(msg));
    }
  }
}
