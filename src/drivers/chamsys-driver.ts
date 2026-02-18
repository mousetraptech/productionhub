/**
 * ChamSys QuickQ 20 Device Driver
 *
 * OSC-to-OSC relay. Receives OSC from the hub (prefix stripped),
 * rewrites addresses, and forwards to the QuickQ over UDP.
 *
 * QuickQ 20 OSC protocol:
 *   /pb/{X}/{Y}          Playback X, button Y (go/pause/release)
 *   /pb/{X}/{Y}/level    Playback fader level (float 0-1)
 *   /exec/{X}            Execute cue X
 *   /release/{X}         Release playback X
 *   /intensity/{fixture}/{level}  Direct intensity control
 *
 * Feedback ingestion:
 *   The QuickQ sends unsolicited state feedback as bare OSC to the hub's
 *   UDP port (no prefix). These are handled by handleFeedback():
 *     /pb/{N}            float  Playback fader level
 *     /pb/{N}/flash      int    Flash state (0/1)
 *     /pb/{N}/isActive   int    Active state (0/1)
 *     /pb/{N}/cue        int    Current cue number
 *     /master            float  Grand master level
 *     /scene             int    Current scene number
 */

import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import * as osc from 'osc';
import { DeviceDriver, DeviceConfig, HubContext, FeedbackEvent, OscArg } from './device-driver';
import { normalizeArgs } from './osc-args';
import { ReconnectQueue } from './reconnect-queue';
import { getLogger } from '../logger';

const log = getLogger('ChamSys');

export interface ChamSysConfig extends DeviceConfig {
  type: 'chamsys';
}

interface PlaybackState {
  level: number;
  active: boolean;
  flash: boolean;
  cue: number;
}

export class ChamSysDriver extends EventEmitter implements DeviceDriver {
  readonly name: string;
  readonly prefix: string;

  private host: string;
  private port: number;
  private socket: dgram.Socket | null = null;
  private connected: boolean = false;
  private verbose: boolean;
  private queue: ReconnectQueue<{ address: string; args: any[] }> = new ReconnectQueue(64);

  // Feedback state from the desk
  private playbacks: Map<number, PlaybackState> = new Map();
  private masterLevel: number = 0;
  private scene: number = 0;
  private lastExec: number = 0;
  private lastRelease: number = 0;

  constructor(config: ChamSysConfig, _hubContext: HubContext, verbose = false) {
    super();
    this.name = config.name ?? 'chamsys';
    this.prefix = config.prefix;
    this.host = config.host;
    this.port = config.port;
    this.verbose = verbose;
  }

  connect(): void {
    this.socket = dgram.createSocket('udp4');

    this.socket.on('error', (err: Error) => {
      log.error({ err: err.message }, 'UDP error');
      this.emit('error', err);
    });

    this.socket.on('listening', () => {
      this.connected = true;
      this.emit('connected');
      if (this.verbose) {
        log.debug({ host: this.host, port: this.port }, 'Ready to send');
      }
      // Replay any messages queued during disconnect
      const queued = this.queue.flush();
      for (const item of queued) {
        this.handleOSC(item.address, item.args);
      }
    });

    // Bind to any available port for sending
    this.socket.bind(0);
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Handle incoming OSC (prefix already stripped).
   * Forward the address+args as a new OSC message to the QuickQ.
   *
   * Examples:
   *   /pb/1/1         → sent as /pb/1/1 to QuickQ
   *   /pb/1/1/level   → sent as /pb/1/1/level to QuickQ
   *   /exec/1         → sent as /exec/1 to QuickQ
   *   /release/1      → sent as /release/1 to QuickQ
   */
  handleOSC(address: string, args: any[]): void {
    if (!this.socket || !this.connected) {
      this.queue.push({ address, args });
      if (this.verbose) {
        log.debug({ queueSize: this.queue.size }, 'Not connected, queued message');
      }
      return;
    }

    // Build OSC message
    const oscArgs = normalizeArgs(args);

    const msg = osc.writeMessage({
      address,
      args: oscArgs,
    });

    this.socket.send(msg, 0, msg.length, this.port, this.host, (err) => {
      if (err) {
        log.error({ err: err.message }, 'Send error');
        this.emit('error', err);
      }
    });

    if (this.verbose) {
      log.debug({ address, args: oscArgs.map((a: any) => a.value) }, 'Sent');
    }
  }

  /** ChamSys doesn't use the fade engine directly */
  handleFadeTick(_key: string, _value: number): void {
    // No-op: ChamSys fades are handled by the desk itself
  }

  /**
   * Handle unsolicited feedback from the QuickQ arriving on the hub's
   * OSC port without the driver prefix.
   *
   * The QuickQ sends bare addresses like /pb/1, /pb/1/flash, /master, etc.
   * Returns true if recognized as ChamSys feedback.
   */
  handleFeedback(address: string, args: any[]): boolean {
    const addr = address.toLowerCase();

    // /pb/{N} — playback fader level
    const pbLevel = addr.match(/^\/pb\/(\d+)$/);
    if (pbLevel) {
      const n = parseInt(pbLevel[1], 10);
      const level = this.getFloat(args);
      const pb = this.getOrCreatePlayback(n);
      pb.level = level;
      this.emitFeedback(`/pb/${n}/level`, [{ type: 'f', value: level }]);
      return true;
    }

    // /pb/{N}/flash — flash state
    const pbFlash = addr.match(/^\/pb\/(\d+)\/flash$/);
    if (pbFlash) {
      const n = parseInt(pbFlash[1], 10);
      const val = this.getInt(args);
      const pb = this.getOrCreatePlayback(n);
      pb.flash = val >= 1;
      this.emitFeedback(`/pb/${n}/flash`, [{ type: 'i', value: val }]);
      return true;
    }

    // /pb/{N}/isActive — active state
    const pbActive = addr.match(/^\/pb\/(\d+)\/isactive$/);
    if (pbActive) {
      const n = parseInt(pbActive[1], 10);
      const val = this.getInt(args);
      const pb = this.getOrCreatePlayback(n);
      pb.active = val >= 1;
      this.emitFeedback(`/pb/${n}/isActive`, [{ type: 'i', value: val }]);
      return true;
    }

    // /pb/{N}/cue — current cue number
    const pbCue = addr.match(/^\/pb\/(\d+)\/cue$/);
    if (pbCue) {
      const n = parseInt(pbCue[1], 10);
      const val = this.getInt(args);
      const pb = this.getOrCreatePlayback(n);
      pb.cue = val;
      this.emitFeedback(`/pb/${n}/cue`, [{ type: 'i', value: val }]);
      return true;
    }

    // /master — grand master level
    if (addr === '/master') {
      this.masterLevel = this.getFloat(args);
      this.emitFeedback('/master', [{ type: 'f', value: this.masterLevel }]);
      return true;
    }

    // /scene — current scene number
    if (addr === '/scene') {
      this.scene = this.getInt(args);
      this.emitFeedback('/scene', [{ type: 'i', value: this.scene }]);
      return true;
    }

    return false;
  }

  /** Get the current state for the dashboard UI */
  getState(): Record<string, any> {
    const playbacks: Record<string, { level: number; active: boolean; flash: boolean; cue: number }> = {};
    for (const [n, pb] of this.playbacks) {
      playbacks[String(n)] = { ...pb };
    }

    return {
      playbacks,
      lastExec: this.lastExec,
      lastRelease: this.lastRelease,
      masterLevel: this.masterLevel,
      scene: this.scene,
    };
  }

  // --- Helpers ---

  private getOrCreatePlayback(n: number): PlaybackState {
    let pb = this.playbacks.get(n);
    if (!pb) {
      pb = { level: 0, active: false, flash: false, cue: 0 };
      this.playbacks.set(n, pb);
    }
    return pb;
  }

  private emitFeedback(address: string, args: OscArg[]): void {
    const event: FeedbackEvent = { address, args };
    this.emit('feedback', event);
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
}
