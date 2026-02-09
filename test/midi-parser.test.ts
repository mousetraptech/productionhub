import { describe, it, expect, vi } from 'vitest';
import { MIDIStreamParser, MIDIEvent } from '../src/midi-parser';

function collectEvents(parser: MIDIStreamParser, data: number[]): MIDIEvent[] {
  const events: MIDIEvent[] = [];
  parser.on('midi', (e: MIDIEvent) => events.push(e));
  parser.feed(Buffer.from(data));
  parser.removeAllListeners('midi');
  return events;
}

describe('MIDIStreamParser', () => {
  describe('Note On parsing', () => {
    it('parses a single Note On', () => {
      const parser = new MIDIStreamParser();
      const events = collectEvents(parser, [0x9b, 0x05, 0x7f]);
      expect(events).toEqual([{
        type: 'noteon',
        channel: 11,
        note: 5,
        velocity: 0x7f,
      }]);
    });

    it('parses consecutive Note Ons with running status', () => {
      const parser = new MIDIStreamParser();
      // First: status + 2 data bytes, then running status: just 2 data bytes
      const events = collectEvents(parser, [
        0x9b, 0x05, 0x7f,  // Note On ch11 note=5 vel=127
        0x06, 0x00,         // Running status: note=6 vel=0
      ]);
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: 'noteon', channel: 11, note: 5, velocity: 0x7f });
      expect(events[1]).toEqual({ type: 'noteon', channel: 11, note: 6, velocity: 0 });
    });
  });

  describe('NRPN parsing', () => {
    it('parses a complete NRPN sequence (CC99 -> CC98 -> CC6)', () => {
      const parser = new MIDIStreamParser();
      const events = collectEvents(parser, [
        0xbb, 99, 0x00,  // CC99 = strip 0
        0xbb, 98, 0x17,  // CC98 = fader level param
        0xbb, 6, 0x64,   // CC6 = value 100
      ]);
      expect(events).toEqual([{
        type: 'nrpn',
        channel: 11,
        paramMSB: 0x00,
        paramLSB: 0x17,
        value: 0x64,
      }]);
    });

    it('parses NRPN with running status', () => {
      const parser = new MIDIStreamParser();
      // Status byte only sent once, then running status for all CCs
      const events = collectEvents(parser, [
        0xbb, 99, 0x05,  // CC99 = strip 5
        98, 0x17,         // running status: CC98 = fader level
        6, 0x40,          // running status: CC6 = value 64
      ]);
      expect(events).toEqual([{
        type: 'nrpn',
        channel: 11,
        paramMSB: 0x05,
        paramLSB: 0x17,
        value: 0x40,
      }]);
    });

    it('parses consecutive NRPN for different strips with running status', () => {
      const parser = new MIDIStreamParser();
      const events = collectEvents(parser, [
        0xbb, 99, 0x00, 98, 0x17, 6, 0x64,  // strip 0, fader, val 100
        99, 0x01, 98, 0x17, 6, 0x32,          // strip 1, fader, val 50
      ]);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('nrpn');
      expect((events[0] as any).paramMSB).toBe(0x00);
      expect((events[0] as any).value).toBe(0x64);
      expect(events[1].type).toBe('nrpn');
      expect((events[1] as any).paramMSB).toBe(0x01);
      expect((events[1] as any).value).toBe(0x32);
    });
  });

  describe('Program Change parsing', () => {
    it('parses a Program Change', () => {
      const parser = new MIDIStreamParser();
      const events = collectEvents(parser, [0xcb, 0x2a]);
      expect(events).toEqual([{
        type: 'pc',
        channel: 11,
        program: 42,
      }]);
    });
  });

  describe('edge cases', () => {
    it('handles chunked data across multiple feed() calls', () => {
      const parser = new MIDIStreamParser();
      const events: MIDIEvent[] = [];
      parser.on('midi', (e: MIDIEvent) => events.push(e));

      // Split a Note On across two chunks
      parser.feed(Buffer.from([0x9b, 0x05]));
      expect(events).toHaveLength(0); // incomplete

      parser.feed(Buffer.from([0x7f]));
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'noteon', channel: 11, note: 5, velocity: 0x7f });
    });

    it('ignores system realtime bytes', () => {
      const parser = new MIDIStreamParser();
      const events = collectEvents(parser, [
        0x9b, 0xf8, 0x05, 0x7f, // Clock byte 0xF8 in middle of Note On
      ]);
      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: 'noteon', channel: 11, note: 5, velocity: 0x7f });
    });

    it('drops data bytes without prior status', () => {
      const parser = new MIDIStreamParser();
      const events = collectEvents(parser, [0x40, 0x50]); // data bytes, no status
      expect(events).toHaveLength(0);
    });

    it('resets running status on system common messages', () => {
      const parser = new MIDIStreamParser();
      const events = collectEvents(parser, [
        0x9b, 0x05, 0x7f, // Note On
        0xf0,             // SysEx start — resets running status
        0x40, 0x50,       // These should be dropped (no running status)
      ]);
      expect(events).toHaveLength(1);
    });
  });
});
