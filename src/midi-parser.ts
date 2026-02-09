/**
 * MIDI Stream Parser
 *
 * Parses a raw byte stream from the Avantis TCP connection into
 * discrete MIDI messages. Handles MIDI running status — the Avantis
 * omits repeated status bytes for efficiency.
 *
 * Emits typed MIDI events that the bridge can translate back to OSC.
 */

import { EventEmitter } from 'events';
import { NRPN_PARAM } from './midi-protocol';

// --- Parsed MIDI event types ---

export interface MIDINRPNEvent {
  type: 'nrpn';
  channel: number;     // 0-indexed
  paramMSB: number;    // CC99 value (strip number)
  paramLSB: number;    // CC98 value (parameter type)
  value: number;       // CC6 value
}

export interface MIDINoteOnEvent {
  type: 'noteon';
  channel: number;     // 0-indexed
  note: number;
  velocity: number;
}

export interface MIDIProgramChangeEvent {
  type: 'pc';
  channel: number;     // 0-indexed
  program: number;
}

export type MIDIEvent = MIDINRPNEvent | MIDINoteOnEvent | MIDIProgramChangeEvent;

// --- NRPN accumulator state per channel ---

interface NRPNState {
  paramMSB?: number;   // CC99
  paramLSB?: number;   // CC98
}

export class MIDIStreamParser extends EventEmitter {
  private lastStatus = 0;
  private buffer: number[] = [];
  private nrpnState: Map<number, NRPNState> = new Map();

  /**
   * Feed raw bytes from TCP. Can be called with any chunk size —
   * the parser handles partial messages across calls.
   */
  feed(data: Buffer): void {
    for (let i = 0; i < data.length; i++) {
      this.processByte(data[i]);
    }
  }

  reset(): void {
    this.lastStatus = 0;
    this.buffer = [];
    this.nrpnState.clear();
  }

  private processByte(byte: number): void {
    // System real-time messages (0xF8-0xFF) can appear anywhere, ignore them
    if (byte >= 0xf8) return;

    // System common messages (0xF0-0xF7) — reset running status
    if (byte >= 0xf0 && byte <= 0xf7) {
      // SysEx or system common — skip for now
      this.lastStatus = 0;
      this.buffer = [];
      return;
    }

    if (byte & 0x80) {
      // Status byte
      this.lastStatus = byte;
      this.buffer = [byte];
    } else {
      // Data byte — use running status if no status in buffer
      if (this.buffer.length === 0) {
        if (this.lastStatus === 0) return; // no status context, drop
        this.buffer = [this.lastStatus];
      }
      this.buffer.push(byte);
    }

    this.tryParse();
  }

  private tryParse(): void {
    if (this.buffer.length === 0) return;

    const status = this.buffer[0];
    const msgType = status & 0xf0;
    const channel = status & 0x0f;

    switch (msgType) {
      case 0x90: // Note On
        if (this.buffer.length >= 3) {
          this.emit('midi', {
            type: 'noteon',
            channel,
            note: this.buffer[1],
            velocity: this.buffer[2],
          } as MIDINoteOnEvent);
          this.buffer = [];
        }
        break;

      case 0xb0: // Control Change
        if (this.buffer.length >= 3) {
          this.handleCC(channel, this.buffer[1], this.buffer[2]);
          this.buffer = [];
        }
        break;

      case 0xc0: // Program Change (1 data byte)
        if (this.buffer.length >= 2) {
          this.emit('midi', {
            type: 'pc',
            channel,
            program: this.buffer[1],
          } as MIDIProgramChangeEvent);
          this.buffer = [];
        }
        break;

      case 0x80: // Note Off — 2 data bytes, consume and ignore
      case 0xa0: // Poly aftertouch
      case 0xe0: // Pitch bend
        if (this.buffer.length >= 3) {
          this.buffer = [];
        }
        break;

      case 0xd0: // Channel aftertouch (1 data byte)
        if (this.buffer.length >= 2) {
          this.buffer = [];
        }
        break;

      default:
        // Unknown, drop
        this.buffer = [];
        break;
    }
  }

  /**
   * Accumulate NRPN CC messages. The Avantis sends:
   *   CC99 (MSB) -> CC98 (LSB) -> CC6 (Data Entry)
   * We emit a complete NRPN event once CC6 arrives.
   */
  private handleCC(channel: number, cc: number, value: number): void {
    let state = this.nrpnState.get(channel);
    if (!state) {
      state = {};
      this.nrpnState.set(channel, state);
    }

    switch (cc) {
      case 99: // NRPN MSB
        state.paramMSB = value;
        state.paramLSB = undefined; // reset LSB on new MSB
        break;

      case 98: // NRPN LSB
        state.paramLSB = value;
        break;

      case 6: // Data Entry MSB
        if (state.paramMSB !== undefined && state.paramLSB !== undefined) {
          this.emit('midi', {
            type: 'nrpn',
            channel,
            paramMSB: state.paramMSB,
            paramLSB: state.paramLSB,
            value,
          } as MIDINRPNEvent);
          // Don't clear state — allows for running-status repeated CC6
        }
        break;

      default:
        // Other CC — emit as-is if we ever need it
        break;
    }
  }
}
