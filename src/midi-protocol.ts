/**
 * Allen & Heath Avantis MIDI Protocol
 *
 * Implements the Avantis MIDI TCP protocol for fader levels, mutes,
 * pan, aux sends, scene recall, and other mixer parameters.
 *
 * Reference: Avantis MIDI TCP Protocol V1.0
 *
 * NRPN Fader format:  BN 63 CH  BN 62 17  BN 06 LV
 *   N  = MIDI channel (0-15)
 *   CH = Strip number (hex, see channel tables)
 *   17 = Parameter 0x17 = fader level
 *   LV = Level value 0x00-0x7F (-inf to +10dB)
 *
 * Mute format: Note On with velocity >= 0x40 = mute ON, <= 0x3F = mute OFF
 *
 * TCP port: 51325
 */

import * as net from 'net';
import { EventEmitter } from 'events';

// --- Channel mapping tables ---
// Avantis strip numbers (hex) used as NRPN MSB (CC99 value).
// These map to the mixer's internal strip numbering.

export enum StripType {
  Input = 'input',
  Mix = 'mix',
  FXSend = 'fxsend',
  FXReturn = 'fxreturn',
  DCA = 'dca',
  Group = 'group',
  Matrix = 'matrix',
  Main = 'main',
}

export interface StripAddress {
  type: StripType;
  number: number; // 1-based user-facing number
}

// Bitfocus Companion-verified channel layout (5 channels from configurable base):
//   base+0: Inputs 1-64 (strip 0x00-0x3F)
//   base+1: Groups 1-40 (mono 0x00-0x27, stereo 0x40-0x53)
//   base+2: Aux/Mix 1-40 (mono 0x00-0x27, stereo 0x40-0x53)
//   base+3: Matrix 1-40 (mono 0x00-0x27, stereo 0x40-0x53)
//   base+4: FX Send (0x00-0x0B), FX Return (0x20-0x2B), Main (0x30-0x32),
//           DCA (0x36-0x45), Mute Groups (0x46-0x4D)

export const NRPN_PARAM = {
  FADER_LEVEL: 0x17,
  PAN: 0x18,     // Not officially documented for all models - verify
  ASSIGN: 0x19,  // Mix assignment on/off
} as const;

export interface AvantisStripMap {
  midiChannel: number;  // 0-indexed
  stripHex: number;     // NRPN MSB value for this strip
}

/**
 * Resolve a user-facing strip address to MIDI channel + strip hex.
 *
 * Bitfocus Companion-verified channel layout (5 channels from base):
 *   base+0: Inputs 1-64 (strip 0x00-0x3F)
 *   base+1: Groups 1-40 (mono 0x00-0x27, stereo 0x40-0x53)
 *   base+2: Aux/Mix 1-40 (mono 0x00-0x27, stereo 0x40-0x53)
 *   base+3: Matrix 1-40 (mono 0x00-0x27, stereo 0x40-0x53)
 *   base+4: FX Send (0x00-0x0B), FX Return (0x20-0x2B),
 *           Main (0x30 LR, 0x31 C, 0x32 mono),
 *           DCA (0x36-0x45), Mute Groups (0x46-0x4D)
 */
export function resolveStrip(strip: StripAddress, baseMidiChannel = 0): AvantisStripMap {
  const ch = baseMidiChannel;
  switch (strip.type) {
    case StripType.Input: {
      const n = strip.number;
      if (n < 1 || n > 64) throw new Error(`Input channel ${n} out of range (1-64)`);
      return { midiChannel: ch, stripHex: n - 1 };
    }
    case StripType.Group: {
      const n = strip.number;
      if (n < 1 || n > 40) throw new Error(`Group ${n} out of range (1-40)`);
      return { midiChannel: ch + 1, stripHex: n - 1 };
    }
    case StripType.Mix: {
      const n = strip.number;
      if (n < 1 || n > 40) throw new Error(`Mix ${n} out of range (1-40)`);
      return { midiChannel: ch + 2, stripHex: n - 1 };
    }
    case StripType.Matrix: {
      const n = strip.number;
      if (n < 1 || n > 40) throw new Error(`Matrix ${n} out of range (1-40)`);
      return { midiChannel: ch + 3, stripHex: n - 1 };
    }
    case StripType.FXSend: {
      const n = strip.number;
      if (n < 1 || n > 12) throw new Error(`FX Send ${n} out of range (1-12)`);
      return { midiChannel: ch + 4, stripHex: n - 1 };
    }
    case StripType.FXReturn: {
      const n = strip.number;
      if (n < 1 || n > 12) throw new Error(`FX Return ${n} out of range (1-12)`);
      return { midiChannel: ch + 4, stripHex: 0x20 + (n - 1) };
    }
    case StripType.Main: {
      return { midiChannel: ch + 4, stripHex: 0x30 };
    }
    case StripType.DCA: {
      const n = strip.number;
      if (n < 1 || n > 16) throw new Error(`DCA ${n} out of range (1-16)`);
      return { midiChannel: ch + 4, stripHex: 0x36 + (n - 1) };
    }
    default:
      throw new Error(`Unknown strip type: ${strip.type}`);
  }
}

/**
 * Reverse-resolve: given MIDI channel + strip hex, return the strip type & number.
 * Used for parsing incoming MIDI from the desk back into user-facing addresses.
 */
export function reverseResolveStrip(midiChannel: number, stripHex: number, baseMidiChannel = 0): StripAddress | null {
  const offset = midiChannel - baseMidiChannel;

  switch (offset) {
    case 0: // Inputs 1-64
      if (stripHex >= 0x00 && stripHex <= 0x3f) {
        return { type: StripType.Input, number: stripHex + 1 };
      }
      break;

    case 1: // Groups 1-40
      if (stripHex >= 0x00 && stripHex <= 0x27) {
        return { type: StripType.Group, number: stripHex + 1 };
      }
      break;

    case 2: // Mix/Aux 1-40
      if (stripHex >= 0x00 && stripHex <= 0x27) {
        return { type: StripType.Mix, number: stripHex + 1 };
      }
      break;

    case 3: // Matrix 1-40
      if (stripHex >= 0x00 && stripHex <= 0x27) {
        return { type: StripType.Matrix, number: stripHex + 1 };
      }
      break;

    case 4: // FX Send, FX Return, Main, DCA, Mute Groups
      if (stripHex >= 0x00 && stripHex <= 0x0b) {
        return { type: StripType.FXSend, number: stripHex + 1 };
      }
      if (stripHex >= 0x20 && stripHex <= 0x2b) {
        return { type: StripType.FXReturn, number: 1 + (stripHex - 0x20) };
      }
      if (stripHex >= 0x30 && stripHex <= 0x32) {
        return { type: StripType.Main, number: 1 };
      }
      if (stripHex >= 0x36 && stripHex <= 0x45) {
        return { type: StripType.DCA, number: 1 + (stripHex - 0x36) };
      }
      break;
  }

  return null;
}

/** Convert a StripAddress to an OSC address prefix like "/ch/1" or "/dca/3" */
export function stripToOSCPrefix(strip: StripAddress): string {
  switch (strip.type) {
    case StripType.Input:    return `/ch/${strip.number}`;
    case StripType.Mix:      return `/mix/${strip.number}`;
    case StripType.FXSend:   return `/fxsend/${strip.number}`;
    case StripType.FXReturn: return `/fxrtn/${strip.number}`;
    case StripType.DCA:      return `/dca/${strip.number}`;
    case StripType.Group:    return `/grp/${strip.number}`;
    case StripType.Matrix:   return `/mtx/${strip.number}`;
    case StripType.Main:     return '/main';
    default:                 return `/unknown/${strip.number}`;
  }
}

// --- MIDI message builders ---

/** Build NRPN fader level message bytes */
export function buildNRPNFader(midiChannel: number, stripHex: number, level: number): number[] {
  const status = 0xb0 | (midiChannel & 0x0f);
  const lv = Math.max(0, Math.min(0x7f, Math.round(level)));
  return [
    status, 99, stripHex & 0x7f,   // CC99 (NRPN MSB) = strip number
    status, 98, NRPN_PARAM.FADER_LEVEL, // CC98 (NRPN LSB) = 0x17
    status, 6, lv,                  // CC6 (Data Entry) = level
  ];
}

/** Build Note On message pair for mute control (mute + note-off release) */
export function buildMuteMessage(midiChannel: number, noteNumber: number, muteOn: boolean): number[] {
  const status = 0x90 | (midiChannel & 0x0f);
  const note = noteNumber & 0x7f;
  const velocity = muteOn ? 0x7f : 0x3f;
  return [status, note, velocity, status, note, 0x00];
}

/** Build Bank Select + Program Change for scene recall */
export function buildSceneRecall(midiChannel: number, sceneNumber: number): number[] {
  if (sceneNumber < 0 || sceneNumber >= 500) {
    throw new Error(`Scene number ${sceneNumber} out of range (0-499)`);
  }
  const bank = Math.floor(sceneNumber / 128);
  const program = sceneNumber % 128;
  const pcStatus = 0xc0 | (midiChannel & 0x0f);

  if (bank === 0) {
    return [pcStatus, program & 0x7f];
  }

  const ccStatus = 0xb0 | (midiChannel & 0x0f);
  return [ccStatus, 0x00, bank & 0x7f, pcStatus, program & 0x7f];
}

// --- Utility ---

/** Convert a float 0.0-1.0 to MIDI 0-127 */
export function floatToMidi(value: number): number {
  return Math.max(0, Math.min(127, Math.round(value * 127)));
}

/** Convert MIDI 0-127 to float 0.0-1.0 */
export function midiToFloat(value: number): number {
  return Math.max(0, Math.min(1, value / 127));
}

// --- TCP MIDI transport ---

export class AvantisTCPTransport extends EventEmitter {
  private socket: net.Socket | null = null;
  private host: string;
  private port: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  constructor(host: string, port = 51325) {
    super();
    this.host = host;
    this.port = port;
  }

  connect(): void {
    if (this.socket) {
      // Remove all listeners from the old socket before destroying it,
      // so its async 'close' event doesn't interfere with the new socket.
      this.socket.removeAllListeners();
      this.socket.destroy();
      this.socket = null;
    }

    const sock = new net.Socket();
    this.socket = sock;

    sock.on('connect', () => {
      // Guard: only handle events for the current socket
      if (this.socket !== sock) return;
      this.connected = true;
      this.emit('connected');
      console.log(`[MIDI TCP] Connected to Avantis at ${this.host}:${this.port}`);
    });

    sock.on('data', (data: Buffer) => {
      if (this.socket !== sock) return;
      this.emit('data', data);
    });

    sock.on('error', (err: Error) => {
      if (this.socket !== sock) return;
      console.error(`[MIDI TCP] Connection error: ${err.message}`);
      this.emit('error', err);
    });

    sock.on('close', () => {
      if (this.socket !== sock) return;
      this.connected = false;
      this.emit('disconnected');
      console.log('[MIDI TCP] Disconnected from Avantis');
      this.scheduleReconnect();
    });

    sock.connect(this.port, this.host);
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      console.log('[MIDI TCP] Attempting reconnect...');
      this.connect();
    }, 3000);
  }

  send(bytes: number[]): void {
    if (!this.socket || !this.connected) {
      console.warn('[MIDI TCP] Not connected, dropping message');
      return;
    }
    this.socket.write(Buffer.from(bytes));
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
