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
 * This driver essentially relays OSC, so it's lightweight:
 * it opens a UDP socket and forwards messages to the QuickQ's IP:port.
 */

import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import * as osc from 'osc';
import { DeviceDriver, DeviceConfig, HubContext, FeedbackEvent } from './device-driver';
import { normalizeArgs } from './osc-args';
import { ReconnectQueue } from './reconnect-queue';

export interface ChamSysConfig extends DeviceConfig {
  type: 'chamsys';
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
      console.error(`[ChamSys] UDP error: ${err.message}`);
      this.emit('error', err);
    });

    this.socket.on('listening', () => {
      this.connected = true;
      this.emit('connected');
      if (this.verbose) {
        console.log(`[ChamSys] Ready to send to ${this.host}:${this.port}`);
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
        console.warn(`[ChamSys] Not connected, queued message (${this.queue.size} in queue)`);
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
        console.error(`[ChamSys] Send error: ${err.message}`);
        this.emit('error', err);
      }
    });

    if (this.verbose) {
      console.log(`[ChamSys] -> ${address} [${oscArgs.map((a: any) => a.value).join(', ')}]`);
    }
  }

  /** ChamSys doesn't use the fade engine directly */
  handleFadeTick(_key: string, _value: number): void {
    // No-op: ChamSys fades are handled by the desk itself
  }
}
