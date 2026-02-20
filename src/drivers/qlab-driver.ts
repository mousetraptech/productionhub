/**
 * QLab Device Driver
 *
 * OSC-to-OSC relay for Figure 53 QLab. Sends OSC commands over UDP
 * and polls QLab for playhead and running cue state.
 *
 * QLab OSC protocol (default port 53000):
 *   /go                        Fire next cue
 *   /go/{cue_number}           Fire specific cue
 *   /stop                      Stop all cues
 *   /pause                     Pause all cues
 *   /resume                    Resume all cues
 *   /cue/{number}/start        Start a specific cue
 *   /cue/{number}/stop         Stop a specific cue
 *   /cue/playhead/text         Query playhead cue name
 *   /runningCues               Query running cue list
 *
 * Connection handshake:
 *   On connect, sends /connect (with optional passcode) and /updates 1
 *   to enable push updates from QLab.
 *
 * Feedback:
 *   QLab replies to queries with /reply/{original_address} containing
 *   a JSON string. The driver parses these for playhead and running cue state.
 */

import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import * as osc from 'osc';
import { DeviceConfig, DeviceDriver, HubContext, FeedbackEvent } from './device-driver';
import { ReconnectQueue } from './reconnect-queue';

export interface QLabConfig extends DeviceConfig {
  type: 'qlab';
  passcode?: string;
}

export class QLabDriver extends EventEmitter implements DeviceDriver {
  readonly name: string;
  readonly prefix: string;
  private host: string;
  private port: number;
  private passcode: string;
  private socket: dgram.Socket | null = null;
  private connected = false;
  private verbose: boolean;
  private queue = new ReconnectQueue<{ address: string; args: any[] }>(64);
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  // State
  private playhead = '';
  private runningCues: string[] = [];

  constructor(config: QLabConfig, _hubContext: HubContext, verbose = false) {
    super();
    this.name = config.name || 'qlab';
    this.prefix = config.prefix;
    this.host = config.host;
    this.port = config.port;
    this.passcode = config.passcode || '';
    this.verbose = verbose;
  }

  connect(): void {
    const socket = dgram.createSocket('udp4');
    this.socket = socket;

    socket.on('listening', () => {
      this.log(`UDP socket bound on port ${socket.address().port}`);
      if (this.passcode) {
        this.sendOsc('/connect', [{ type: 's', value: this.passcode }]);
      } else {
        this.sendOsc('/connect', []);
      }
      this.sendOsc('/updates', [{ type: 'i', value: 1 }]);

      this.connected = true;
      this.emit('connected');

      // Replay any messages queued during disconnect
      const queued = this.queue.flush();
      for (const item of queued) {
        this.handleOSC(item.address, item.args);
      }

      this.pollTimer = setInterval(() => this.poll(), 1000);
      this.pollTimer.unref();
    });

    socket.on('message', (msg: Buffer, _rinfo: dgram.RemoteInfo) => {
      try {
        const packet = osc.readMessage(msg, { metadata: true });
        if (packet.address) {
          this.handleReply(packet.address, packet.args || []);
        }
      } catch (err) {
        this.log(`Reply parse error: ${err}`);
      }
    });

    socket.on('error', (err: Error) => {
      this.log(`Socket error: ${err.message}`);
      this.emit('error', err);
    });

    socket.bind(0);
  }

  disconnect(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connected = false;
    this.emit('disconnected');
  }

  isConnected(): boolean {
    return this.connected;
  }

  handleOSC(address: string, args: any[]): void {
    if (!this.connected) {
      this.queue.push({ address, args });
      return;
    }
    const oscArgs = args.map((a) => this.toOscArg(a));
    this.sendOsc(address, oscArgs);
    this.log(`TX ${address} ${args.map(String).join(' ')}`);
  }

  handleFadeTick(_key: string, _value: number): void {
    // no-op — QLab handles its own fades
  }

  getState(): Record<string, any> {
    return {
      connected: this.connected,
      playhead: this.playhead,
      runningCues: this.runningCues,
      runningCount: this.runningCues.length,
    };
  }

  private poll(): void {
    if (!this.connected) return;
    this.sendOsc('/cue/playhead/text', []);
    this.sendOsc('/runningCues', []);
  }

  private handleReply(address: string, args: any[]): void {
    if (!address.startsWith('/reply/')) return;

    const originalAddress = address.slice('/reply'.length);
    const jsonStr = args[0]?.value ?? args[0];
    if (typeof jsonStr !== 'string') return;

    try {
      const reply = JSON.parse(jsonStr);
      const data = reply.data;

      if (originalAddress === '/cue/playhead/text') {
        const newPlayhead = typeof data === 'string' ? data : '';
        if (newPlayhead !== this.playhead) {
          this.playhead = newPlayhead;
          this.emitFeedback('/playhead', [{ type: 's', value: this.playhead }]);
        }
      } else if (originalAddress === '/runningCues') {
        const cueNames = Array.isArray(data)
          ? data.map((c: any) => c.listName || c.name || c.number || '').filter(Boolean)
          : [];
        const prev = this.runningCues.join(',');
        this.runningCues = cueNames;
        if (cueNames.join(',') !== prev) {
          this.emitFeedback('/running', [{ type: 'i', value: cueNames.length }]);
          this.emitFeedback('/runningCues', [{ type: 's', value: cueNames.join(', ') }]);
        }
      }
    } catch {
      // Not JSON — ignore
    }
  }

  private sendOsc(address: string, args: any[]): void {
    if (!this.socket) return;
    try {
      const buf = osc.writeMessage({ address, args });
      this.socket.send(buf, 0, buf.length, this.port, this.host);
    } catch (err) {
      this.log(`Send error: ${err}`);
    }
  }

  private emitFeedback(address: string, args: any[]): void {
    const ev: FeedbackEvent = { address, args };
    this.emit('feedback', ev);
  }

  private toOscArg(value: any): any {
    if (typeof value === 'number') {
      return Number.isInteger(value) ? { type: 'i', value } : { type: 'f', value };
    }
    if (typeof value === 'string') return { type: 's', value };
    return value;
  }

  private log(msg: string): void {
    if (this.verbose) console.log(`[${this.name}] ${msg}`);
  }
}
