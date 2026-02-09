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
  describe('Input channels', () => {
    it('should resolve Input 1 to correct MIDI channel and strip hex', () => {
      const result = resolveStrip({ type: StripType.Input, number: 1 });
      assert.deepStrictEqual(result, { midiChannel: 11, stripHex: 0x00 });
    });

    it('should resolve Input 48 to correct MIDI channel and strip hex', () => {
      const result = resolveStrip({ type: StripType.Input, number: 48 });
      assert.deepStrictEqual(result, { midiChannel: 11, stripHex: 0x2f });
    });

    it('should resolve Input 49 to MIDI channel 12 (offset +1)', () => {
      const result = resolveStrip({ type: StripType.Input, number: 49 });
      assert.deepStrictEqual(result, { midiChannel: 12, stripHex: 0x30 });
    });

    it('should resolve Input 64 to MIDI channel 12 with strip hex 0x3f', () => {
      const result = resolveStrip({ type: StripType.Input, number: 64 });
      assert.deepStrictEqual(result, { midiChannel: 12, stripHex: 0x3f });
    });

    it('should throw error for Input 0', () => {
      assert.throws(() => resolveStrip({ type: StripType.Input, number: 0 }), /Input channel 0 out of range/);
    });

    it('should throw error for Input 65', () => {
      assert.throws(() => resolveStrip({ type: StripType.Input, number: 65 }), /Input channel 65 out of range/);
    });

    it('should throw error for negative Input', () => {
      assert.throws(() => resolveStrip({ type: StripType.Input, number: -1 }), /Input channel -1 out of range/);
    });
  });

  describe('FXReturn channels', () => {
    it('should resolve FXReturn 1 to correct MIDI channel and strip hex', () => {
      const result = resolveStrip({ type: StripType.FXReturn, number: 1 });
      assert.deepStrictEqual(result, { midiChannel: 12, stripHex: 0x40 });
    });

    it('should resolve FXReturn 8 to correct MIDI channel and strip hex', () => {
      const result = resolveStrip({ type: StripType.FXReturn, number: 8 });
      assert.deepStrictEqual(result, { midiChannel: 12, stripHex: 0x47 });
    });

    it('should throw error for FXReturn 0', () => {
      assert.throws(() => resolveStrip({ type: StripType.FXReturn, number: 0 }), /FX Return 0 out of range/);
    });

    it('should throw error for FXReturn 9', () => {
      assert.throws(() => resolveStrip({ type: StripType.FXReturn, number: 9 }), /FX Return 9 out of range/);
    });
  });

  describe('Mix channels', () => {
    it('should resolve Mix 1 to correct MIDI channel and strip hex', () => {
      const result = resolveStrip({ type: StripType.Mix, number: 1 });
      assert.deepStrictEqual(result, { midiChannel: 13, stripHex: 0x00 });
    });

    it('should resolve Mix 12 to correct MIDI channel and strip hex', () => {
      const result = resolveStrip({ type: StripType.Mix, number: 12 });
      assert.deepStrictEqual(result, { midiChannel: 13, stripHex: 0x0b });
    });

    it('should throw error for Mix 0', () => {
      assert.throws(() => resolveStrip({ type: StripType.Mix, number: 0 }), /Mix 0 out of range/);
    });

    it('should throw error for Mix 13', () => {
      assert.throws(() => resolveStrip({ type: StripType.Mix, number: 13 }), /Mix 13 out of range/);
    });
  });

  describe('FXSend channels', () => {
    it('should resolve FXSend 1 to correct MIDI channel and strip hex', () => {
      const result = resolveStrip({ type: StripType.FXSend, number: 1 });
      assert.deepStrictEqual(result, { midiChannel: 13, stripHex: 0x0c });
    });

    it('should resolve FXSend 4 to correct MIDI channel and strip hex', () => {
      const result = resolveStrip({ type: StripType.FXSend, number: 4 });
      assert.deepStrictEqual(result, { midiChannel: 13, stripHex: 0x0f });
    });

    it('should throw error for FXSend 0', () => {
      assert.throws(() => resolveStrip({ type: StripType.FXSend, number: 0 }), /FX Send 0 out of range/);
    });

    it('should throw error for FXSend 5', () => {
      assert.throws(() => resolveStrip({ type: StripType.FXSend, number: 5 }), /FX Send 5 out of range/);
    });
  });

  describe('Matrix channels', () => {
    it('should resolve Matrix 1 to correct MIDI channel and strip hex', () => {
      const result = resolveStrip({ type: StripType.Matrix, number: 1 });
      assert.deepStrictEqual(result, { midiChannel: 13, stripHex: 0x10 });
    });

    it('should resolve Matrix 6 to correct MIDI channel and strip hex', () => {
      const result = resolveStrip({ type: StripType.Matrix, number: 6 });
      assert.deepStrictEqual(result, { midiChannel: 13, stripHex: 0x15 });
    });

    it('should throw error for Matrix 0', () => {
      assert.throws(() => resolveStrip({ type: StripType.Matrix, number: 0 }), /Matrix 0 out of range/);
    });

    it('should throw error for Matrix 7', () => {
      assert.throws(() => resolveStrip({ type: StripType.Matrix, number: 7 }), /Matrix 7 out of range/);
    });
  });

  describe('DCA channels', () => {
    it('should resolve DCA 1 to correct MIDI channel and strip hex', () => {
      const result = resolveStrip({ type: StripType.DCA, number: 1 });
      assert.deepStrictEqual(result, { midiChannel: 14, stripHex: 0x00 });
    });

    it('should resolve DCA 16 to correct MIDI channel and strip hex', () => {
      const result = resolveStrip({ type: StripType.DCA, number: 16 });
      assert.deepStrictEqual(result, { midiChannel: 14, stripHex: 0x0f });
    });

    it('should throw error for DCA 0', () => {
      assert.throws(() => resolveStrip({ type: StripType.DCA, number: 0 }), /DCA 0 out of range/);
    });

    it('should throw error for DCA 17', () => {
      assert.throws(() => resolveStrip({ type: StripType.DCA, number: 17 }), /DCA 17 out of range/);
    });
  });

  describe('Group channels', () => {
    it('should resolve Group 1 to correct MIDI channel and strip hex', () => {
      const result = resolveStrip({ type: StripType.Group, number: 1 });
      assert.deepStrictEqual(result, { midiChannel: 14, stripHex: 0x10 });
    });

    it('should resolve Group 16 to correct MIDI channel and strip hex', () => {
      const result = resolveStrip({ type: StripType.Group, number: 16 });
      assert.deepStrictEqual(result, { midiChannel: 14, stripHex: 0x1f });
    });

    it('should throw error for Group 0', () => {
      assert.throws(() => resolveStrip({ type: StripType.Group, number: 0 }), /Group 0 out of range/);
    });

    it('should throw error for Group 17', () => {
      assert.throws(() => resolveStrip({ type: StripType.Group, number: 17 }), /Group 17 out of range/);
    });
  });

  describe('Main channel', () => {
    it('should resolve Main to correct MIDI channel and strip hex', () => {
      const result = resolveStrip({ type: StripType.Main, number: 1 });
      assert.deepStrictEqual(result, { midiChannel: 15, stripHex: 0x00 });
    });
  });

  describe('Custom baseMidiChannel', () => {
    it('should respect custom baseMidiChannel', () => {
      const result = resolveStrip({ type: StripType.Input, number: 1 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 0, stripHex: 0x00 });
    });

    it('should apply custom baseMidiChannel offset correctly', () => {
      const result = resolveStrip({ type: StripType.Mix, number: 1 }, 0);
      assert.deepStrictEqual(result, { midiChannel: 2, stripHex: 0x00 });
    });
  });
});

describe('reverseResolveStrip', () => {
  describe('Input channels offset 0', () => {
    it('should reverse Input 1 correctly', () => {
      const result = reverseResolveStrip(11, 0x00);
      assert.deepStrictEqual(result, { type: StripType.Input, number: 1 });
    });

    it('should reverse Input 48 correctly', () => {
      const result = reverseResolveStrip(11, 0x2f);
      assert.deepStrictEqual(result, { type: StripType.Input, number: 48 });
    });

    it('should return null for out-of-range hex on Input channel', () => {
      const result = reverseResolveStrip(11, 0x40);
      assert.strictEqual(result, null);
    });
  });

  describe('Input 49-64 and FXReturn offset 1', () => {
    it('should reverse Input 49 correctly', () => {
      const result = reverseResolveStrip(12, 0x30);
      assert.deepStrictEqual(result, { type: StripType.Input, number: 49 });
    });

    it('should reverse Input 64 correctly', () => {
      const result = reverseResolveStrip(12, 0x3f);
      assert.deepStrictEqual(result, { type: StripType.Input, number: 64 });
    });

    it('should reverse FXReturn 1 correctly', () => {
      const result = reverseResolveStrip(12, 0x40);
      assert.deepStrictEqual(result, { type: StripType.FXReturn, number: 1 });
    });

    it('should reverse FXReturn 8 correctly', () => {
      const result = reverseResolveStrip(12, 0x47);
      assert.deepStrictEqual(result, { type: StripType.FXReturn, number: 8 });
    });

    it('should return null for out-of-range hex on offset 1', () => {
      const result = reverseResolveStrip(12, 0x50);
      assert.strictEqual(result, null);
    });
  });

  describe('Mix, FXSend, Matrix offset 2', () => {
    it('should reverse Mix 1 correctly', () => {
      const result = reverseResolveStrip(13, 0x00);
      assert.deepStrictEqual(result, { type: StripType.Mix, number: 1 });
    });

    it('should reverse Mix 12 correctly', () => {
      const result = reverseResolveStrip(13, 0x0b);
      assert.deepStrictEqual(result, { type: StripType.Mix, number: 12 });
    });

    it('should reverse FXSend 1 correctly', () => {
      const result = reverseResolveStrip(13, 0x0c);
      assert.deepStrictEqual(result, { type: StripType.FXSend, number: 1 });
    });

    it('should reverse FXSend 4 correctly', () => {
      const result = reverseResolveStrip(13, 0x0f);
      assert.deepStrictEqual(result, { type: StripType.FXSend, number: 4 });
    });

    it('should reverse Matrix 1 correctly', () => {
      const result = reverseResolveStrip(13, 0x10);
      assert.deepStrictEqual(result, { type: StripType.Matrix, number: 1 });
    });

    it('should reverse Matrix 6 correctly', () => {
      const result = reverseResolveStrip(13, 0x15);
      assert.deepStrictEqual(result, { type: StripType.Matrix, number: 6 });
    });

    it('should return null for out-of-range hex on offset 2', () => {
      const result = reverseResolveStrip(13, 0x20);
      assert.strictEqual(result, null);
    });
  });

  describe('DCA and Group offset 3', () => {
    it('should reverse DCA 1 correctly', () => {
      const result = reverseResolveStrip(14, 0x00);
      assert.deepStrictEqual(result, { type: StripType.DCA, number: 1 });
    });

    it('should reverse DCA 16 correctly', () => {
      const result = reverseResolveStrip(14, 0x0f);
      assert.deepStrictEqual(result, { type: StripType.DCA, number: 16 });
    });

    it('should reverse Group 1 correctly', () => {
      const result = reverseResolveStrip(14, 0x10);
      assert.deepStrictEqual(result, { type: StripType.Group, number: 1 });
    });

    it('should reverse Group 16 correctly', () => {
      const result = reverseResolveStrip(14, 0x1f);
      assert.deepStrictEqual(result, { type: StripType.Group, number: 16 });
    });

    it('should return null for out-of-range hex on offset 3', () => {
      const result = reverseResolveStrip(14, 0x30);
      assert.strictEqual(result, null);
    });
  });

  describe('Main offset 4', () => {
    it('should reverse Main correctly', () => {
      const result = reverseResolveStrip(15, 0x00);
      assert.deepStrictEqual(result, { type: StripType.Main, number: 1 });
    });

    it('should return null for non-zero hex on Main channel', () => {
      const result = reverseResolveStrip(15, 0x01);
      assert.strictEqual(result, null);
    });
  });

  describe('Unknown offset', () => {
    it('should return null for unknown MIDI channel offset', () => {
      const result = reverseResolveStrip(20, 0x00);
      assert.strictEqual(result, null);
    });
  });

  describe('Custom baseMidiChannel', () => {
    it('should work with custom baseMidiChannel', () => {
      const result = reverseResolveStrip(2, 0x00, 0);
      assert.deepStrictEqual(result, { type: StripType.Mix, number: 1 });
    });
  });

  describe('Round-trip conversion', () => {
    const stripTypes = [
      { type: StripType.Input, numbers: [1, 25, 48, 49, 64] },
      { type: StripType.FXReturn, numbers: [1, 4, 8] },
      { type: StripType.Mix, numbers: [1, 6, 12] },
      { type: StripType.FXSend, numbers: [1, 2, 4] },
      { type: StripType.Matrix, numbers: [1, 3, 6] },
      { type: StripType.DCA, numbers: [1, 8, 16] },
      { type: StripType.Group, numbers: [1, 8, 16] },
      { type: StripType.Main, numbers: [1] },
    ];

    for (const { type, numbers } of stripTypes) {
      for (const number of numbers) {
        it(`should convert ${type} ${number} and reverse back correctly`, () => {
          const strip = { type, number };
          const resolved = resolveStrip(strip);
          const reversed = reverseResolveStrip(resolved.midiChannel, resolved.stripHex);
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
  it('should build mute ON message with velocity 0x7f', () => {
    const result = buildMuteMessage(11, 0x30, true);
    assert.deepStrictEqual(result, [0x9b, 0x30, 0x7f]);
  });

  it('should build mute OFF message with velocity 0x00', () => {
    const result = buildMuteMessage(11, 0x30, false);
    assert.deepStrictEqual(result, [0x9b, 0x30, 0x00]);
  });

  it('should have status byte 0x90 | channel', () => {
    const result = buildMuteMessage(5, 0x30, true);
    assert.strictEqual(result[0], 0x95); // 0x90 | 0x05
  });

  it('should handle all MIDI channels 0-15', () => {
    for (let ch = 0; ch <= 15; ch++) {
      const result = buildMuteMessage(ch, 0x30, true);
      const expectedStatus = 0x90 | ch;
      assert.strictEqual(result[0], expectedStatus);
    }
  });

  it('should mask note number to 7 bits', () => {
    const result = buildMuteMessage(11, 0x80, true);
    assert.strictEqual(result[1], 0x00); // 0x80 & 0x7f = 0x00
  });

  it('should be 3 bytes long', () => {
    const result = buildMuteMessage(11, 0x30, true);
    assert.strictEqual(result.length, 3);
  });
});

describe('buildSceneRecall', () => {
  it('should build Program Change for scene 0', () => {
    const result = buildSceneRecall(11, 0);
    assert.deepStrictEqual(result, [0xcb, 0x00]);
  });

  it('should build Program Change for scene 127', () => {
    const result = buildSceneRecall(11, 127);
    assert.deepStrictEqual(result, [0xcb, 0x7f]);
  });

  it('should have status byte 0xc0 | channel', () => {
    const result = buildSceneRecall(5, 50);
    assert.strictEqual(result[0], 0xc5); // 0xc0 | 0x05
  });

  it('should handle all MIDI channels 0-15', () => {
    for (let ch = 0; ch <= 15; ch++) {
      const result = buildSceneRecall(ch, 50);
      const expectedStatus = 0xc0 | ch;
      assert.strictEqual(result[0], expectedStatus);
    }
  });

  it('should be 2 bytes long', () => {
    const result = buildSceneRecall(11, 50);
    assert.strictEqual(result.length, 2);
  });

  it('should throw error for scene -1', () => {
    assert.throws(() => buildSceneRecall(11, -1), /Scene number -1 out of range/);
  });

  it('should throw error for scene 128', () => {
    assert.throws(() => buildSceneRecall(11, 128), /Scene number 128 out of range/);
  });

  it('should throw error for scene 200', () => {
    assert.throws(() => buildSceneRecall(11, 200), /Scene number 200 out of range/);
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
