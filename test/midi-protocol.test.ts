import { describe, it, expect } from 'vitest';
import {
  StripType,
  resolveStrip,
  reverseResolveStrip,
  stripToOSCPrefix,
  buildNRPNFader,
  buildMuteMessage,
  buildSceneRecall,
  floatToMidi,
  midiToFloat,
  NRPN_PARAM,
} from '../src/midi-protocol';

describe('resolveStrip', () => {
  const base = 11; // MIDI ch 12 (0-indexed)

  it('resolves input 1 to ch12, strip 0x00', () => {
    const r = resolveStrip({ type: StripType.Input, number: 1 }, base);
    expect(r).toEqual({ midiChannel: 11, stripHex: 0x00 });
  });

  it('resolves input 48 to ch12, strip 0x2F', () => {
    const r = resolveStrip({ type: StripType.Input, number: 48 }, base);
    expect(r).toEqual({ midiChannel: 11, stripHex: 0x2f });
  });

  it('resolves input 49 to ch13, strip 0x30', () => {
    const r = resolveStrip({ type: StripType.Input, number: 49 }, base);
    expect(r).toEqual({ midiChannel: 12, stripHex: 0x30 });
  });

  it('resolves input 64 to ch13, strip 0x3F', () => {
    const r = resolveStrip({ type: StripType.Input, number: 64 }, base);
    expect(r).toEqual({ midiChannel: 12, stripHex: 0x3f });
  });

  it('resolves FX Return 1 to ch13, strip 0x40', () => {
    const r = resolveStrip({ type: StripType.FXReturn, number: 1 }, base);
    expect(r).toEqual({ midiChannel: 12, stripHex: 0x40 });
  });

  it('resolves Mix 1 to ch14, strip 0x00', () => {
    const r = resolveStrip({ type: StripType.Mix, number: 1 }, base);
    expect(r).toEqual({ midiChannel: 13, stripHex: 0x00 });
  });

  it('resolves FX Send 1 to ch14, strip 0x0C', () => {
    const r = resolveStrip({ type: StripType.FXSend, number: 1 }, base);
    expect(r).toEqual({ midiChannel: 13, stripHex: 0x0c });
  });

  it('resolves Matrix 1 to ch14, strip 0x10', () => {
    const r = resolveStrip({ type: StripType.Matrix, number: 1 }, base);
    expect(r).toEqual({ midiChannel: 13, stripHex: 0x10 });
  });

  it('resolves DCA 1 to ch15, strip 0x00', () => {
    const r = resolveStrip({ type: StripType.DCA, number: 1 }, base);
    expect(r).toEqual({ midiChannel: 14, stripHex: 0x00 });
  });

  it('resolves Group 1 to ch15, strip 0x10', () => {
    const r = resolveStrip({ type: StripType.Group, number: 1 }, base);
    expect(r).toEqual({ midiChannel: 14, stripHex: 0x10 });
  });

  it('resolves Main to ch16, strip 0x00', () => {
    const r = resolveStrip({ type: StripType.Main, number: 1 }, base);
    expect(r).toEqual({ midiChannel: 15, stripHex: 0x00 });
  });

  it('throws on out-of-range input', () => {
    expect(() => resolveStrip({ type: StripType.Input, number: 0 }, base)).toThrow();
    expect(() => resolveStrip({ type: StripType.Input, number: 65 }, base)).toThrow();
  });

  it('throws on out-of-range DCA', () => {
    expect(() => resolveStrip({ type: StripType.DCA, number: 0 }, base)).toThrow();
    expect(() => resolveStrip({ type: StripType.DCA, number: 17 }, base)).toThrow();
  });
});

describe('reverseResolveStrip', () => {
  const base = 11;

  it('round-trips all input channels', () => {
    for (let i = 1; i <= 64; i++) {
      const fwd = resolveStrip({ type: StripType.Input, number: i }, base);
      const rev = reverseResolveStrip(fwd.midiChannel, fwd.stripHex, base);
      expect(rev).toEqual({ type: StripType.Input, number: i });
    }
  });

  it('round-trips all mix channels', () => {
    for (let i = 1; i <= 12; i++) {
      const fwd = resolveStrip({ type: StripType.Mix, number: i }, base);
      const rev = reverseResolveStrip(fwd.midiChannel, fwd.stripHex, base);
      expect(rev).toEqual({ type: StripType.Mix, number: i });
    }
  });

  it('round-trips all DCAs', () => {
    for (let i = 1; i <= 16; i++) {
      const fwd = resolveStrip({ type: StripType.DCA, number: i }, base);
      const rev = reverseResolveStrip(fwd.midiChannel, fwd.stripHex, base);
      expect(rev).toEqual({ type: StripType.DCA, number: i });
    }
  });

  it('round-trips main LR', () => {
    const fwd = resolveStrip({ type: StripType.Main, number: 1 }, base);
    const rev = reverseResolveStrip(fwd.midiChannel, fwd.stripHex, base);
    expect(rev).toEqual({ type: StripType.Main, number: 1 });
  });

  it('returns null for unknown channel offset', () => {
    const rev = reverseResolveStrip(base + 5, 0x00, base);
    expect(rev).toBeNull();
  });

  it('returns null for out-of-range strip hex', () => {
    const rev = reverseResolveStrip(base, 0x7f, base); // ch12 only goes to 0x2f
    expect(rev).toBeNull();
  });
});

describe('stripToOSCPrefix', () => {
  it('maps Input 5 to /ch/5', () => {
    expect(stripToOSCPrefix({ type: StripType.Input, number: 5 })).toBe('/ch/5');
  });
  it('maps DCA 2 to /dca/2', () => {
    expect(stripToOSCPrefix({ type: StripType.DCA, number: 2 })).toBe('/dca/2');
  });
  it('maps Main to /main', () => {
    expect(stripToOSCPrefix({ type: StripType.Main, number: 1 })).toBe('/main');
  });
});

describe('buildNRPNFader', () => {
  it('builds correct 9-byte NRPN sequence', () => {
    const bytes = buildNRPNFader(11, 0x00, 100);
    // BN=0xBB (ch11), CC99=strip, CC98=0x17, CC6=level
    expect(bytes).toEqual([
      0xbb, 99, 0x00,   // NRPN MSB = strip 0
      0xbb, 98, 0x17,   // NRPN LSB = fader level param
      0xbb, 6, 100,     // Data entry = level
    ]);
  });

  it('clamps level to 0-127', () => {
    const low = buildNRPNFader(0, 0, -10);
    expect(low[8]).toBe(0);

    const high = buildNRPNFader(0, 0, 200);
    expect(high[8]).toBe(127);
  });
});

describe('buildMuteMessage', () => {
  it('builds Note On with velocity 0x7F for mute on', () => {
    const bytes = buildMuteMessage(11, 5, true);
    expect(bytes).toEqual([0x9b, 5, 0x7f]);
  });

  it('builds Note On with velocity 0x00 for mute off', () => {
    const bytes = buildMuteMessage(11, 5, false);
    expect(bytes).toEqual([0x9b, 5, 0x00]);
  });
});

describe('buildSceneRecall', () => {
  it('builds Program Change message', () => {
    const bytes = buildSceneRecall(11, 42);
    expect(bytes).toEqual([0xcb, 42]);
  });

  it('throws on out-of-range scene', () => {
    expect(() => buildSceneRecall(0, 128)).toThrow();
    expect(() => buildSceneRecall(0, -1)).toThrow();
  });
});

describe('float/MIDI conversion', () => {
  it('floatToMidi: 0.0 -> 0, 1.0 -> 127, 0.5 -> 64', () => {
    expect(floatToMidi(0)).toBe(0);
    expect(floatToMidi(1)).toBe(127);
    expect(floatToMidi(0.5)).toBe(64);
  });

  it('floatToMidi: clamps', () => {
    expect(floatToMidi(-0.1)).toBe(0);
    expect(floatToMidi(1.5)).toBe(127);
  });

  it('midiToFloat: 0 -> 0.0, 127 -> 1.0', () => {
    expect(midiToFloat(0)).toBe(0);
    expect(midiToFloat(127)).toBe(1);
  });

  it('round-trips approximately', () => {
    for (let i = 0; i <= 127; i++) {
      const f = midiToFloat(i);
      const back = floatToMidi(f);
      expect(back).toBe(i);
    }
  });
});
