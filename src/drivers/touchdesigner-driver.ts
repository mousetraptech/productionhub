/**
 * TouchDesigner Device Driver
 *
 * OSC-to-OSC relay. Receives OSC from the hub (prefix stripped),
 * and forwards to TouchDesigner's OSC In CHOP over UDP.
 *
 * TouchDesigner receives these as CHOP channels. The address path
 * becomes the channel name in the OSC In CHOP, so whatever addresses
 * you send here show up directly as channels in TD.
 *
 * Common patterns:
 *   /render/start          Trigger render
 *   /render/stop           Stop render
 *   /render/resolution     int width, int height
 *   /param/{name}          float 0.0-1.0 (maps to any TD parameter)
 *   /cue/{n}               Trigger cue N
 *   /opacity               float 0.0-1.0
 *   /blend/{layer}         float 0.0-1.0
 *
 * Since TD's OSC In CHOP accepts arbitrary addresses, this driver
 * is a transparent relay — any address you send gets forwarded as-is
 * (minus the hub prefix). Design your OSC namespace in TD to match.
 */

import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import * as osc from 'osc';
import { DeviceDriver, DeviceConfig, HubContext } from './device-driver';
import { normalizeArgs } from './osc-args';
import { ReconnectQueue } from './reconnect-queue';

export interface TouchDesignerConfig extends DeviceConfig {
  type: 'touchdesigner';
}

export class TouchDesignerDriver extends EventEmitter implements DeviceDriver {
  readonly name: string;
  readonly prefix: string;

  private host: string;
  private port: number;
  private socket: dgram.Socket | null = null;
  private connected: boolean = false;
  private verbose: boolean;
  private queue: ReconnectQueue<{ address: string; args: any[] }> = new ReconnectQueue(64);

  constructor(config: TouchDesignerConfig, _hubContext: HubContext, verbose = false) {
    super();
    this.name = config.name ?? 'touchdesigner';
    this.prefix = config.prefix;
    this.host = config.host;
    this.port = config.port;
    this.verbose = verbose;
  }

  connect(): void {
    this.socket = dgram.createSocket('udp4');

    this.socket.on('error', (err: Error) => {
      console.error(`[TD] UDP error: ${err.message}`);
      this.emit('error', err);
    });

    this.socket.on('listening', () => {
      this.connected = true;
      this.emit('connected');
      if (this.verbose) {
        console.log(`[TD] Ready to send to ${this.host}:${this.port}`);
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
   * Handle incoming OSC (prefix already stripped by hub).
   * Forward the address+args as a new OSC message to TouchDesigner.
   *
   * The OSC In CHOP in TD will see the address as a channel name,
   * so /render/start arrives as channel "render/start" in the CHOP.
   */
  handleOSC(address: string, args: any[]): void {
    if (!this.socket || !this.connected) {
      this.queue.push({ address, args });
      if (this.verbose) {
        console.warn(`[TD] Not connected, queued message (${this.queue.size} in queue)`);
      }
      return;
    }

    const oscArgs = normalizeArgs(args);

    const msg = osc.writeMessage({
      address,
      args: oscArgs,
    });

    this.socket.send(msg, 0, msg.length, this.port, this.host, (err) => {
      if (err) {
        console.error(`[TD] Send error: ${err.message}`);
        this.emit('error', err);
      }
    });

    if (this.verbose) {
      console.log(`[TD] -> ${address} [${oscArgs.map((a: any) => a.value).join(', ')}]`);
    }
  }

  /** TouchDesigner doesn't use the fade engine — handle fades in TD itself */
  handleFadeTick(_key: string, _value: number): void {
    // No-op
  }
}
