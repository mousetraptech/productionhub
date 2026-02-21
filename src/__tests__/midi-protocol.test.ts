const { describe, it } = require('node:test');
const assert = require('node:assert');
const {
  resolveStrip,
  reverseResolveStrip,
  stripToOSCPrefix,
  buildNRPNFader,
  buildMuteMessage,
  buildSceneRecall,
  floatToMidi,
  midiToFloat,
  StripType,
  NRPN_PARAM,
} = require('../midi-protocol');

describe('resolveStrip', () => {
  describe('Input channels (base+0)', () => {
    it('should resolve Input 1', () => {
      const result = resolveStrip({ type: StripType.Input, number: 1 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 0, stripHex: 0x00 });
    });
    it('should resolve Input 48', () => {
      const result = resolveStrip({ type: StripType.Input, number: 48 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 0, stripHex: 0x2f });
    });
    it('should resolve Input 49', () => {
      const result = resolveStrip({ type: StripType.Input, number: 49 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 0, stripHex: 0x30 });
    });
    it('should resolve Input 64', () => {
      const result = resolveStrip({ type: StripType.Input, number: 64 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 0, stripHex: 0x3f });
    });
    it('should throw for Input 0', () => {
      assert.throws(() => resolveStrip({ type: StripType.Input, number: 0 }, 0));
    });
    it('should throw for Input 65', () => {
      assert.throws(() => resolveStrip({ type: StripType.Input, number: 65 }, 0));
    });
  });

  describe('Group channels (base+1)', () => {
    it('should resolve Group 1', () => {
      const result = resolveStrip({ type: StripType.Group, number: 1 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 1, stripHex: 0x00 });
    });
    it('should resolve Group 16', () => {
      const result = resolveStrip({ type: StripType.Group, number: 16 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 1, stripHex: 0x0f });
    });
    it('should throw for Group 0', () => {
      assert.throws(() => resolveStrip({ type: StripType.Group, number: 0 }, 0));
    });
    it('should throw for Group 41', () => {
      assert.throws(() => resolveStrip({ type: StripType.Group, number: 41 }, 0));
    });
  });

  describe('Mix/Aux channels (base+2)', () => {
    it('should resolve Mix 1', () => {
      const result = resolveStrip({ type: StripType.Mix, number: 1 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 2, stripHex: 0x00 });
    });
    it('should resolve Mix 12', () => {
      const result = resolveStrip({ type: StripType.Mix, number: 12 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 2, stripHex: 0x0b });
    });
    it('should throw for Mix 0', () => {
      assert.throws(() => resolveStrip({ type: StripType.Mix, number: 0 }, 0));
    });
    it('should throw for Mix 41', () => {
      assert.throws(() => resolveStrip({ type: StripType.Mix, number: 41 }, 0));
    });
  });

  describe('Matrix channels (base+3)', () => {
    it('should resolve Matrix 1', () => {
      const result = resolveStrip({ type: StripType.Matrix, number: 1 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 3, stripHex: 0x00 });
    });
    it('should resolve Matrix 6', () => {
      const result = resolveStrip({ type: StripType.Matrix, number: 6 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 3, stripHex: 0x05 });
    });
    it('should throw for Matrix 0', () => {
      assert.throws(() => resolveStrip({ type: StripType.Matrix, number: 0 }, 0));
    });
    it('should throw for Matrix 41', () => {
      assert.throws(() => resolveStrip({ type: StripType.Matrix, number: 41 }, 0));
    });
  });

  describe('FX Send channels (base+4)', () => {
    it('should resolve FXSend 1', () => {
      const result = resolveStrip({ type: StripType.FXSend, number: 1 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 4, stripHex: 0x00 });
    });
    it('should resolve FXSend 4', () => {
      const result = resolveStrip({ type: StripType.FXSend, number: 4 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 4, stripHex: 0x03 });
    });
    it('should throw for FXSend 0', () => {
      assert.throws(() => resolveStrip({ type: StripType.FXSend, number: 0 }, 0));
    });
    it('should throw for FXSend 13', () => {
      assert.throws(() => resolveStrip({ type: StripType.FXSend, number: 13 }, 0));
    });
  });

  describe('FX Return channels (base+4)', () => {
    it('should resolve FXReturn 1', () => {
      const result = resolveStrip({ type: StripType.FXReturn, number: 1 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 4, stripHex: 0x20 });
    });
    it('should resolve FXReturn 8', () => {
      const result = resolveStrip({ type: StripType.FXReturn, number: 8 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 4, stripHex: 0x27 });
    });
    it('should throw for FXReturn 0', () => {
      assert.throws(() => resolveStrip({ type: StripType.FXReturn, number: 0 }, 0));
    });
    it('should throw for FXReturn 13', () => {
      assert.throws(() => resolveStrip({ type: StripType.FXReturn, number: 13 }, 0));
    });
  });

  describe('Main channel (base+4)', () => {
    it('should resolve Main LR', () => {
      const result = resolveStrip({ type: StripType.Main, number: 1 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 4, stripHex: 0x30 });
    });
  });

  describe('DCA channels (base+4)', () => {
    it('should resolve DCA 1', () => {
      const result = resolveStrip({ type: StripType.DCA, number: 1 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 4, stripHex: 0x36 });
    });
    it('should resolve DCA 16', () => {
      const result = resolveStrip({ type: StripType.DCA, number: 16 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 4, stripHex: 0x45 });
    });
    it('should throw for DCA 0', () => {
      assert.throws(() => resolveStrip({ type: StripType.DCA, number: 0 }, 0));
    });
    it('should throw for DCA 17', () => {
      assert.throws(() => resolveStrip({ type: StripType.DCA, number: 17 }, 0));
    });
  });

  describe('Custom baseMidiChannel', () => {
    it('should offset all channels from baseMidiChannel', () => {
      const result = resolveStrip({ type: StripType.Input, number: 1 }, 5);
      assert.deepStrictEqual(result, { midiChannel: 5, stripHex: 0x00 });
    });
    it('should offset DCA from baseMidiChannel', () => {
      const result = resolveStrip({ type: StripType.DCA, number: 1 }, 5);
      assert.deepStrictEqual(result, { midiChannel: 9, stripHex: 0x36 });
    });
  });
});

describe('reverseResolveStrip', () => {
  describe('Input channels (offset 0)', () => {
    it('should reverse Input 1', () => {
      assert.deepStrictEqual(reverseResolveStrip(0, 0x00, 0), { type: StripType.Input, number: 1 });
    });
    it('should reverse Input 48', () => {
      assert.deepStrictEqual(reverseResolveStrip(0, 0x2f, 0), { type: StripType.Input, number: 48 });
    });
    it('should reverse Input 49', () => {
      assert.deepStrictEqual(reverseResolveStrip(0, 0x30, 0), { type: StripType.Input, number: 49 });
    });
    it('should reverse Input 64', () => {
      assert.deepStrictEqual(reverseResolveStrip(0, 0x3f, 0), { type: StripType.Input, number: 64 });
    });
    it('should return null for out-of-range strip on offset 0', () => {
      assert.strictEqual(reverseResolveStrip(0, 0x40, 0), null);
    });
  });

  describe('Group channels (offset 1)', () => {
    it('should reverse Group 1', () => {
      assert.deepStrictEqual(reverseResolveStrip(1, 0x00, 0), { type: StripType.Group, number: 1 });
    });
    it('should reverse Group 16', () => {
      assert.deepStrictEqual(reverseResolveStrip(1, 0x0f, 0), { type: StripType.Group, number: 16 });
    });
    it('should return null for out-of-range strip on offset 1', () => {
      assert.strictEqual(reverseResolveStrip(1, 0x28, 0), null);
    });
  });

  describe('Mix channels (offset 2)', () => {
    it('should reverse Mix 1', () => {
      assert.deepStrictEqual(reverseResolveStrip(2, 0x00, 0), { type: StripType.Mix, number: 1 });
    });
    it('should reverse Mix 12', () => {
      assert.deepStrictEqual(reverseResolveStrip(2, 0x0b, 0), { type: StripType.Mix, number: 12 });
    });
    it('should return null for out-of-range strip on offset 2', () => {
      assert.strictEqual(reverseResolveStrip(2, 0x28, 0), null);
    });
  });

  describe('Matrix channels (offset 3)', () => {
    it('should reverse Matrix 1', () => {
      assert.deepStrictEqual(reverseResolveStrip(3, 0x00, 0), { type: StripType.Matrix, number: 1 });
    });
    it('should reverse Matrix 6', () => {
      assert.deepStrictEqual(reverseResolveStrip(3, 0x05, 0), { type: StripType.Matrix, number: 6 });
    });
    it('should return null for out-of-range strip on offset 3', () => {
      assert.strictEqual(reverseResolveStrip(3, 0x28, 0), null);
    });
  });

  describe('Offset 4 (FX Send, FX Return, Main, DCA)', () => {
    it('should reverse FXSend 1', () => {
      assert.deepStrictEqual(reverseResolveStrip(4, 0x00, 0), { type: StripType.FXSend, number: 1 });
    });
    it('should reverse FXSend 4', () => {
      assert.deepStrictEqual(reverseResolveStrip(4, 0x03, 0), { type: StripType.FXSend, number: 4 });
    });
    it('should reverse FXReturn 1', () => {
      assert.deepStrictEqual(reverseResolveStrip(4, 0x20, 0), { type: StripType.FXReturn, number: 1 });
    });
    it('should reverse FXReturn 8', () => {
      assert.deepStrictEqual(reverseResolveStrip(4, 0x27, 0), { type: StripType.FXReturn, number: 8 });
    });
    it('should reverse Main LR', () => {
      assert.deepStrictEqual(reverseResolveStrip(4, 0x30, 0), { type: StripType.Main, number: 1 });
    });
    it('should reverse DCA 1', () => {
      assert.deepStrictEqual(reverseResolveStrip(4, 0x36, 0), { type: StripType.DCA, number: 1 });
    });
    it('should reverse DCA 16', () => {
      assert.deepStrictEqual(reverseResolveStrip(4, 0x45, 0), { type: StripType.DCA, number: 16 });
    });
    it('should return null for gap between FX Send and FX Return', () => {
      assert.strictEqual(reverseResolveStrip(4, 0x0c, 0), null);
    });
    it('should return null for gap between FX Return and Main', () => {
      assert.strictEqual(reverseResolveStrip(4, 0x2c, 0), null);
    });
    it('should return null for gap between Main and DCA', () => {
      assert.strictEqual(reverseResolveStrip(4, 0x33, 0), null);
    });
  });

  describe('Unknown offset', () => {
    it('should return null for offset 5+', () => {
      assert.strictEqual(reverseResolveStrip(5, 0x00, 0), null);
    });
  });

  describe('Custom baseMidiChannel', () => {
    it('should work with custom base', () => {
      assert.deepStrictEqual(reverseResolveStrip(7, 0x00, 5), { type: StripType.Mix, number: 1 });
    });
  });

  describe('Round-trip conversion', () => {
    const stripTypes = [
      { type: StripType.Input, numbers: [1, 25, 48, 49, 64] },
      { type: StripType.Group, numbers: [1, 8, 16] },
      { type: StripType.Mix, numbers: [1, 6, 12] },
      { type: StripType.Matrix, numbers: [1, 3, 6] },
      { type: StripType.FXSend, numbers: [1, 2, 4] },
      { type: StripType.FXReturn, numbers: [1, 4, 8] },
      { type: StripType.DCA, numbers: [1, 8, 16] },
      { type: StripType.Main, numbers: [1] },
    ];

    for (const { type, numbers } of stripTypes) {
      for (const number of numbers) {
        it(`should round-trip ${type} ${number}`, () => {
          const strip = { type, number };
          const resolved = resolveStrip(strip, 0);
          const reversed = reverseResolveStrip(resolved.midiChannel, resolved.stripHex, 0);
          assert.deepStrictEqual(reversed, strip);
        });
      }
    }
  });
});

describe('stripToOSCPrefix', () => {
  it('should convert Input 1 to /ch/1', () => {
    const result = stripToOSCPrefix({ type: StripType.Input, number: 1 });
    assert.strictEqual(result, '/ch/1');
  });

  it('should convert Input 48 to /ch/48', () => {
    const result = stripToOSCPrefix({ type: StripType.Input, number: 48 });
    assert.strictEqual(result, '/ch/48');
  });

  it('should convert Input 64 to /ch/64', () => {
    const result = stripToOSCPrefix({ type: StripType.Input, number: 64 });
    assert.strictEqual(result, '/ch/64');
  });

  it('should convert Mix 1 to /mix/1', () => {
    const result = stripToOSCPrefix({ type: StripType.Mix, number: 1 });
    assert.strictEqual(result, '/mix/1');
  });

  it('should convert Mix 12 to /mix/12', () => {
    const result = stripToOSCPrefix({ type: StripType.Mix, number: 12 });
    assert.strictEqual(result, '/mix/12');
  });

  it('should convert FXSend 1 to /fxsend/1', () => {
    const result = stripToOSCPrefix({ type: StripType.FXSend, number: 1 });
    assert.strictEqual(result, '/fxsend/1');
  });

  it('should convert FXSend 4 to /fxsend/4', () => {
    const result = stripToOSCPrefix({ type: StripType.FXSend, number: 4 });
    assert.strictEqual(result, '/fxsend/4');
  });

  it('should convert FXReturn 1 to /fxrtn/1', () => {
    const result = stripToOSCPrefix({ type: StripType.FXReturn, number: 1 });
    assert.strictEqual(result, '/fxrtn/1');
  });

  it('should convert FXReturn 8 to /fxrtn/8', () => {
    const result = stripToOSCPrefix({ type: StripType.FXReturn, number: 8 });
    assert.strictEqual(result, '/fxrtn/8');
  });

  it('should convert DCA 1 to /dca/1', () => {
    const result = stripToOSCPrefix({ type: StripType.DCA, number: 1 });
    assert.strictEqual(result, '/dca/1');
  });

  it('should convert DCA 16 to /dca/16', () => {
    const result = stripToOSCPrefix({ type: StripType.DCA, number: 16 });
    assert.strictEqual(result, '/dca/16');
  });

  it('should convert Group 1 to /grp/1', () => {
    const result = stripToOSCPrefix({ type: StripType.Group, number: 1 });
    assert.strictEqual(result, '/grp/1');
  });

  it('should convert Group 16 to /grp/16', () => {
    const result = stripToOSCPrefix({ type: StripType.Group, number: 16 });
    assert.strictEqual(result, '/grp/16');
  });

  it('should convert Matrix 1 to /mtx/1', () => {
    const result = stripToOSCPrefix({ type: StripType.Matrix, number: 1 });
    assert.strictEqual(result, '/mtx/1');
  });

  it('should convert Matrix 6 to /mtx/6', () => {
    const result = stripToOSCPrefix({ type: StripType.Matrix, number: 6 });
    assert.strictEqual(result, '/mtx/6');
  });

  it('should convert Main to /main', () => {
    const result = stripToOSCPrefix({ type: StripType.Main, number: 1 });
    assert.strictEqual(result, '/main');
  });
});

describe('buildNRPNFader', () => {
  it('should build correct NRPN message for Input 1 at level 0', () => {
    const result = buildNRPNFader(11, 0x00, 0);
    assert.deepStrictEqual(result, [
      0xbb, 99, 0x00,           // CC99 = strip hex
      0xbb, 98, NRPN_PARAM.FADER_LEVEL, // CC98 = 0x17
      0xbb, 6, 0x00,            // CC6 = level
    ]);
  });

  it('should build correct NRPN message for Input 1 at level 127', () => {
    const result = buildNRPNFader(11, 0x00, 127);
    assert.deepStrictEqual(result, [
      0xbb, 99, 0x00,
      0xbb, 98, NRPN_PARAM.FADER_LEVEL,
      0xbb, 6, 0x7f,
    ]);
  });

  it('should build correct NRPN message for Mix 1', () => {
    const result = buildNRPNFader(13, 0x00, 64);
    assert.deepStrictEqual(result, [
      0xbd, 99, 0x00,
      0xbd, 98, NRPN_PARAM.FADER_LEVEL,
      0xbd, 6, 64,
    ]);
  });

  it('should clamp level to 127 if exceeded', () => {
    const result = buildNRPNFader(11, 0x00, 200);
    assert.strictEqual(result[8], 0x7f);
  });

  it('should clamp level to 0 if negative', () => {
    const result = buildNRPNFader(11, 0x00, -10);
    assert.strictEqual(result[8], 0x00);
  });

  it('should round level to nearest integer', () => {
    const result = buildNRPNFader(11, 0x00, 64.4);
    assert.strictEqual(result[8], 64);
  });

  it('should round level up when .5 or higher', () => {
    const result = buildNRPNFader(11, 0x00, 64.7);
    assert.strictEqual(result[8], 65);
  });

  it('should handle all MIDI channels 0-15', () => {
    for (let ch = 0; ch <= 15; ch++) {
      const result = buildNRPNFader(ch, 0x00, 64);
      const expectedStatus = 0xb0 | ch;
      assert.strictEqual(result[0], expectedStatus);
      assert.strictEqual(result[3], expectedStatus);
      assert.strictEqual(result[6], expectedStatus);
    }
  });

  it('should mask strip hex to 7 bits', () => {
    const result = buildNRPNFader(11, 0x80, 64);
    assert.strictEqual(result[2], 0x00); // 0x80 & 0x7f = 0x00
  });

  it('should have status byte format 0xb0 | channel', () => {
    const result = buildNRPNFader(11, 0x00, 64);
    assert.strictEqual(result[0], 0xbb); // 0xb0 | 0x0b
    assert.strictEqual(result[3], 0xbb);
    assert.strictEqual(result[6], 0xbb);
  });
});

describe('buildMuteMessage', () => {
  it('should build mute ON with vel 0x7f then note-off vel 0x00', () => {
    const result = buildMuteMessage(0, 0x05, true);
    assert.deepStrictEqual(result, [0x90, 0x05, 0x7f, 0x90, 0x05, 0x00]);
  });

  it('should build mute OFF with vel 0x3f then note-off vel 0x00', () => {
    const result = buildMuteMessage(0, 0x05, false);
    assert.deepStrictEqual(result, [0x90, 0x05, 0x3f, 0x90, 0x05, 0x00]);
  });

  it('should have status byte 0x90 | channel', () => {
    const result = buildMuteMessage(5, 0x30, true);
    assert.strictEqual(result[0], 0x95);
    assert.strictEqual(result[3], 0x95);
  });

  it('should be 6 bytes long', () => {
    const result = buildMuteMessage(0, 0x30, true);
    assert.strictEqual(result.length, 6);
  });

  it('should mask note number to 7 bits', () => {
    const result = buildMuteMessage(0, 0x80, true);
    assert.strictEqual(result[1], 0x00);
    assert.strictEqual(result[4], 0x00);
  });
});

describe('buildSceneRecall', () => {
  it('should build scene 0 as just Program Change (no bank select needed)', () => {
    const result = buildSceneRecall(0, 0);
    assert.deepStrictEqual(result, [0xc0, 0x00]);
  });

  it('should build scene 127 as just Program Change', () => {
    const result = buildSceneRecall(0, 127);
    assert.deepStrictEqual(result, [0xc0, 0x7f]);
  });

  it('should build scene 128 with Bank Select CC0=1 then PC=0', () => {
    const result = buildSceneRecall(0, 128);
    assert.deepStrictEqual(result, [0xb0, 0x00, 0x01, 0xc0, 0x00]);
  });

  it('should build scene 255 with Bank Select CC0=1 then PC=127', () => {
    const result = buildSceneRecall(0, 255);
    assert.deepStrictEqual(result, [0xb0, 0x00, 0x01, 0xc0, 0x7f]);
  });

  it('should build scene 256 with Bank Select CC0=2 then PC=0', () => {
    const result = buildSceneRecall(0, 256);
    assert.deepStrictEqual(result, [0xb0, 0x00, 0x02, 0xc0, 0x00]);
  });

  it('should throw for negative scene', () => {
    assert.throws(() => buildSceneRecall(0, -1));
  });

  it('should throw for scene >= 500 (A&H limit)', () => {
    assert.throws(() => buildSceneRecall(0, 500));
  });

  it('should use correct MIDI channel', () => {
    const result = buildSceneRecall(5, 0);
    assert.strictEqual(result[0], 0xc5);
  });
});

describe('floatToMidi', () => {
  it('should convert 0.0 to 0', () => {
    const result = floatToMidi(0.0);
    assert.strictEqual(result, 0);
  });

  it('should convert 1.0 to 127', () => {
    const result = floatToMidi(1.0);
    assert.strictEqual(result, 127);
  });

  it('should convert 0.5 to approximately 64', () => {
    const result = floatToMidi(0.5);
    assert.strictEqual(result, 64);
  });

  it('should round 0.3937 to 50', () => {
    const result = floatToMidi(0.3937);
    assert.strictEqual(result, 50);
  });

  it('should round 0.6063 to 77', () => {
    const result = floatToMidi(0.6063);
    assert.strictEqual(result, 77);
  });

  it('should clamp values above 1.0 to 127', () => {
    const result = floatToMidi(1.5);
    assert.strictEqual(result, 127);
  });

  it('should clamp values below 0.0 to 0', () => {
    const result = floatToMidi(-0.5);
    assert.strictEqual(result, 0);
  });

  it('should clamp extremely large values', () => {
    const result = floatToMidi(999);
    assert.strictEqual(result, 127);
  });

  it('should clamp extremely negative values', () => {
    const result = floatToMidi(-999);
    assert.strictEqual(result, 0);
  });
});

describe('midiToFloat', () => {
  it('should convert 0 to 0.0', () => {
    const result = midiToFloat(0);
    assert.strictEqual(result, 0.0);
  });

  it('should convert 127 to 1.0', () => {
    const result = midiToFloat(127);
    assert.strictEqual(result, 1.0);
  });

  it('should convert 64 to approximately 0.5039', () => {
    const result = midiToFloat(64);
    assert(Math.abs(result - (64 / 127)) < 0.001);
  });

  it('should convert 50 to approximately 0.3937', () => {
    const result = midiToFloat(50);
    assert(Math.abs(result - (50 / 127)) < 0.001);
  });

  it('should convert 77 to approximately 0.6063', () => {
    const result = midiToFloat(77);
    assert(Math.abs(result - (77 / 127)) < 0.001);
  });

  it('should clamp values above 127 to 1.0', () => {
    const result = midiToFloat(200);
    assert.strictEqual(result, 1.0);
  });

  it('should clamp values below 0 to 0.0', () => {
    const result = midiToFloat(-10);
    assert.strictEqual(result, 0.0);
  });

  it('should clamp extremely large values', () => {
    const result = midiToFloat(999);
    assert.strictEqual(result, 1.0);
  });

  it('should clamp extremely negative values', () => {
    const result = midiToFloat(-999);
    assert.strictEqual(result, 0.0);
  });
});

describe('Conversion round-trips', () => {
  it('should convert float to MIDI and back with minimal loss for 0.0', () => {
    const original = 0.0;
    const midi = floatToMidi(original);
    const result = midiToFloat(midi);
    assert.strictEqual(result, 0.0);
  });

  it('should convert float to MIDI and back with minimal loss for 1.0', () => {
    const original = 1.0;
    const midi = floatToMidi(original);
    const result = midiToFloat(midi);
    assert.strictEqual(result, 1.0);
  });

  it('should convert float to MIDI and back for 0.5', () => {
    const original = 0.5;
    const midi = floatToMidi(original);
    const result = midiToFloat(midi);
    assert(Math.abs(result - original) < 0.01);
  });

  it('should convert MIDI to float and back with no loss for 0', () => {
    const original = 0;
    const float = midiToFloat(original);
    const result = floatToMidi(float);
    assert.strictEqual(result, 0);
  });

  it('should convert MIDI to float and back with no loss for 127', () => {
    const original = 127;
    const float = midiToFloat(original);
    const result = floatToMidi(float);
    assert.strictEqual(result, 127);
  });

  it('should convert MIDI to float and back for value 64', () => {
    const original = 64;
    const float = midiToFloat(original);
    const result = floatToMidi(float);
    assert(Math.abs(result - original) <= 1);
  });
});
