/**
 * OSC Server for Avantis
 *
 * Receives OSC messages and emits typed events for the translation engine.
 * Follows an X32-inspired namespace convention:
 *
 *   /ch/{n}/mix/fader     float 0.0-1.0    Channel fader level
 *   /ch/{n}/mix/mute      int 0|1          Channel mute (1=muted)
 *   /ch/{n}/mix/pan       float 0.0-1.0    Channel pan (0=L, 0.5=C, 1=R)
 *   /mix/{n}/mix/fader    float 0.0-1.0    Mix/Aux master fader
 *   /mix/{n}/mix/mute     int 0|1          Mix/Aux master mute
 *   /fxsend/{n}/mix/fader float 0.0-1.0    FX Send fader
 *   /fxrtn/{n}/mix/fader  float 0.0-1.0    FX Return fader
 *   /dca/{n}/fader        float 0.0-1.0    DCA fader
 *   /dca/{n}/mute         int 0|1          DCA mute
 *   /grp/{n}/mix/fader    float 0.0-1.0    Group fader
 *   /mtx/{n}/mix/fader    float 0.0-1.0    Matrix fader
 *   /main/mix/fader       float 0.0-1.0    Main LR fader
 *   /main/mix/mute        int 0|1          Main LR mute
 *   /scene/recall         int 0-127        Scene recall by number
 *   /-stat/selidx         int              Select channel
 *
 * Fade endpoints (timed interpolation handled by bridge):
 *   /ch/{n}/mix/fade      float,float,float  target, duration_secs [, easing]
 *   /mix/{n}/mix/fade     float,float,float  target, duration_secs [, easing]
 *   /dca/{n}/fade         float,float,float  target, duration_secs [, easing]
 *   /main/mix/fade        float,float,float  target, duration_secs [, easing]
 *   (... same pattern for all strip types)
 *
 *   /fade/stop            (none)             Stop all active fades
 *   /fade/stop            string key         Stop fade on specific strip
 */

import * as osc from 'osc';
import { EventEmitter } from 'events';
import { StripType } from './midi-protocol';
import { EasingType } from './fade-engine';

export interface OSCFaderEvent {
  type: 'fader';
  strip: { type: StripType; number: number };
  value: number; // 0.0-1.0
}

export interface OSCMuteEvent {
  type: 'mute';
  strip: { type: StripType; number: number };
  value: boolean;
}

export interface OSCPanEvent {
  type: 'pan';
  strip: { type: StripType; number: number };
  value: number; // 0.0-1.0
}

export interface OSCSceneEvent {
  type: 'scene';
  sceneNumber: number;
}

export interface OSCFadeEvent {
  type: 'fade';
  strip: { type: StripType; number: number };
  param: 'fader' | 'pan';
  targetValue: number;    // 0.0-1.0
  durationSecs: number;   // seconds
  easing: EasingType;
}

export interface OSCFadeStopEvent {
  type: 'fadeStop';
  key?: string; // undefined = stop all
}

export type OSCEvent = OSCFaderEvent | OSCMuteEvent | OSCPanEvent | OSCSceneEvent | OSCFadeEvent | OSCFadeStopEvent;

export interface OSCServerOptions {
  localAddress?: string;
  localPort?: number;
  replyPort?: number; // Override port for feedback replies (default: client's source port)
}

interface OSCClient {
  address: string;
  port: number;     // source port the client sent from
  lastSeen: number;
}

const CLIENT_TIMEOUT_MS = 60_000; // drop clients after 60s of silence

export class AvantisOSCServer extends EventEmitter {
  private udpPort: any;
  private options: { localAddress: string; localPort: number };
  private replyPort?: number;
  private clients: Map<string, OSCClient> = new Map();
  private rawMessageCallback?: (address: string, args: any[], info: any) => void;

  constructor(opts: OSCServerOptions = {}) {
    super();
    this.options = {
      localAddress: opts.localAddress ?? '0.0.0.0',
      localPort: opts.localPort ?? 9000,
    };
    this.replyPort = opts.replyPort;
  }

  /**
   * Register a callback for raw OSC messages before parsing.
   * Used by ProductionHub for prefix-based routing.
   *
   * When set, the callback receives every incoming message with:
   *   - address: the raw OSC address string
   *   - args: the raw args array
   *   - info: sender info (address, port)
   *
   * The server's own parseAddress → 'command' emit still fires as normal.
   */
  onRawMessage(callback: (address: string, args: any[], info: any) => void): void {
    this.rawMessageCallback = callback;
  }

  start(): void {
    this.udpPort = new osc.UDPPort({
      localAddress: this.options.localAddress,
      localPort: this.options.localPort,
      metadata: true,
    });

    this.udpPort.on('message', (oscMsg: any, _timeTag: any, info: any) => {
      this.trackClient(info);
      this.handleMessage(oscMsg, info);
    });

    this.udpPort.on('error', (err: Error) => {
      console.error(`[OSC] Error: ${err.message}`);
      this.emit('error', err);
    });

    this.udpPort.on('ready', () => {
      console.log(`[OSC] Listening on ${this.options.localAddress}:${this.options.localPort}`);
      this.emit('ready');
    });

    this.udpPort.open();
  }

  stop(): void {
    if (this.udpPort) {
      this.udpPort.close();
    }
  }

  /**
   * Send an OSC message to all tracked clients (feedback from desk).
   */
  sendToClients(address: string, args: Array<{ type: string; value: any }>): void {
    if (!this.udpPort) return;

    const now = Date.now();
    const msg = { address, args };

    for (const [key, client] of this.clients) {
      if (now - client.lastSeen > CLIENT_TIMEOUT_MS) {
        this.clients.delete(key);
        continue;
      }
      try {
        const replyPort = this.replyPort ?? client.port;
        this.udpPort.send(msg, client.address, replyPort);
      } catch (err: any) {
        // UDP send failures are non-fatal
      }
    }
  }

  /** Number of currently tracked clients */
  get clientCount(): number {
    return this.clients.size;
  }

  /** Get list of active clients (pruning expired ones) */
  getClients(): Array<{ address: string; port: number; lastSeen: number }> {
    const now = Date.now();
    const result: Array<{ address: string; port: number; lastSeen: number }> = [];
    for (const [key, client] of this.clients) {
      if (now - client.lastSeen > CLIENT_TIMEOUT_MS) {
        this.clients.delete(key);
        continue;
      }
      result.push({ address: client.address, port: client.port, lastSeen: client.lastSeen });
    }
    return result;
  }

  private trackClient(info: any): void {
    if (!info || !info.address || !info.port) return;
    const key = `${info.address}:${info.port}`;
    this.clients.set(key, {
      address: info.address,
      port: info.port,
      lastSeen: Date.now(),
    });
  }

  private handleMessage(msg: any, info: any): void {
    const address: string = msg.address;
    const args: any[] = msg.args || [];

    // Fire raw callback first (used by ProductionHub for prefix routing)
    if (this.rawMessageCallback) {
      this.rawMessageCallback(address, args, info);
    }

    try {
      const event = this.parseAddress(address, args);
      if (event) {
        this.emit('command', event);
      } else {
        // Only warn if no raw callback is handling routing
        if (!this.rawMessageCallback) {
          console.warn(`[OSC] Unrecognized address: ${address}`);
        }
      }
    } catch (err: any) {
      console.error(`[OSC] Parse error for ${address}: ${err.message}`);
    }
  }

  private parseAddress(address: string, args: any[]): OSCEvent | null {
    // Normalize: lowercase, strip trailing slash
    const addr = address.toLowerCase().replace(/\/$/, '');
    const parts = addr.split('/').filter(Boolean);

    if (parts.length === 0) return null;

    // /ch/{n}/mix/fader
    // /ch/{n}/mix/mute
    // /ch/{n}/mix/pan
    if (parts[0] === 'ch' && parts.length >= 3) {
      const n = parseInt(parts[1], 10);
      if (isNaN(n)) return null;
      return this.parseStripCommand(StripType.Input, n, parts.slice(2), args);
    }

    // /mix/{n}/mix/fader, /mix/{n}/mix/mute
    if (parts[0] === 'mix' && parts.length >= 3) {
      const n = parseInt(parts[1], 10);
      if (isNaN(n)) return null;
      return this.parseStripCommand(StripType.Mix, n, parts.slice(2), args);
    }

    // /fxsend/{n}/mix/fader
    if (parts[0] === 'fxsend' && parts.length >= 3) {
      const n = parseInt(parts[1], 10);
      if (isNaN(n)) return null;
      return this.parseStripCommand(StripType.FXSend, n, parts.slice(2), args);
    }

    // /fxrtn/{n}/mix/fader
    if (parts[0] === 'fxrtn' && parts.length >= 3) {
      const n = parseInt(parts[1], 10);
      if (isNaN(n)) return null;
      return this.parseStripCommand(StripType.FXReturn, n, parts.slice(2), args);
    }

    // /dca/{n}/fader, /dca/{n}/mute
    if (parts[0] === 'dca' && parts.length >= 2) {
      const n = parseInt(parts[1], 10);
      if (isNaN(n)) return null;
      const subParts = parts.slice(2);
      // /dca/{n}/fader or /dca/{n}/mix/fader
      if (subParts.length === 1 && subParts[0] === 'fader') {
        return { type: 'fader', strip: { type: StripType.DCA, number: n }, value: this.getFloat(args) };
      }
      if (subParts.length === 1 && subParts[0] === 'mute') {
        return { type: 'mute', strip: { type: StripType.DCA, number: n }, value: this.getBool(args) };
      }
      return this.parseStripCommand(StripType.DCA, n, subParts, args);
    }

    // /grp/{n}/mix/fader
    if (parts[0] === 'grp' && parts.length >= 3) {
      const n = parseInt(parts[1], 10);
      if (isNaN(n)) return null;
      return this.parseStripCommand(StripType.Group, n, parts.slice(2), args);
    }

    // /mtx/{n}/mix/fader
    if (parts[0] === 'mtx' && parts.length >= 3) {
      const n = parseInt(parts[1], 10);
      if (isNaN(n)) return null;
      return this.parseStripCommand(StripType.Matrix, n, parts.slice(2), args);
    }

    // /main/mix/fader, /main/mix/mute
    if (parts[0] === 'main') {
      return this.parseStripCommand(StripType.Main, 1, parts.slice(1), args);
    }

    // /scene/recall {n}
    if (parts[0] === 'scene' && parts[1] === 'recall') {
      return { type: 'scene', sceneNumber: this.getInt(args) };
    }

    // /fade/stop [key]
    if (parts[0] === 'fade' && parts[1] === 'stop') {
      const key = args.length > 0 ? this.getString(args) : undefined;
      return { type: 'fadeStop', key };
    }

    return null;
  }

  private parseStripCommand(stripType: StripType, num: number, subParts: string[], args: any[]): OSCEvent | null {
    // Flatten: handle both /mix/fader and just /fader
    const paramPath = subParts.join('/');

    switch (paramPath) {
      case 'mix/fader':
      case 'fader':
        return { type: 'fader', strip: { type: stripType, number: num }, value: this.getFloat(args) };
      case 'mix/mute':
      case 'mute':
        return { type: 'mute', strip: { type: stripType, number: num }, value: this.getBool(args) };
      case 'mix/pan':
      case 'pan':
        return { type: 'pan', strip: { type: stripType, number: num }, value: this.getFloat(args) };
      case 'mix/fade':
      case 'fade':
        return this.parseFade(stripType, num, 'fader', args);
      case 'mix/fade/pan':
      case 'fade/pan':
        return this.parseFade(stripType, num, 'pan', args);
      default:
        return null;
    }
  }

  /**
   * Parse fade args: target, duration_secs [, easing]
   *   /ch/1/mix/fade 0.75 3.0
   *   /ch/1/mix/fade 0.75 3.0 scurve
   */
  private parseFade(stripType: StripType, num: number, param: 'fader' | 'pan', args: any[]): OSCFadeEvent | null {
    if (args.length < 2) {
      console.warn(`[OSC] Fade requires at least 2 args (target, duration), got ${args.length}`);
      return null;
    }
    const targetValue = this.getFloat(args);
    const durationSecs = this.getFloatAt(args, 1);
    const easingStr = args.length >= 3 ? this.getStringAt(args, 2) : 'scurve';
    const easing = (['linear', 'scurve', 'easein', 'easeout'].includes(easingStr)
      ? easingStr
      : 'scurve') as EasingType;

    return {
      type: 'fade',
      strip: { type: stripType, number: num },
      param,
      targetValue,
      durationSecs,
      easing,
    };
  }

  private getFloat(args: any[]): number {
    if (!args || args.length === 0) return 0;
    const arg = args[0];
    const val = typeof arg === 'object' && arg.value !== undefined ? arg.value : arg;
    return typeof val === 'number' ? val : parseFloat(val) || 0;
  }

  private getInt(args: any[]): number {
    if (!args || args.length === 0) return 0;
    const arg = args[0];
    const val = typeof arg === 'object' && arg.value !== undefined ? arg.value : arg;
    return typeof val === 'number' ? Math.round(val) : parseInt(val, 10) || 0;
  }

  private getFloatAt(args: any[], index: number): number {
    if (!args || args.length <= index) return 0;
    const arg = args[index];
    const val = typeof arg === 'object' && arg.value !== undefined ? arg.value : arg;
    return typeof val === 'number' ? val : parseFloat(val) || 0;
  }

  private getString(args: any[]): string {
    return this.getStringAt(args, 0);
  }

  private getStringAt(args: any[], index: number): string {
    if (!args || args.length <= index) return '';
    const arg = args[index];
    const val = typeof arg === 'object' && arg.value !== undefined ? arg.value : arg;
    return String(val);
  }

  private getBool(args: any[]): boolean {
    const val = this.getInt(args);
    return val >= 1;
  }
}
