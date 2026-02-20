/**
 * ChamSys QuickQ 20 Device Driver
 *
 * OSC-to-OSC relay. Receives OSC from the hub (prefix stripped),
 * rewrites addresses, and forwards to the QuickQ over UDP.
 *
 * QuickQ 20 OSC protocol (console listens on port 8000):
 *   /pb/{N}              Set playback N fader level (float 0.0-1.0 or int 0-100)
 *   /pb/{N}/go           Go (advance) on playback N
 *   /pb/{N}/flash        Flash playback N (int 0=off, 1=on)
 *   /pb/{N}/pause        Pause playback N
 *   /pb/{N}/release      Release playback N
 *   /pb/{N}/{cue}        Jump to cue number on playback N (does NOT activate)
 *   /exec/{N}            Execute cue N
 *   /release/{N}         Release playback N
 *
 * Feedback ingestion:
 *   The QuickQ sends unsolicited state feedback as bare OSC to the hub's
 *   UDP port (no prefix). These are handled by handleFeedback():
 *     /pb/{N}            float  Playback fader level
 *     /pb/{N}/flash      int    Flash state (0/1)
 *     /pb/{N}/isActive   int    Active state (0/1)
 *     /pb/{N}/cue        int    Current cue number
 *     /master            float  Grand master level
 */

import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import * as osc from 'osc';
import { DeviceDriver, DeviceConfig, HubContext, FeedbackEvent, OscArg, DriverFadeRequest } from './device-driver';
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
  private lastExec: number = 0;
  private lastRelease: number = 0;
  private lastFadeEmit: number = 0;

  private hubContext: HubContext;

  constructor(config: ChamSysConfig, hubContext: HubContext, verbose = false) {
    super();
    this.name = config.name ?? 'chamsys';
    this.prefix = config.prefix;
    this.host = config.host;
    this.port = config.port;
    this.verbose = verbose;
    this.hubContext = hubContext;
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
    // Detect fade requests: /pb/{N} with [target, duration, curve] or /pb/{N}/fade
    const fadeMatch = address.match(/^\/pb\/(\d+)(\/fade)?$/);
    if (fadeMatch && args.length >= 2 && typeof this.getFloat(args) === 'number') {
      const n = parseInt(fadeMatch[1], 10);
      const target = this.getFloat(args);
      const durationSecs = args.length >= 2 ? this.getFloat(args.slice(1)) : 1;
      const easingStr = args.length >= 3 ? (typeof args[2] === 'string' ? args[2] : (args[2]?.value ?? 'scurve')) : 'scurve';
      const easing = (['linear', 'scurve', 'easein', 'easeout'].includes(easingStr)
        ? easingStr
        : 'scurve') as DriverFadeRequest['easing'];

      // Only treat as fade if duration > 0 — otherwise it's a direct set
      if (durationSecs > 0) {
        const fadeKey = `${this.name}:pb/${n}/level`;

        // Seed current value if not yet tracked
        const current = this.hubContext.getCurrentValue(fadeKey);
        if (current === undefined) {
          const pb = this.playbacks.get(n);
          this.hubContext.setCurrentValue(fadeKey, pb ? pb.level : 0);
        }

        if (this.verbose) {
          log.debug({ playback: n, target, durationSecs, easing }, 'Starting fade');
        }

        this.hubContext.startFade({
          key: fadeKey,
          startValue: 0,
          endValue: target,
          durationMs: durationSecs * 1000,
          easing,
        });
        return;
      }
    }

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

  /** Handle fade engine ticks — send interpolated level to QuickQ */
  handleFadeTick(key: string, value: number): void {
    // key is like "pb/10/level"
    const match = key.match(/^pb\/(\d+)\/level$/);
    if (!match) return;

    const n = parseInt(match[1], 10);

    // Update local state
    const pb = this.getOrCreatePlayback(n);
    pb.level = value;

    // Send OSC level to QuickQ
    this.sendLevel(n, value);

    // Emit feedback (throttled to ~10Hz) so dashboard WS broadcasts state
    const now = Date.now();
    if (now - this.lastFadeEmit >= 100) {
      this.lastFadeEmit = now;
      this.emitFeedback(`/pb/${n}/level`, [{ type: 'f', value }]);
    }
  }

  /** Send a playback level as OSC to the QuickQ */
  private sendLevel(n: number, value: number): void {
    if (!this.socket || !this.connected) return;

    const msg = osc.writeMessage({
      address: `/pb/${n}`,
      args: [{ type: 'f', value }],
    });

    this.socket.send(msg, 0, msg.length, this.port, this.host, (err) => {
      if (err) {
        log.error({ err: err.message }, 'Send error');
      }
    });
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
