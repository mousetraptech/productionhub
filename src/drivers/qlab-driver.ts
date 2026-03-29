/**
 * QLab Device Driver (TCP + SLIP)
 *
 * Connects to QLab 5 via TCP with SLIP framing for bidirectional OSC.
 * Sends commands, receives replies and push updates.
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
import * as net from 'net';
import * as osc from 'osc';
import { DeviceConfig, DeviceDriver, HubContext, FeedbackEvent } from './device-driver';
import { ReconnectQueue } from './reconnect-queue';
import { getLogger } from '../logger';

const log = getLogger('QLab');

// SLIP framing constants
const SLIP_END = 0xC0;
const SLIP_ESC = 0xDB;
const SLIP_ESC_END = 0xDC;
const SLIP_ESC_ESC = 0xDD;

export interface QLabCue {
  uniqueID: string;
  number: string;
  name: string;
  type: string;
}

export interface QLabConfig extends DeviceConfig {
  type: 'qlab';
  passcode?: string;
}

function slipEncode(data: Buffer): Buffer {
  const out: number[] = [SLIP_END];
  for (const b of data) {
    if (b === SLIP_END) { out.push(SLIP_ESC, SLIP_ESC_END); }
    else if (b === SLIP_ESC) { out.push(SLIP_ESC, SLIP_ESC_ESC); }
    else { out.push(b); }
  }
  out.push(SLIP_END);
  return Buffer.from(out);
}

export class QLabDriver extends EventEmitter implements DeviceDriver {
  readonly name: string;
  readonly prefix: string;
  private host: string;
  private port: number;
  private passcode: string;
  private tcpSocket: net.Socket | null = null;
  private connected = false;
  private verbose: boolean;
  private queue = new ReconnectQueue<{ address: string; args: any[] }>(64);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private slipBuf: number[] = [];
  private inEscape = false;

  // State
  private playhead = '';
  private runningCues: string[] = [];
  private cues: QLabCue[] = [];

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
    const socket = new net.Socket();
    this.tcpSocket = socket;

    socket.connect(this.port, this.host, () => {
      log.info({ host: this.host, port: this.port }, 'TCP connected');

      if (this.passcode) {
        this.sendOsc('/connect', [{ type: 's', value: this.passcode }]);
      } else {
        this.sendOsc('/connect', []);
      }
      this.sendOsc('/updates', [{ type: 'i', value: 1 }]);

      this.connected = true;
      this.emit('connected');

      // Fetch cue lists from workspace
      this.sendOsc('/cueLists', []);

      // Replay any messages queued during disconnect
      const queued = this.queue.flush();
      for (const item of queued) {
        this.handleOSC(item.address, item.args);
      }

      this.pollTimer = setInterval(() => this.poll(), 2000);
      this.pollTimer.unref();
    });

    socket.on('data', (data: Buffer) => {
      this.processSLIP(data);
    });

    socket.on('error', (err: Error) => {
      log.error({ err: err.message }, 'TCP error');
      this.emit('error', err);
    });

    socket.on('close', () => {
      if (this.tcpSocket === socket) {
        log.info('TCP closed');
        this.tcpSocket = null;
        this.connected = false;
        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }
        this.emit('disconnected');
      }
    });
  }

  disconnect(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.tcpSocket) {
      this.tcpSocket.destroy();
      this.tcpSocket = null;
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
    if (this.verbose) log.debug({ address, args }, 'TX');
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
      cues: this.cues,
    };
  }

  private poll(): void {
    if (!this.connected) return;
    this.sendOsc('/cue/playhead/text', []);
    this.sendOsc('/runningCues', []);
  }

  /** Process incoming TCP data through SLIP decoder */
  private processSLIP(data: Buffer): void {
    for (const byte of data) {
      if (this.inEscape) {
        this.inEscape = false;
        if (byte === SLIP_ESC_END) this.slipBuf.push(SLIP_END);
        else if (byte === SLIP_ESC_ESC) this.slipBuf.push(SLIP_ESC);
        else this.slipBuf.push(byte); // malformed, pass through
      } else if (byte === SLIP_ESC) {
        this.inEscape = true;
      } else if (byte === SLIP_END) {
        if (this.slipBuf.length > 0) {
          this.handleFrame(Buffer.from(this.slipBuf));
          this.slipBuf = [];
        }
        // Empty frame between END markers is normal — ignore
      } else {
        this.slipBuf.push(byte);
      }
    }
  }

  /** Handle a complete SLIP-decoded OSC frame */
  private handleFrame(frame: Buffer): void {
    try {
      const packet = osc.readMessage(frame, { metadata: true });
      if (packet.address) {
        this.handleReply(packet.address, packet.args || []);
      }
    } catch (err) {
      if (this.verbose) log.debug({ err, len: frame.length }, 'Frame parse error');
    }
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
      } else if (originalAddress === '/cueLists') {
        const cueLists = Array.isArray(data) ? data : [];
        const flat: QLabCue[] = [];
        const walk = (cues: any[]) => {
          for (const c of cues) {
            if (c.number || c.name) {
              flat.push({
                uniqueID: c.uniqueID ?? '',
                number: c.number ?? '',
                name: c.name ?? '',
                type: c.type ?? '',
              });
            }
            if (Array.isArray(c.cues)) walk(c.cues);
          }
        };
        for (const list of cueLists) {
          if (Array.isArray(list.cues)) walk(list.cues);
        }
        this.cues = flat;
        log.info({ count: flat.length }, 'Loaded cues from workspace');
        this.emitFeedback('/cues', [{ type: 's', value: JSON.stringify(flat) }]);
      } else if (originalAddress === '/connect') {
        log.info({ workspace: reply.workspace_id }, 'QLab handshake OK');
      }
    } catch {
      // Not JSON — ignore
    }
  }

  private sendOsc(address: string, args: any[]): void {
    if (!this.tcpSocket || this.tcpSocket.destroyed) return;
    try {
      const msgBuf = Buffer.from(osc.writeMessage({ address, args }));
      this.tcpSocket.write(slipEncode(msgBuf));
    } catch (err) {
      log.error({ err, address }, 'Send error');
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
}
