/**
 * VISCA over IP Device Driver
 *
 * Controls PTZ cameras via the VISCA-over-IP protocol over UDP.
 * Each camera gets its own driver instance with a unique prefix.
 *
 * VISCA-over-IP wraps standard VISCA commands in an 8-byte UDP header:
 *   Bytes 0-1: Payload type (0x01 0x00 = command)
 *   Bytes 2-3: Payload length (big-endian uint16)
 *   Bytes 4-7: Sequence number (big-endian uint32, incrementing)
 *   Bytes 8+:  Raw VISCA payload
 *
 * Standard port: 52381 (UDP)
 *
 * OSC namespace (after prefix stripping):
 *   /preset/recall/{N}       Recall preset N (0-127, standard VISCA 7-bit)
 *   /preset/store/{N}        Store preset N (0-127)
 *   /home                    Move to home position
 *   /pan/speed               float -1.0 to 1.0 (negative = left)
 *   /tilt/speed              float -1.0 to 1.0 (negative = down)
 *   /zoom/speed              float -1.0 to 1.0 (negative = wide)
 *   /zoom/direct             float 0.0-1.0 (absolute zoom position)
 *   /pantilt/stop            Stop pan/tilt movement
 *   /power/on                Power on
 *   /power/off               Power off/standby
 *   /focus/auto              Auto focus
 *   /focus/manual             Manual focus
 *
 * VISCA command format:
 *   Address: 0x81 (camera 1), 0x82 (camera 2), etc.
 *   Terminator: 0xFF
 *
 * Common commands:
 *   Preset Recall:  81 01 04 3F 02 pp FF
 *   Preset Store:   81 01 04 3F 01 pp FF
 *   Home:           81 01 06 04 FF
 *   Pan/Tilt:       81 01 06 01 VV WW 03 01 FF  (VV=panSpeed, WW=tiltSpeed)
 *   PT Stop:        81 01 06 01 VV WW 03 03 FF
 *   Zoom Tele:      81 01 04 07 2p FF  (p=speed 0-7)
 *   Zoom Wide:      81 01 04 07 3p FF
 *   Zoom Stop:      81 01 04 07 00 FF
 *   Power On:       81 01 04 00 02 FF
 *   Power Off:      81 01 04 00 03 FF
 */

import { EventEmitter } from 'events';
import * as dgram from 'dgram';
import { DeviceDriver, DeviceConfig, HubContext } from './device-driver';
import { getFloat } from './osc-args';
import { ReconnectQueue } from './reconnect-queue';

/** VISCA-over-IP payload types */
const VISCA_IP_COMMAND = 0x0100;   // Command payload
const VISCA_IP_INQUIRY = 0x0110;   // Inquiry payload
const VISCA_IP_REPLY   = 0x0111;   // Reply payload

export interface VISCAConfig extends DeviceConfig {
  type: 'visca';
  cameraAddress?: number; // 1-7, default 1 (maps to 0x80 + N)
}

export class VISCADriver extends EventEmitter implements DeviceDriver {
  readonly name: string;
  readonly prefix: string;

  private host: string;
  private port: number;
  private cameraAddr: number;  // VISCA address byte (0x81 for camera 1)
  private socket: dgram.Socket | null = null;
  private connected: boolean = false;
  private reconnectQueue = new ReconnectQueue<{ address: string; args: any[] }>();
  private verbose: boolean;
  private sequenceNumber: number = 0;

  constructor(config: VISCAConfig, _hubContext: HubContext, verbose = false) {
    super();
    this.name = config.name ?? 'visca';
    this.prefix = config.prefix;
    this.host = config.host;
    this.port = config.port;
    this.cameraAddr = 0x80 + (config.cameraAddress ?? 1);
    this.verbose = verbose;
  }

  connect(): void {
    if (this.socket) {
      try { this.socket.close(); } catch (_) { /* ignore */ }
    }

    this.socket = dgram.createSocket('udp4');
    this.sequenceNumber = 0;

    this.socket.on('error', (err: Error) => {
      console.error(`[VISCA] UDP error: ${err.message}`);
      this.emit('error', err);
    });

    this.socket.on('message', (data: Buffer) => {
      // VISCA-over-IP replies have the same 8-byte header + VISCA payload
      if (this.verbose) {
        console.log(`[VISCA] <- ${data.toString('hex')}`);
      }
    });

    this.socket.on('listening', () => {
      // UDP is connectionless — mark as connected once socket is bound
      this.connected = true;
      this.emit('connected');
      if (this.verbose) {
        console.log(`[VISCA] UDP ready, target ${this.host}:${this.port}`);
      }
      this.flushQueue();
    });

    // Bind to any available local port
    this.socket.bind(0);
  }

  disconnect(): void {
    if (this.socket) {
      try { this.socket.close(); } catch (_) { /* ignore */ }
      this.socket = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Handle incoming OSC (prefix already stripped).
   */
  handleOSC(address: string, args: any[]): void {
    if (!this.connected) {
      this.reconnectQueue.push({ address, args });
      if (this.verbose) console.warn(`[VISCA] Not connected, queued message (${this.reconnectQueue.size} in queue)`);
      return;
    }

    const addr = address.toLowerCase().replace(/\/$/, '');
    const parts = addr.split('/').filter(Boolean);

    if (parts.length === 0) return;

    switch (parts[0]) {
      case 'preset':
        this.handlePreset(parts.slice(1), args);
        break;
      case 'home':
        this.sendVISCA([this.cameraAddr, 0x01, 0x06, 0x04, 0xff]);
        break;
      case 'pan':
        if (parts[1] === 'speed') {
          this.handlePanSpeed(getFloat(args));
        }
        break;
      case 'tilt':
        if (parts[1] === 'speed') {
          this.handleTiltSpeed(getFloat(args));
        }
        break;
      case 'pantilt':
        if (parts[1] === 'stop') {
          this.sendPanTilt(0, 0, true);
        } else if (parts[1] === 'speed') {
          // /pantilt/speed pan tilt (two args)
          const panSpeed = getFloat(args);
          const tiltSpeed = getFloat(args, 1);
          this.sendPanTilt(panSpeed, tiltSpeed);
        }
        break;
      case 'zoom':
        this.handleZoom(parts.slice(1), args);
        break;
      case 'power':
        if (parts[1] === 'on') {
          this.sendVISCA([this.cameraAddr, 0x01, 0x04, 0x00, 0x02, 0xff]);
        } else if (parts[1] === 'off') {
          this.sendVISCA([this.cameraAddr, 0x01, 0x04, 0x00, 0x03, 0xff]);
        }
        break;
      case 'focus':
        if (parts[1] === 'auto') {
          this.sendVISCA([this.cameraAddr, 0x01, 0x04, 0x38, 0x02, 0xff]);
        } else if (parts[1] === 'manual') {
          this.sendVISCA([this.cameraAddr, 0x01, 0x04, 0x38, 0x03, 0xff]);
        }
        break;
      default:
        if (this.verbose) console.warn(`[VISCA] Unrecognized: ${address}`);
    }
  }

  /** VISCA cameras don't use the fade engine */
  handleFadeTick(_key: string, _value: number): void {
    // No-op
  }

  /** Replay queued messages after reconnect */
  private flushQueue(): void {
    const queued = this.reconnectQueue.flush();
    if (queued.length === 0) return;
    console.log(`[VISCA] Replaying ${queued.length} queued message(s)`);
    for (const msg of queued) {
      this.handleOSC(msg.address, msg.args);
    }
  }

  // --- Command builders ---

  private handlePreset(parts: string[], args: any[]): void {
    if (parts.length < 2) return;
    const presetNum = parseInt(parts[1], 10);
    if (isNaN(presetNum) || presetNum < 0 || presetNum > 127) {
      console.warn(`[VISCA] Preset number out of range (0-127): ${parts[1]}`);
      return;
    }

    if (parts[0] === 'recall') {
      // 81 01 04 3F 02 pp FF
      this.sendVISCA([this.cameraAddr, 0x01, 0x04, 0x3f, 0x02, presetNum, 0xff]);
      if (this.verbose) console.log(`[VISCA] Preset recall ${presetNum}`);
    } else if (parts[0] === 'store') {
      // 81 01 04 3F 01 pp FF
      this.sendVISCA([this.cameraAddr, 0x01, 0x04, 0x3f, 0x01, presetNum, 0xff]);
      if (this.verbose) console.log(`[VISCA] Preset store ${presetNum}`);
    }
  }

  /** Pan speed: -1.0 (left) to +1.0 (right), 0 = stop */
  private panSpeedAccum: number = 0;
  /** Tilt speed: -1.0 (down) to +1.0 (up), 0 = stop */
  private tiltSpeedAccum: number = 0;

  private handlePanSpeed(speed: number): void {
    this.panSpeedAccum = speed;
    this.sendPanTilt(this.panSpeedAccum, this.tiltSpeedAccum);
  }

  private handleTiltSpeed(speed: number): void {
    this.tiltSpeedAccum = speed;
    this.sendPanTilt(this.panSpeedAccum, this.tiltSpeedAccum);
  }

  /**
   * Send combined pan/tilt command.
   * VISCA PT Drive: 81 01 06 01 VV WW DD1 DD2 FF
   *   VV = pan speed 01-18
   *   WW = tilt speed 01-14
   *   DD1 = horizontal direction: 01=left, 02=right, 03=stop
   *   DD2 = vertical direction:   01=up, 02=down, 03=stop
   */
  private sendPanTilt(panSpeed: number, tiltSpeed: number, forceStop = false): void {
    if (forceStop || (panSpeed === 0 && tiltSpeed === 0)) {
      // Stop
      this.sendVISCA([this.cameraAddr, 0x01, 0x06, 0x01, 0x01, 0x01, 0x03, 0x03, 0xff]);
      return;
    }

    const panDir = panSpeed < 0 ? 0x01 : panSpeed > 0 ? 0x02 : 0x03;
    const tiltDir = tiltSpeed > 0 ? 0x01 : tiltSpeed < 0 ? 0x02 : 0x03;

    // Map float magnitude 0-1 to VISCA speed range
    const vv = Math.max(1, Math.min(0x18, Math.round(Math.abs(panSpeed) * 0x18)));
    const ww = Math.max(1, Math.min(0x14, Math.round(Math.abs(tiltSpeed) * 0x14)));

    this.sendVISCA([this.cameraAddr, 0x01, 0x06, 0x01, vv, ww, panDir, tiltDir, 0xff]);
  }

  private handleZoom(parts: string[], args: any[]): void {
    if (parts.length === 0) return;

    if (parts[0] === 'speed') {
      const speed = getFloat(args);
      if (speed === 0) {
        // Zoom stop
        this.sendVISCA([this.cameraAddr, 0x01, 0x04, 0x07, 0x00, 0xff]);
      } else if (speed > 0) {
        // Zoom tele (in): 81 01 04 07 2p FF (p = 0-7)
        const p = Math.min(7, Math.round(speed * 7));
        this.sendVISCA([this.cameraAddr, 0x01, 0x04, 0x07, 0x20 | p, 0xff]);
      } else {
        // Zoom wide (out): 81 01 04 07 3p FF
        const p = Math.min(7, Math.round(Math.abs(speed) * 7));
        this.sendVISCA([this.cameraAddr, 0x01, 0x04, 0x07, 0x30 | p, 0xff]);
      }
    } else if (parts[0] === 'stop') {
      this.sendVISCA([this.cameraAddr, 0x01, 0x04, 0x07, 0x00, 0xff]);
    } else if (parts[0] === 'direct') {
      // Direct zoom position: 81 01 04 47 0p 0q 0r 0s FF
      // where pqrs is a 16-bit zoom value 0x0000-0x4000
      const val = Math.max(0, Math.min(1, getFloat(args)));
      const zoomPos = Math.round(val * 0x4000);
      const p = (zoomPos >> 12) & 0x0f;
      const q = (zoomPos >> 8) & 0x0f;
      const r = (zoomPos >> 4) & 0x0f;
      const s = zoomPos & 0x0f;
      this.sendVISCA([this.cameraAddr, 0x01, 0x04, 0x47, p, q, r, s, 0xff]);
    }
  }

  // --- Transport ---

  /**
   * Wrap a raw VISCA command in a VISCA-over-IP header and send via UDP.
   *
   * Header format (8 bytes):
   *   Bytes 0-1: Payload type (0x01 0x00 = command)
   *   Bytes 2-3: Payload length (big-endian uint16)
   *   Bytes 4-7: Sequence number (big-endian uint32)
   */
  private sendVISCA(payload: number[]): void {
    if (!this.socket || !this.connected) {
      if (this.verbose) console.warn('[VISCA] Not connected, dropping command');
      return;
    }

    const payloadLen = payload.length;
    const seq = this.sequenceNumber++;

    // Build 8-byte header + payload
    const buf = Buffer.alloc(8 + payloadLen);
    buf.writeUInt16BE(VISCA_IP_COMMAND, 0);   // Payload type: command
    buf.writeUInt16BE(payloadLen, 2);          // Payload length
    buf.writeUInt32BE(seq, 4);                 // Sequence number
    for (let i = 0; i < payloadLen; i++) {
      buf[8 + i] = payload[i];
    }

    this.socket.send(buf, 0, buf.length, this.port, this.host, (err) => {
      if (err) {
        console.error(`[VISCA] Send error: ${err.message}`);
        this.emit('error', err);
      }
    });

    if (this.verbose) {
      console.log(`[VISCA] -> seq=${seq} ${payload.map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
    }
  }

}
