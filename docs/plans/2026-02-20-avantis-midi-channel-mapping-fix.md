# Avantis MIDI Channel Mapping Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the Avantis MIDI NRPN channel/strip mapping so commands actually work on the physical desk.

**Architecture:** Update `resolveStrip()` and `reverseResolveStrip()` in `midi-protocol.ts` to match the verified Bitfocus Companion addressing scheme. The current mapping was based on an incorrect reading of the A&H docs. The Companion module's mapping has been proven to work via live testing on the physical Avantis desk. Also update `buildMuteMessage()` to send the trailing Note On vel=0x00 (note-off) that the desk requires, and update `buildSceneRecall()` to support Bank Select for scenes >127.

**Tech Stack:** TypeScript, Node.js test runner

---

## Background

The Production Hub's Avantis driver sends MIDI NRPN over TCP to port 51325 on the Allen & Heath Avantis mixing console. Live testing confirmed:
- **SysEx works** for input faders (confirmed moving Input 1 and Input 2)
- **NRPN works** when using the Bitfocus Companion addressing scheme (confirmed moving Input 1 and DCA 1)
- **Our current NRPN mapping is WRONG** — channel offsets and strip hex values don't match what the desk expects

### Correct Channel Layout (from Bitfocus Companion, hardware-verified)

All channels are relative to `baseMidiChannel` (0-indexed). Config `midiBaseChannel` is 1-indexed (user-facing), so base=1 → 0-indexed ch=0.

| MIDI Channel | Strip Types |
|---|---|
| base+0 | Inputs 1-64 (strip 0x00-0x3F) |
| base+1 | Groups: mono 0x00-0x27 (1-40), stereo 0x40-0x53 (1-20) |
| base+2 | Aux/Mix: mono 0x00-0x27 (1-40), stereo 0x40-0x53 (1-20) |
| base+3 | Matrix: mono 0x00-0x27 (1-40), stereo 0x40-0x53 (1-20) |
| base+4 | FX Send: mono 0x00-0x0B (1-12), stereo 0x10-0x1B (1-12); FX Return: 0x20-0x2B (1-12); Main: 0x30-0x32 (LR=0x30, C=0x31, mono=0x32); DCA: 0x36-0x45 (1-16); Mute Groups: 0x46-0x4D (1-8) |

### Our Current (WRONG) Mapping

| Strip Type | Current Channel | Current Strip Hex |
|---|---|---|
| Input 1-48 | base+0 | 0x00-0x2F |
| Input 49-64 | base+1 | 0x30-0x3F |
| FX Return 1-8 | base+1 | 0x40-0x47 |
| Mix 1-12 | base+2 | 0x00-0x0B |
| FX Send 1-4 | base+2 | 0x0C-0x0F |
| Matrix 1-6 | base+2 | 0x10-0x15 |
| DCA 1-16 | base+3 | 0x00-0x0F |
| Group 1-16 | base+3 | 0x10-0x1F |
| Main | base+4 | 0x00 |

### Mute Protocol Fix

Current code sends a single Note On message. The desk expects two messages (confirmed by the user's QLab mute tests and the Companion module):
1. Note On with vel 0x7F (mute) or 0x3F (unmute)
2. Note On with vel 0x00 (note-off release)

### Scene Recall Fix

Current code only supports scenes 0-127 via Program Change. The Companion module uses Bank Select (CC0) + Program Change for scenes in banks of 128.

### Config Default Change

The default `midiBaseChannel` should change from `12` to `1` since the new mapping uses 5 consecutive channels from a user-specified base, and the desk default is Channel 1-5.

---

## Task 1: Update resolveStrip() tests to match Companion addressing

**Files:**
- Modify: `src/__tests__/midi-protocol.test.ts` (lines 16-189, resolveStrip tests)

**Step 1: Update all resolveStrip test expectations**

Replace the entire `resolveStrip` describe block with tests matching the Companion mapping. Key changes:
- Inputs: same as before (base+0, 0x00-0x3F) — but ALL 64 inputs on ONE channel
- Groups: base+1, strip 0x00+ (was base+3, strip 0x10+)
- Mix: base+2, strip 0x00+ (same channel, same strip — unchanged!)
- Matrix: base+3, strip 0x00+ (was base+2, strip 0x10+)
- FX Send: base+4, strip 0x00+ (was base+2, strip 0x0C+)
- FX Return: base+4, strip 0x20+ (was base+1, strip 0x40+)
- DCA: base+4, strip 0x36+ (was base+3, strip 0x00+)
- Main: base+4, strip 0x30 (was base+4, strip 0x00)

With default baseMidiChannel=0 (the new default, 0-indexed):

```javascript
describe('resolveStrip', () => {
  // Default baseMidiChannel = 0 (0-indexed, config value 1)
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
      // With base=5, Input should be ch 5
      const result = resolveStrip({ type: StripType.Input, number: 1 }, 5);
      assert.deepStrictEqual(result, { midiChannel: 5, stripHex: 0x00 });
    });

    it('should offset DCA from baseMidiChannel', () => {
      // With base=5, DCA should be ch 9 (5+4)
      const result = resolveStrip({ type: StripType.DCA, number: 1 }, 5);
      assert.deepStrictEqual(result, { midiChannel: 9, stripHex: 0x36 });
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npm test -- --test-name-pattern "resolveStrip" 2>&1 | head -60`
Expected: Multiple FAIL — old implementation returns wrong values.

---

## Task 2: Update resolveStrip() implementation

**Files:**
- Modify: `src/midi-protocol.ts` (lines 42-140)

**Step 1: Update comments and constants**

Replace the old channel mapping comments (lines 43-60) and `DEFAULT_MIDI_CHANNELS` constant with the new Companion-verified layout.

**Step 2: Rewrite resolveStrip()**

```typescript
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
```

Note: Default `baseMidiChannel` changes from `11` to `0`. This is because the config value `midiBaseChannel: 1` gets converted to 0-indexed in the driver (`(1-1) = 0`).

**Step 3: Run resolveStrip tests to verify they pass**

Run: `npm test -- --test-name-pattern "resolveStrip" 2>&1 | head -60`
Expected: All PASS.

---

## Task 3: Update reverseResolveStrip() tests and implementation

**Files:**
- Modify: `src/__tests__/midi-protocol.test.ts` (lines 191-348, reverseResolveStrip tests)
- Modify: `src/midi-protocol.ts` (lines 146-194)

**Step 1: Update reverseResolveStrip test expectations**

Replace the `reverseResolveStrip` describe block with tests matching the new layout (using base=0):

```javascript
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
      // base=5, ch=7 → offset=2 → Mix
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
```

**Step 2: Rewrite reverseResolveStrip()**

```typescript
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
```

**Step 3: Run all reverseResolveStrip and round-trip tests**

Run: `npm test -- --test-name-pattern "reverseResolveStrip|Round-trip" 2>&1 | head -60`
Expected: All PASS.

---

## Task 4: Update buildMuteMessage() to include note-off

**Files:**
- Modify: `src/__tests__/midi-protocol.test.ts` (buildMuteMessage tests)
- Modify: `src/midi-protocol.ts` (buildMuteMessage function)

**Step 1: Update buildMuteMessage tests**

The function should now return 6 bytes (two Note On messages):

```javascript
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
```

**Step 2: Update buildMuteMessage implementation**

```typescript
export function buildMuteMessage(midiChannel: number, noteNumber: number, muteOn: boolean): number[] {
  const status = 0x90 | (midiChannel & 0x0f);
  const note = noteNumber & 0x7f;
  const velocity = muteOn ? 0x7f : 0x3f;
  return [status, note, velocity, status, note, 0x00];
}
```

**Step 3: Run buildMuteMessage tests**

Run: `npm test -- --test-name-pattern "buildMuteMessage" 2>&1 | head -30`
Expected: All PASS.

---

## Task 5: Update buildSceneRecall() to support Bank Select

**Files:**
- Modify: `src/__tests__/midi-protocol.test.ts` (buildSceneRecall tests)
- Modify: `src/midi-protocol.ts` (buildSceneRecall function)

**Step 1: Update buildSceneRecall tests**

```javascript
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
```

**Step 2: Update buildSceneRecall implementation**

```typescript
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
```

**Step 3: Run buildSceneRecall tests**

Run: `npm test -- --test-name-pattern "buildSceneRecall" 2>&1 | head -30`
Expected: All PASS.

---

## Task 6: Update AvantisDriver default baseMidiChannel

**Files:**
- Modify: `src/drivers/avantis-driver.ts` (line 77)
- Modify: `src/config.ts` (line 127, legacy config default)

**Step 1: Change default from 12 to 1**

In `avantis-driver.ts` line 42 and 77:
```typescript
// Line 42: Update comment
  midiBaseChannel?: number;    // 1-indexed, default 1

// Line 77: Change default
  this.baseMidiChannel = ((config.midiBaseChannel ?? 1) - 1); // 1-indexed to 0-indexed
```

In `src/config.ts` line 127, if there's a legacy default:
```typescript
  midiBaseChannel: 1,  // was 12
```

**Step 2: Run all MIDI protocol tests**

Run: `npm test -- --test-name-pattern "midi" 2>&1 | head -80`
Expected: All PASS.

---

## Task 7: Update buildNRPNFader tests for new defaults

**Files:**
- Modify: `src/__tests__/midi-protocol.test.ts` (buildNRPNFader tests, lines 433-502)

**Step 1: Update buildNRPNFader test expectations**

The tests use hardcoded MIDI channels (e.g., ch=11 for the old default). Update to use ch=0 (new default base) or keep them as unit tests of the builder function (which doesn't depend on resolveStrip). The builder tests just test that given a MIDI channel and strip hex, the bytes are correct — these don't need changing since they test the builder in isolation. Keep as-is.

Actually, review the tests — they use `buildNRPNFader(11, ...)` and `buildNRPNFader(13, ...)` etc. These are testing the byte builder directly and are still valid. No changes needed.

**Step 2: Run full test suite**

Run: `npm test 2>&1 | tail -30`
Expected: All tests pass.

---

## Task 8: Remove stale DEFAULT_MIDI_CHANNELS constant

**Files:**
- Modify: `src/midi-protocol.ts` (lines 68-75)

**Step 1: Check if DEFAULT_MIDI_CHANNELS is used anywhere**

Run: `grep -r "DEFAULT_MIDI_CHANNELS" src/`

If unused (it's not referenced in imports), delete lines 68-75.

**Step 2: Run tests**

Run: `npm test 2>&1 | tail -20`
Expected: All pass, no import errors.

**Step 3: Commit**

```bash
git add src/midi-protocol.ts src/__tests__/midi-protocol.test.ts src/drivers/avantis-driver.ts src/config.ts
git commit -m "fix(avantis): correct MIDI channel/strip mapping to match Companion-verified layout

Updates resolveStrip/reverseResolveStrip to match the Bitfocus Companion
Avantis module addressing, which was verified working on physical hardware.

Key changes:
- Inputs: base+0 (all 64 on one channel)
- Groups: base+1 (was base+3)
- Mix/Aux: base+2 (unchanged)
- Matrix: base+3 (was base+2)
- FX Send/Return, Main, DCA: all on base+4 with correct strip offsets
- DCA 1 = strip 0x36 (was 0x00)
- Main LR = strip 0x30 (was 0x00)
- Mute messages now include trailing note-off (vel 0x00)
- Scene recall supports Bank Select for scenes > 127
- Default midiBaseChannel changed from 12 to 1"
```

---

## Task 9: Type check and verify no downstream breakage

**Files:**
- Check: all TypeScript files

**Step 1: Run type checker**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: No errors.

**Step 2: Run full test suite**

Run: `npm test 2>&1`
Expected: All tests pass.

---

## Summary of Changes

| File | Change |
|---|---|
| `src/midi-protocol.ts` | Rewrite `resolveStrip()` with Companion channel layout, rewrite `reverseResolveStrip()`, update `buildMuteMessage()` to include note-off, update `buildSceneRecall()` with Bank Select, change default baseMidiChannel from 11→0, remove stale `DEFAULT_MIDI_CHANNELS` |
| `src/__tests__/midi-protocol.test.ts` | Update all test expectations to match new mapping |
| `src/drivers/avantis-driver.ts` | Change default `midiBaseChannel` from 12 to 1 |
| `src/config.ts` | Change legacy config default from 12 to 1 |
