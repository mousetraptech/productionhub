/**
 * NDI Recorder Device Driver
 *
 * Connects to a remote ndi-record-agent over WebSocket.
 * Translates OSC commands to JSON and relays recording state to the UI.
 *
 * OSC namespace (after prefix stripping):
 *   /start        Start all configured sources
 *   /stop         Stop all, triggers auto-archive
 *   /status       Request current state
 *
 * Feedback events (agent → OSC clients):
 *   /state                     string (recording|stopped|archiving)
 *   /source/{id}/frames        int frame count
 *   /source/{id}/vu            float dB
 *   /archive/progress          float 0.0-1.0
 *   /archive/done              (no args)
 */

import { EventEmitter } from 'events';
import { DeviceDriver, DeviceConfig, HubContext, FeedbackEvent, OscArg } from './device-driver';

export interface NDIRecorderConfig extends DeviceConfig {
  type: 'ndi-recorder';
}

export interface RecorderSource {
  id: string;
  name: string;
  frames: number;
  vuDb: number;
}

export interface RecorderDriverState {
  state: 'stopped' | 'recording' | 'archiving';
  sources: RecorderSource[];
  archiveProgress: number;
}

let WebSocket: any;

export class NDIRecorderDriver extends EventEmitter implements DeviceDriver {
  readonly name: string;
  readonly prefix: string;

  private host: string;
  private port: number;
  private ws: any = null;
  private connected: boolean = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private verbose: boolean;

  private recorderState: RecorderDriverState = {
    state: 'stopped',
    sources: [],
    archiveProgress: 0,
  };

  constructor(config: NDIRecorderConfig, _hubContext: HubContext, verbose = false) {
    super();
    this.name = config.name ?? 'ndi-recorder';
    this.prefix = config.prefix;
    this.host = config.host;
    this.port = config.port;
    this.verbose = verbose;
  }

  connect(): void {
    this.loadWebSocket();
    this.doConnect();
  }

  private loadWebSocket(): void {
    if (!WebSocket) {
      try {
        WebSocket = require('ws');
      } catch {
        throw new Error('[NDI-Rec] "ws" package not installed. Run: npm install ws');
      }
    }
  }

  private doConnect(): void {
    const url = `ws://${this.host}:${this.port}`;
    if (this.verbose) {
      console.log(`[NDI-Rec] Connecting to ${url}`);
    }

    try {
      this.ws = new WebSocket(url);
    } catch (err: any) {
      console.error(`[NDI-Rec] WebSocket creation failed: ${err.message}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.connected = true;
      this.emit('connected');
      if (this.verbose) console.log('[NDI-Rec] Connected to agent');
      // Request initial state
      this.sendToAgent({ type: 'status' });
    });

    this.ws.on('message', (data: any) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleAgentMessage(msg);
      } catch (err: any) {
        console.error(`[NDI-Rec] Parse error: ${err.message}`);
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      this.emit('disconnected');
      if (this.verbose) console.log('[NDI-Rec] WebSocket closed');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err: Error) => {
      console.error(`[NDI-Rec] WebSocket error: ${err.message}`);
      this.emit('error', err);
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.verbose) console.log('[NDI-Rec] Attempting reconnect...');
      this.doConnect();
    }, 5000);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  handleOSC(address: string, _args: any[]): void {
    const cmd = address.replace(/^\//, '').toLowerCase();

    switch (cmd) {
      case 'start':
        this.sendToAgent({ type: 'start' });
        break;
      case 'stop':
        this.sendToAgent({ type: 'stop' });
        break;
      case 'status':
        this.sendToAgent({ type: 'status' });
        break;
      default:
        if (this.verbose) console.warn(`[NDI-Rec] Unrecognized: ${address}`);
    }
  }

  handleFadeTick(_key: string, _value: number): void {
    // No-op — recorder doesn't use fades
  }

  getState(): RecorderDriverState {
    return { ...this.recorderState };
  }

  private handleAgentMessage(msg: any): void {
    switch (msg.type) {
      case 'state':
        this.recorderState.state = msg.state;
        this.emitFeedback('/state', [{ type: 's', value: msg.state }]);
        break;

      case 'source-update': {
        const existing = this.recorderState.sources.find(s => s.id === msg.id);
        if (existing) {
          existing.frames = msg.frames;
          existing.vuDb = msg.vuDb;
        } else {
          this.recorderState.sources.push({
            id: msg.id,
            name: msg.name ?? msg.id,
            frames: msg.frames,
            vuDb: msg.vuDb,
          });
        }
        this.emitFeedback(`/source/${msg.id}/frames`, [{ type: 'i', value: msg.frames }]);
        this.emitFeedback(`/source/${msg.id}/vu`, [{ type: 'f', value: msg.vuDb }]);
        break;
      }

      case 'archive-progress':
        this.recorderState.archiveProgress = msg.progress;
        this.emitFeedback('/archive/progress', [{ type: 'f', value: msg.progress }]);
        break;

      case 'archive-done':
        this.recorderState.archiveProgress = 1;
        this.recorderState.state = 'stopped';
        this.emitFeedback('/archive/done', []);
        break;

      case 'error':
        console.error(`[NDI-Rec] Agent error: ${msg.message}`);
        this.emit('error', new Error(msg.message));
        break;

      case 'sources':
        // Agent sends full source list on connect
        this.recorderState.sources = (msg.sources ?? []).map((s: any) => ({
          id: s.id,
          name: s.name,
          frames: 0,
          vuDb: -60,
        }));
        // Trigger a state broadcast
        this.emitFeedback('/state', [{ type: 's', value: this.recorderState.state }]);
        break;
    }
  }

  private sendToAgent(msg: Record<string, any>): void {
    if (!this.ws || !this.connected) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err: any) {
      console.error(`[NDI-Rec] Send error: ${err.message}`);
    }
  }

  private emitFeedback(address: string, args: OscArg[]): void {
    this.emit('feedback', { address, args } as FeedbackEvent);
  }
}
