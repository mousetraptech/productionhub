import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { setTimeout as delay } from 'node:timers/promises';
import { EventEmitter } from 'events';
import { FadeEngine, fadeKey, type FadeRequest } from '../fade-engine';

describe('FadeEngine', () => {
  let engine: FadeEngine;

  before(() => {
    engine = new FadeEngine();
  });

  after(() => {
    engine.stop();
  });

  describe('fadeKey', () => {
    it('should create a properly formatted fade key', () => {
      const key = fadeKey('input', 1, 'fader');
      assert.strictEqual(key, 'input/1/fader');
    });

    it('should handle different strip types and numbers', () => {
      assert.strictEqual(fadeKey('dca', 2, 'fader'), 'dca/2/fader');
      assert.strictEqual(fadeKey('output', 16, 'level'), 'output/16/level');
    });
  });

  describe('setCurrentValue / getCurrentValue', () => {
    it('should set and retrieve a current value', () => {
      const key = 'test/1/level';
      engine.setCurrentValue(key, 0.75);
      assert.strictEqual(engine.getCurrentValue(key), 0.75);
    });

    it('should return undefined for unknown keys', () => {
      const value = engine.getCurrentValue('nonexistent/key');
      assert.strictEqual(value, undefined);
    });

    it('should update existing values', () => {
      const key = 'test/2/level';
      engine.setCurrentValue(key, 0.25);
      assert.strictEqual(engine.getCurrentValue(key), 0.25);
      engine.setCurrentValue(key, 0.5);
      assert.strictEqual(engine.getCurrentValue(key), 0.5);
    });
  });

  describe('Linear fade from 0 to 1', () => {
    it('should interpolate linearly from start to end value', async () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key = 'linear/1/fader';
      const emittedValues: number[] = [];
      let fadeCompleted = false;

      engine.on('value', (k: string, value: number) => {
        if (k === key) {
          emittedValues.push(value);
        }
      });

      engine.on('fadeComplete', (k: string) => {
        if (k === key) {
          fadeCompleted = true;
        }
      });

      engine.setCurrentValue(key, 0); // pre-seed so cold-start snap doesn't fire

      const fadeReq: FadeRequest = {
        key,
        startValue: 0,
        endValue: 1,
        durationMs: 200,
        easing: 'linear',
      };

      engine.startFade(fadeReq);

      // Wait ~100ms and check midpoint
      await delay(100);
      assert.ok(
        emittedValues.length > 0,
        'should have emitted values by 100ms'
      );
      const midpointValue = emittedValues[emittedValues.length - 1];
      assert.ok(
        midpointValue > 0.4 && midpointValue < 0.6,
        `midpoint value ~0.5, got ${midpointValue}`
      );

      // Wait for fade to complete
      await delay(150);
      assert.strictEqual(fadeCompleted, true, 'fadeComplete event should fire');
      assert.strictEqual(
        engine.getCurrentValue(key),
        1.0,
        'final value should be 1.0'
      );
      assert.strictEqual(
        engine.activeCount,
        0,
        'no active fades after completion'
      );

      engine.stop();
    });
  });

  describe('Fade starts from tracked current value', () => {
    it('should use tracked current value as start instead of req.startValue', async () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key = 'tracked/1/fader';
      engine.setCurrentValue(key, 0.5);

      const emittedValues: number[] = [];

      engine.on('value', (k: string, value: number) => {
        if (k === key) {
          emittedValues.push(value);
        }
      });

      const fadeReq: FadeRequest = {
        key,
        startValue: 0, // This should be ignored
        endValue: 1.0,
        durationMs: 200,
        easing: 'linear',
      };

      engine.startFade(fadeReq);

      // Wait a bit for first tick
      await delay(50);

      assert.ok(
        emittedValues.length > 0,
        'should have emitted values'
      );
      const firstValue = emittedValues[0];
      assert.ok(
        firstValue > 0.4,
        `first emitted value should be > 0.4 (started from 0.5), got ${firstValue}`
      );

      engine.stop();
    });
  });

  describe('Fade replaces existing fade', () => {
    it('should replace an existing fade on the same key', async () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key = 'replace/1/fader';
      const fadeCompleted: string[] = [];

      engine.on('fadeComplete', (k: string) => {
        fadeCompleted.push(k);
      });

      // Start first fade
      engine.setCurrentValue(key, 0);
      engine.startFade({
        key,
        startValue: 0,
        endValue: 1,
        durationMs: 500,
        easing: 'linear',
      });

      assert.strictEqual(engine.activeCount, 1, 'should have 1 active fade');

      // Immediately start second fade on same key (current value tracked by engine)
      await delay(10);
      engine.startFade({
        key,
        startValue: 0.5,
        endValue: 0,
        durationMs: 100,
        easing: 'linear',
      });

      assert.strictEqual(engine.activeCount, 1, 'should still have 1 active fade');

      // Wait for second fade to complete
      await delay(150);
      assert.strictEqual(
        fadeCompleted.filter((k) => k === key).length,
        1,
        'fadeComplete should fire once'
      );

      engine.stop();
    });
  });

  describe('cancelFade with snapToTarget', () => {
    it('should cancel a fade and snap to target value', async () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key = 'snap/1/fader';
      const emittedValues: number[] = [];

      engine.on('value', (k: string, value: number) => {
        if (k === key) {
          emittedValues.push(value);
        }
      });

      engine.setCurrentValue(key, 0);
      engine.startFade({
        key,
        startValue: 0,
        endValue: 1,
        durationMs: 500,
        easing: 'linear',
      });

      await delay(100);
      const valueBeforeCancel = engine.getCurrentValue(key);
      assert.ok(
        valueBeforeCancel !== undefined && valueBeforeCancel > 0,
        'should have progressed'
      );

      engine.cancelFade(key, true);

      // Check that snapToTarget emitted the end value
      const snappedValue = emittedValues[emittedValues.length - 1];
      assert.strictEqual(
        snappedValue,
        1,
        'last emitted value should be end value (1)'
      );
      assert.strictEqual(engine.activeCount, 0, 'should have no active fades');
      assert.strictEqual(
        engine.getCurrentValue(key),
        1,
        'current value should be end value'
      );

      engine.stop();
    });

    it('should cancel a fade without snapping', async () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key = 'nosnap/1/fader';
      const emittedValues: number[] = [];

      engine.on('value', (k: string, value: number) => {
        if (k === key) {
          emittedValues.push(value);
        }
      });

      engine.setCurrentValue(key, 0);
      engine.startFade({
        key,
        startValue: 0,
        endValue: 1,
        durationMs: 500,
        easing: 'linear',
      });

      await delay(100);
      const emittedCountBeforeCancel = emittedValues.length;

      engine.cancelFade(key, false);

      // No snap means no final value event
      assert.strictEqual(
        emittedValues.length,
        emittedCountBeforeCancel,
        'should not emit additional value on cancel without snap'
      );
      assert.strictEqual(engine.activeCount, 0, 'should have no active fades');

      engine.stop();
    });
  });

  describe('cancelAll', () => {
    it('should cancel all active fades', async () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key1 = 'multi/1/fader';
      const key2 = 'multi/2/fader';

      engine.setCurrentValue(key1, 0);
      engine.startFade({
        key: key1,
        startValue: 0,
        endValue: 1,
        durationMs: 500,
        easing: 'linear',
      });

      engine.setCurrentValue(key2, 0);
      engine.startFade({
        key: key2,
        startValue: 0,
        endValue: 1,
        durationMs: 500,
        easing: 'linear',
      });

      assert.strictEqual(engine.activeCount, 2, 'should have 2 active fades');

      engine.cancelAll();
      assert.strictEqual(engine.activeCount, 0, 'should have 0 active fades');

      engine.stop();
    });
  });

  describe('Multiple concurrent fades', () => {
    it('should handle multiple fades on different keys independently', async () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key1 = 'input/1/fader';
      const key2 = 'dca/1/fader';

      const values: Record<string, number[]> = {
        [key1]: [],
        [key2]: [],
      };

      engine.on('value', (k: string, value: number) => {
        if (k === key1 || k === key2) {
          values[k].push(value);
        }
      });

      engine.setCurrentValue(key1, 0);
      engine.startFade({
        key: key1,
        startValue: 0,
        endValue: 1,
        durationMs: 200,
        easing: 'linear',
      });

      engine.setCurrentValue(key2, 1);
      engine.startFade({
        key: key2,
        startValue: 1,
        endValue: 0,
        durationMs: 200,
        easing: 'linear',
      });

      assert.strictEqual(engine.activeCount, 2, 'should have 2 active fades');

      await delay(100);

      assert.ok(values[key1].length > 0, 'key1 should have emitted values');
      assert.ok(values[key2].length > 0, 'key2 should have emitted values');

      // key1 should be increasing (0 to 1)
      const key1First = values[key1][0];
      const key1Last = values[key1][values[key1].length - 1];
      assert.ok(
        key1Last > key1First,
        `key1 should increase: ${key1First} -> ${key1Last}`
      );

      // key2 should be decreasing (1 to 0)
      const key2First = values[key2][0];
      const key2Last = values[key2][values[key2].length - 1];
      assert.ok(
        key2Last < key2First,
        `key2 should decrease: ${key2First} -> ${key2Last}`
      );

      // Wait for completion
      await delay(150);
      assert.strictEqual(
        engine.activeCount,
        0,
        'both fades should be complete'
      );

      engine.stop();
    });
  });

  describe('stop() clears everything', () => {
    it('should stop the ticker and clear all fades', async () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key = 'stop/1/fader';
      let valueEmitted = false;

      engine.on('value', (k: string) => {
        if (k === key) {
          valueEmitted = true;
        }
      });

      engine.setCurrentValue(key, 0);
      engine.startFade({
        key,
        startValue: 0,
        endValue: 1,
        durationMs: 500,
        easing: 'linear',
      });

      assert.strictEqual(engine.activeCount, 1, 'should have 1 active fade');

      engine.stop();
      assert.strictEqual(engine.activeCount, 0, 'activeCount should be 0');

      // Reset for next test
      valueEmitted = false;
      await delay(100);

      // Even if we call start again, the old fade is gone
      engine.start();
      await delay(50);

      assert.strictEqual(
        valueEmitted,
        false,
        'no value events should fire from cleared fade'
      );

      engine.stop();
    });
  });

  describe('Easing curves', () => {
    it('should apply linear easing', async () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key = 'easing/linear';
      const values: number[] = [];

      engine.on('value', (k: string, value: number) => {
        if (k === key) values.push(value);
      });

      engine.setCurrentValue(key, 0);
      engine.startFade({
        key,
        startValue: 0,
        endValue: 1,
        durationMs: 200,
        easing: 'linear',
      });

      await delay(100);
      const midValue = values[values.length - 1];
      assert.ok(
        midValue > 0.3 && midValue < 0.7,
        `linear easing at ~50% should be roughly 0.5, got ${midValue}`
      );

      engine.stop();
    });

    it('should apply easeout easing', async () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key = 'easing/easeout';
      const values: number[] = [];

      engine.on('value', (k: string, value: number) => {
        if (k === key) values.push(value);
      });

      engine.setCurrentValue(key, 0);
      engine.startFade({
        key,
        startValue: 0,
        endValue: 1,
        durationMs: 200,
        easing: 'easeout',
      });

      await delay(100);
      const midValue = values[values.length - 1];
      // easeout at t=0.5: t*(2-t) = 0.5*1.5 = 0.75
      // easeout moves faster at the start; at ~50% time, value should be well above linear
      assert.ok(
        midValue > 0.55,
        `easeout easing at ~50% should be > 0.55 (above linear), got ${midValue}`
      );

      engine.stop();
    });

    it('should apply easein easing', async () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key = 'easing/easein';
      const values: number[] = [];

      engine.on('value', (k: string, value: number) => {
        if (k === key) values.push(value);
      });

      engine.setCurrentValue(key, 0);
      engine.startFade({
        key,
        startValue: 0,
        endValue: 1,
        durationMs: 200,
        easing: 'easein',
      });

      await delay(100);
      const midValue = values[values.length - 1];
      // easein at t=0.5: t*t = 0.25
      assert.ok(
        midValue < 0.3,
        `easein easing at 50% should be < 0.3, got ${midValue}`
      );

      engine.stop();
    });

    it('should apply scurve easing', async () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key = 'easing/scurve';
      const values: number[] = [];

      engine.on('value', (k: string, value: number) => {
        if (k === key) values.push(value);
      });

      engine.setCurrentValue(key, 0);
      engine.startFade({
        key,
        startValue: 0,
        endValue: 1,
        durationMs: 200,
        easing: 'scurve',
      });

      await delay(50);
      const earlyValue = values[values.length - 1];

      await delay(50);
      const midValue = values[values.length - 1];

      // S-curve is slow at start and end, fast in middle
      // Early progress (t=0.25) should be < linear (0.25)
      assert.ok(
        earlyValue < 0.15,
        `scurve at 25% should be slower than linear, got ${earlyValue}`
      );

      engine.stop();
    });
  });

  describe('EventEmitter behavior', () => {
    it('should extend EventEmitter', () => {
      assert.ok(engine instanceof EventEmitter, 'FadeEngine should extend EventEmitter');
    });

    it('should allow multiple listeners on the same event', async () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key = 'multi/listener';
      const count1: number[] = [];
      const count2: number[] = [];

      engine.on('value', (k: string) => {
        if (k === key) count1.push(1);
      });

      engine.on('value', (k: string) => {
        if (k === key) count2.push(1);
      });

      engine.setCurrentValue(key, 0);
      engine.startFade({
        key,
        startValue: 0,
        endValue: 1,
        durationMs: 100,
        easing: 'linear',
      });

      await delay(60);

      assert.strictEqual(
        count1.length,
        count2.length,
        'both listeners should receive same number of events'
      );
      assert.ok(count1.length > 0, 'should have received events');

      engine.stop();
    });
  });

  describe('Cold start snap behavior', () => {
    it('should snap to target when no current value is tracked', () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key = 'coldstart/1/fader';
      const emittedValues: number[] = [];
      let completed = false;

      engine.on('value', (k: string, value: number) => {
        if (k === key) emittedValues.push(value);
      });

      engine.on('fadeComplete', (k: string) => {
        if (k === key) completed = true;
      });

      // No setCurrentValue — cold start!
      engine.startFade({
        key,
        startValue: 0,
        endValue: 0.75,
        durationMs: 2000,
        easing: 'linear',
      });

      // Should have snapped immediately — no active fade
      assert.strictEqual(engine.activeCount, 0, 'should not create an active fade');
      assert.strictEqual(emittedValues.length, 1, 'should emit exactly one value');
      assert.strictEqual(emittedValues[0], 0.75, 'should snap to target value');
      assert.strictEqual(engine.getCurrentValue(key), 0.75, 'tracked value should be target');
      assert.strictEqual(completed, true, 'should emit fadeComplete');

      engine.stop();
    });

    it('should not snap when current value is tracked', async () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key = 'warmstart/1/fader';
      engine.setCurrentValue(key, 0.5);

      engine.startFade({
        key,
        startValue: 0,
        endValue: 1.0,
        durationMs: 200,
        easing: 'linear',
      });

      // Should create an active fade (not snap)
      assert.strictEqual(engine.activeCount, 1, 'should have an active fade');

      await delay(50);
      const currentVal = engine.getCurrentValue(key)!;
      // Should be between 0.5 and 1.0 (fading from tracked value, not 0)
      assert.ok(currentVal > 0.5, `should be fading from 0.5, got ${currentVal}`);

      engine.stop();
    });
  });

  describe('Edge cases', () => {
    it('should handle zero duration fade', async () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key = 'zero/duration';
      let completed = false;

      engine.on('fadeComplete', (k: string) => {
        if (k === key) completed = true;
      });

      engine.setCurrentValue(key, 0);
      engine.startFade({
        key,
        startValue: 0,
        endValue: 1,
        durationMs: 0,
        easing: 'linear',
      });

      await delay(50);
      assert.strictEqual(completed, true, 'should complete immediately');

      engine.stop();
    });

    it('should handle very short durations', async () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key = 'short/duration';
      let completed = false;

      engine.on('fadeComplete', (k: string) => {
        if (k === key) completed = true;
      });

      engine.setCurrentValue(key, 0);
      engine.startFade({
        key,
        startValue: 0,
        endValue: 1,
        durationMs: 10,
        easing: 'linear',
      });

      await delay(50);
      assert.strictEqual(completed, true, 'should complete quickly');

      engine.stop();
    });

    it('should handle same start and end values', async () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key = 'same/values';
      const values: number[] = [];

      engine.on('value', (k: string, value: number) => {
        if (k === key) values.push(value);
      });

      engine.setCurrentValue(key, 0.5);
      engine.startFade({
        key,
        startValue: 0.5,
        endValue: 0.5,
        durationMs: 100,
        easing: 'linear',
      });

      await delay(60);
      const allValuesAreSame = values.every((v) => v === 0.5);
      assert.strictEqual(
        allValuesAreSame,
        true,
        'all emitted values should be 0.5'
      );

      engine.stop();
    });

    it('should handle negative deltas (fade down)', async () => {
      engine.stop();
      engine = new FadeEngine();
      engine.start();

      const key = 'fade/down';
      const values: number[] = [];

      engine.on('value', (k: string, value: number) => {
        if (k === key) values.push(value);
      });

      engine.setCurrentValue(key, 1);
      engine.startFade({
        key,
        startValue: 1,
        endValue: 0,
        durationMs: 200,
        easing: 'linear',
      });

      await delay(100);
      const midValue = values[values.length - 1];
      assert.ok(
        midValue > 0.4 && midValue < 0.6,
        `fade down at 50% should be ~0.5, got ${midValue}`
      );

      await delay(150);
      assert.strictEqual(
        engine.getCurrentValue(key),
        0,
        'final value should be 0'
      );

      engine.stop();
    });
  });
});
