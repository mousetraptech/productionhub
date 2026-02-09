import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MIDIStreamParser, MIDIEvent, MIDINRPNEvent, MIDINoteOnEvent, MIDIProgramChangeEvent } from '../midi-parser';

describe('MIDIStreamParser', () => {
  let parser: MIDIStreamParser;

  // Helper to capture emitted events
  function captureEvents(count: number = 1): Promise<MIDIEvent[]> {
    return new Promise((resolve) => {
      const events: MIDIEvent[] = [];
      let remaining = count;

      const handler = (event: MIDIEvent) => {
        events.push(event);
        remaining--;
        if (remaining === 0) {
          parser.removeListener('midi', handler);
          resolve(events);
        }
      };

      parser.on('midi', handler);

      // Safety timeout to prevent hanging tests
      setTimeout(() => {
        parser.removeListener('midi', handler);
        resolve(events);
      }, 100);
    });
  }

  describe('NRPN parsing', () => {
    it('should parse a complete NRPN sequence', async () => {
      parser = new MIDIStreamParser();
      const capture = captureEvents(1);

      // NRPN for fader on ch 11: CC99=0x05, CC98=0x17, CC6=0x64
      const nrpnBytes = Buffer.from([0xBB, 99, 0x05, 0xBB, 98, 0x17, 0xBB, 6, 0x64]);
      parser.feed(nrpnBytes);

      const events = await capture;
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'nrpn');

      const nrpnEvent = events[0] as MIDINRPNEvent;
      assert.strictEqual(nrpnEvent.channel, 11);
      assert.strictEqual(nrpnEvent.paramMSB, 0x05);
      assert.strictEqual(nrpnEvent.paramLSB, 0x17);
      assert.strictEqual(nrpnEvent.value, 0x64);
    });
  });

  describe('Note On parsing', () => {
    it('should parse a Note On message', async () => {
      parser = new MIDIStreamParser();
      const capture = captureEvents(1);

      // Note On on channel 11, note 5, velocity 127
      const noteOnBytes = Buffer.from([0x9B, 0x05, 0x7F]);
      parser.feed(noteOnBytes);

      const events = await capture;
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'noteon');

      const noteEvent = events[0] as MIDINoteOnEvent;
      assert.strictEqual(noteEvent.channel, 11);
      assert.strictEqual(noteEvent.note, 0x05);
      assert.strictEqual(noteEvent.velocity, 0x7F);
    });
  });

  describe('Program Change parsing', () => {
    it('should parse a Program Change message', async () => {
      parser = new MIDIStreamParser();
      const capture = captureEvents(1);

      // Program Change on channel 11, program 42
      const pcBytes = Buffer.from([0xCB, 42]);
      parser.feed(pcBytes);

      const events = await capture;
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'pc');

      const pcEvent = events[0] as MIDIProgramChangeEvent;
      assert.strictEqual(pcEvent.channel, 11);
      assert.strictEqual(pcEvent.program, 42);
    });
  });

  describe('Running status', () => {
    it('should handle running status in NRPN sequences', async () => {
      parser = new MIDIStreamParser();
      const capture = captureEvents(1);

      // Send CC99 with status byte
      parser.feed(Buffer.from([0xBB, 99, 0x05]));

      // Send CC98 without status byte (running status)
      parser.feed(Buffer.from([98, 0x17]));

      // Send CC6 without status byte (running status)
      parser.feed(Buffer.from([6, 0x64]));

      const events = await capture;
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'nrpn');

      const nrpnEvent = events[0] as MIDINRPNEvent;
      assert.strictEqual(nrpnEvent.channel, 11);
      assert.strictEqual(nrpnEvent.paramMSB, 0x05);
      assert.strictEqual(nrpnEvent.paramLSB, 0x17);
      assert.strictEqual(nrpnEvent.value, 0x64);
    });
  });

  describe('TCP stream splitting', () => {
    it('should handle NRPN bytes split across multiple feed() calls', async () => {
      parser = new MIDIStreamParser();
      const capture = captureEvents(1);

      // Send NRPN bytes one at a time
      parser.feed(Buffer.from([0xBB])); // Status
      parser.feed(Buffer.from([99]));  // CC number
      parser.feed(Buffer.from([0x05])); // Value

      parser.feed(Buffer.from([0xBB])); // Status
      parser.feed(Buffer.from([98]));  // CC number
      parser.feed(Buffer.from([0x17])); // Value

      parser.feed(Buffer.from([0xBB])); // Status
      parser.feed(Buffer.from([6]));   // CC number
      parser.feed(Buffer.from([0x64])); // Value

      const events = await capture;
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'nrpn');

      const nrpnEvent = events[0] as MIDINRPNEvent;
      assert.strictEqual(nrpnEvent.channel, 11);
      assert.strictEqual(nrpnEvent.paramMSB, 0x05);
      assert.strictEqual(nrpnEvent.paramLSB, 0x17);
      assert.strictEqual(nrpnEvent.value, 0x64);
    });
  });

  describe('Multiple messages in one packet', () => {
    it('should parse two Note On messages in a single buffer', async () => {
      parser = new MIDIStreamParser();
      const capture = captureEvents(2);

      // Two Note On messages: ch 11 note 5 vel 127, ch 11 note 7 vel 64
      const twoNotesBytes = Buffer.from([0x9B, 0x05, 0x7F, 0x9B, 0x07, 0x40]);
      parser.feed(twoNotesBytes);

      const events = await capture;
      assert.strictEqual(events.length, 2);

      const note1 = events[0] as MIDINoteOnEvent;
      assert.strictEqual(note1.type, 'noteon');
      assert.strictEqual(note1.channel, 11);
      assert.strictEqual(note1.note, 0x05);
      assert.strictEqual(note1.velocity, 0x7F);

      const note2 = events[1] as MIDINoteOnEvent;
      assert.strictEqual(note2.type, 'noteon');
      assert.strictEqual(note2.channel, 11);
      assert.strictEqual(note2.note, 0x07);
      assert.strictEqual(note2.velocity, 0x40);
    });
  });

  describe('Rapid NRPN fader moves', () => {
    it('should emit separate NRPN events for multiple CC6 values', async () => {
      parser = new MIDIStreamParser();
      const capture = captureEvents(3);

      // CC99 and CC98 setup, then three rapid CC6 values
      const rapidMoveBytes = Buffer.from([
        0xBB, 99, 0x05,   // CC99
        0xBB, 98, 0x17,   // CC98
        0xBB, 6, 0x20,    // CC6 value 1
        0xBB, 6, 0x40,    // CC6 value 2
        0xBB, 6, 0x60,    // CC6 value 3
      ]);
      parser.feed(rapidMoveBytes);

      const events = await capture;
      assert.strictEqual(events.length, 3);

      for (let i = 0; i < 3; i++) {
        const nrpnEvent = events[i] as MIDINRPNEvent;
        assert.strictEqual(nrpnEvent.type, 'nrpn');
        assert.strictEqual(nrpnEvent.channel, 11);
        assert.strictEqual(nrpnEvent.paramMSB, 0x05);
        assert.strictEqual(nrpnEvent.paramLSB, 0x17);
      }

      // Verify each event has the correct value
      assert.strictEqual((events[0] as MIDINRPNEvent).value, 0x20);
      assert.strictEqual((events[1] as MIDINRPNEvent).value, 0x40);
      assert.strictEqual((events[2] as MIDINRPNEvent).value, 0x60);
    });
  });

  describe('System real-time messages', () => {
    it('should ignore system real-time bytes interspersed with Note On', async () => {
      parser = new MIDIStreamParser();
      const capture = captureEvents(1);

      // Note On with system real-time bytes (0xF8-0xFF) interspersed
      const mixedBytes = Buffer.from([
        0x9B,         // Note On status
        0xF8,         // System real-time (clock)
        0x05,         // Note number
        0xF9,         // System real-time (undefined)
        0x7F,         // Velocity
        0xFE,         // System real-time (active sensing)
      ]);
      parser.feed(mixedBytes);

      const events = await capture;
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'noteon');

      const noteEvent = events[0] as MIDINoteOnEvent;
      assert.strictEqual(noteEvent.channel, 11);
      assert.strictEqual(noteEvent.note, 0x05);
      assert.strictEqual(noteEvent.velocity, 0x7F);
    });
  });

  describe('SysEx handling', () => {
    it('should skip SysEx messages and parse subsequent valid messages', async () => {
      parser = new MIDIStreamParser();
      const capture = captureEvents(1);

      // SysEx (0xF0...0xF7) followed by a Note On message
      const sysExAndNoteBytes = Buffer.from([
        0xF0,         // SysEx start
        0x41, 0x10,   // Some SysEx data
        0x42, 0x12,   // More SysEx data
        0xF7,         // SysEx end
        0x9B,         // Note On status
        0x3C,         // Note (middle C)
        0x64,         // Velocity
      ]);
      parser.feed(sysExAndNoteBytes);

      const events = await capture;
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'noteon');

      const noteEvent = events[0] as MIDINoteOnEvent;
      assert.strictEqual(noteEvent.channel, 11);
      assert.strictEqual(noteEvent.note, 0x3C);
      assert.strictEqual(noteEvent.velocity, 0x64);
    });
  });

  describe('reset()', () => {
    it('should clear parser state when reset is called', async () => {
      parser = new MIDIStreamParser();

      // Feed partial NRPN data
      parser.feed(Buffer.from([0xBB, 99, 0x05, 0xBB, 98, 0x17]));

      // Reset the parser
      parser.reset();

      const capture = captureEvents(1);

      // Feed a new complete message
      parser.feed(Buffer.from([0x9B, 0x05, 0x7F]));

      const events = await capture;
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'noteon');

      const noteEvent = events[0] as MIDINoteOnEvent;
      assert.strictEqual(noteEvent.channel, 11);
      assert.strictEqual(noteEvent.note, 0x05);
      assert.strictEqual(noteEvent.velocity, 0x7F);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty buffer', async () => {
      parser = new MIDIStreamParser();
      const capture = captureEvents(0);

      parser.feed(Buffer.alloc(0));

      const events = await capture;
      assert.strictEqual(events.length, 0);
    });

    it('should silently consume Note Off messages without emitting', async () => {
      parser = new MIDIStreamParser();
      const capture = captureEvents(0);

      // Note Off on channel 11, note 5, velocity 0 — parser consumes but doesn't emit
      const noteOffBytes = Buffer.from([0x8B, 0x05, 0x00]);
      parser.feed(noteOffBytes);

      const events = await capture;
      assert.strictEqual(events.length, 0);
    });

    it('should silently consume non-NRPN CC messages without emitting', async () => {
      parser = new MIDIStreamParser();
      const capture = captureEvents(0);

      // CC7 (volume) on channel 11 — not an NRPN CC, so no event
      const ccBytes = Buffer.from([0xBB, 7, 100]);
      parser.feed(ccBytes);

      const events = await capture;
      assert.strictEqual(events.length, 0);
    });

    it('should silently consume Pitch Bend messages without emitting', async () => {
      parser = new MIDIStreamParser();
      const capture = captureEvents(0);

      // Pitch Bend on channel 11 — parser consumes but doesn't emit
      const pitchBendBytes = Buffer.from([0xEB, 0x40, 0x40]);
      parser.feed(pitchBendBytes);

      const events = await capture;
      assert.strictEqual(events.length, 0);
    });

    it('should silently consume Aftertouch messages without emitting', async () => {
      parser = new MIDIStreamParser();
      const capture = captureEvents(0);

      // Channel Aftertouch on channel 11 — parser consumes but doesn't emit
      const aftertouchBytes = Buffer.from([0xDB, 80]);
      parser.feed(aftertouchBytes);

      const events = await capture;
      assert.strictEqual(events.length, 0);
    });
  });

  describe('Complex NRPN scenarios', () => {
    it('should handle NRPN on different channels independently', async () => {
      parser = new MIDIStreamParser();
      const capture = captureEvents(2);

      // NRPN on channel 1 and channel 11
      const multiChannelBytes = Buffer.from([
        0xB0, 99, 0x01, 0xB0, 98, 0x02, 0xB0, 6, 0x50,   // Channel 1
        0xBB, 99, 0x03, 0xBB, 98, 0x04, 0xBB, 6, 0x70,   // Channel 11
      ]);
      parser.feed(multiChannelBytes);

      const events = await capture;
      assert.strictEqual(events.length, 2);

      const nrpn1 = events[0] as MIDINRPNEvent;
      assert.strictEqual(nrpn1.channel, 0);
      assert.strictEqual(nrpn1.paramMSB, 0x01);
      assert.strictEqual(nrpn1.paramLSB, 0x02);
      assert.strictEqual(nrpn1.value, 0x50);

      const nrpn2 = events[1] as MIDINRPNEvent;
      assert.strictEqual(nrpn2.channel, 11);
      assert.strictEqual(nrpn2.paramMSB, 0x03);
      assert.strictEqual(nrpn2.paramLSB, 0x04);
      assert.strictEqual(nrpn2.value, 0x70);
    });

    it('should handle incomplete NRPN sequence followed by complete sequence', async () => {
      parser = new MIDIStreamParser();
      const capture = captureEvents(1);

      // Feed only CC99 and CC98 (incomplete)
      parser.feed(Buffer.from([0xBB, 99, 0x05, 0xBB, 98, 0x17]));

      // Then feed a complete NRPN with different channel
      parser.feed(Buffer.from([0xB0, 99, 0x10, 0xB0, 98, 0x20, 0xB0, 6, 0x30]));

      const events = await capture;
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'nrpn');

      const nrpnEvent = events[0] as MIDINRPNEvent;
      assert.strictEqual(nrpnEvent.channel, 0);
      assert.strictEqual(nrpnEvent.paramMSB, 0x10);
      assert.strictEqual(nrpnEvent.paramLSB, 0x20);
      assert.strictEqual(nrpnEvent.value, 0x30);
    });
  });

  describe('Running status edge cases', () => {
    it('should handle running status then new status byte', async () => {
      parser = new MIDIStreamParser();
      const capture = captureEvents(2);

      // Note On with running status (2 Note On messages), second uses running status
      const runningStatusBytes = Buffer.from([
        0x9B, 0x05, 0x7F,  // Note On channel 11, note 5, vel 127
        0x0C, 0x64,        // Running status: Note On channel 11, note 12, vel 100
      ]);
      parser.feed(runningStatusBytes);

      const events = await capture;
      assert.strictEqual(events.length, 2);
      assert.strictEqual(events[0].type, 'noteon');
      assert.strictEqual(events[1].type, 'noteon');

      const first = events[0] as MIDINoteOnEvent;
      assert.strictEqual(first.note, 0x05);
      assert.strictEqual(first.velocity, 0x7F);

      const second = events[1] as MIDINoteOnEvent;
      assert.strictEqual(second.note, 0x0C);
      assert.strictEqual(second.velocity, 0x64);
    });
  });

  describe('Large buffers', () => {
    it('should handle multiple consecutive complete messages', async () => {
      parser = new MIDIStreamParser();
      const capture = captureEvents(5);

      // Create a buffer with 5 Note On messages
      const multiMessageBuffer = Buffer.from([
        0x9B, 0x00, 0x40,
        0x9B, 0x01, 0x41,
        0x9B, 0x02, 0x42,
        0x9B, 0x03, 0x43,
        0x9B, 0x04, 0x44,
      ]);
      parser.feed(multiMessageBuffer);

      const events = await capture;
      assert.strictEqual(events.length, 5);

      for (let i = 0; i < 5; i++) {
        assert.strictEqual(events[i].type, 'noteon');
        assert.strictEqual((events[i] as MIDINoteOnEvent).note, i);
      }
    });
  });
});
