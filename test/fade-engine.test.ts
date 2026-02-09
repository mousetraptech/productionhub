import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FadeEngine, fadeKey } from '../src/fade-engine';

describe('FadeEngine', () => {
  let engine: FadeEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    engine = new FadeEngine();
    engine.start();
  });

  afterEach(() => {
    engine.stop();
    vi.useRealTimers();
  });

  it('emits values during a linear fade', () => {
    const values: number[] = [];
    engine.on('value', (_key: string, val: number) => values.push(val));

    engine.startFade({
      key: 'input/1/fader',
      startValue: 0,
      endValue: 1,
      durationMs: 100,
      easing: 'linear',
    });

    // Tick through 5 intervals (20ms each = 100ms)
    vi.advanceTimersByTime(20);
    vi.advanceTimersByTime(20);
    vi.advanceTimersByTime(20);
    vi.advanceTimersByTime(20);
    vi.advanceTimersByTime(20);

    expect(values.length).toBeGreaterThanOrEqual(4);
    // First tick at ~20ms: progress ~0.2, last tick: progress = 1.0
    expect(values[values.length - 1]).toBeCloseTo(1.0, 1);
  });

  it('starts from tracked current value when available', () => {
    engine.setCurrentValue('input/1/fader', 0.5);

    const values: number[] = [];
    engine.on('value', (_key: string, val: number) => values.push(val));

    engine.startFade({
      key: 'input/1/fader',
      startValue: 0, // this should be ignored in favor of 0.5
      endValue: 1,
      durationMs: 100,
      easing: 'linear',
    });

    vi.advanceTimersByTime(20);

    // First value should be somewhere between 0.5 and 1.0, not near 0
    expect(values[0]).toBeGreaterThanOrEqual(0.5);
  });

  it('uses startValue as fallback when no current value tracked', () => {
    const values: number[] = [];
    engine.on('value', (_key: string, val: number) => values.push(val));

    engine.startFade({
      key: 'input/99/fader',
      startValue: 0.3,
      endValue: 0.8,
      durationMs: 100,
      easing: 'linear',
    });

    vi.advanceTimersByTime(20);

    // First value should be near 0.3 (start) + a bit of progress toward 0.8
    expect(values[0]).toBeGreaterThan(0.29);
    expect(values[0]).toBeLessThan(0.6);
  });

  it('handles mid-fade replacement — picks up from current position', () => {
    engine.setCurrentValue('input/1/fader', 0);

    engine.startFade({
      key: 'input/1/fader',
      startValue: 0,
      endValue: 1,
      durationMs: 100,
      easing: 'linear',
    });

    // Run halfway
    vi.advanceTimersByTime(50);

    const midValue = engine.getCurrentValue('input/1/fader');
    expect(midValue).toBeDefined();
    expect(midValue!).toBeGreaterThan(0.3);
    expect(midValue!).toBeLessThan(0.7);

    // Now replace with a new fade going back to 0
    engine.startFade({
      key: 'input/1/fader',
      startValue: 0, // should be ignored
      endValue: 0,
      durationMs: 100,
      easing: 'linear',
    });

    const values: number[] = [];
    engine.on('value', (_key: string, val: number) => values.push(val));

    vi.advanceTimersByTime(20);

    // Should be heading down from ~0.5 toward 0, not starting from 0
    expect(values[0]).toBeGreaterThan(0.1);
  });

  it('emits fadeComplete when a fade finishes', () => {
    const completed: string[] = [];
    engine.on('fadeComplete', (key: string) => completed.push(key));

    engine.startFade({
      key: 'dca/1/fader',
      startValue: 0,
      endValue: 1,
      durationMs: 60,
      easing: 'linear',
    });

    vi.advanceTimersByTime(100);

    expect(completed).toContain('dca/1/fader');
    expect(engine.activeCount).toBe(0);
  });

  it('cancelFade with snap sends final value', () => {
    const values: Array<[string, number]> = [];
    engine.on('value', (key: string, val: number) => values.push([key, val]));

    engine.startFade({
      key: 'input/1/fader',
      startValue: 0,
      endValue: 0.75,
      durationMs: 1000,
      easing: 'linear',
    });

    engine.cancelFade('input/1/fader', true);

    // Should have emitted the target value
    const snapped = values.find(([k, v]) => k === 'input/1/fader' && Math.abs(v - 0.75) < 0.01);
    expect(snapped).toBeDefined();
    expect(engine.activeCount).toBe(0);
  });

  it('cancelAll stops everything', () => {
    engine.startFade({ key: 'a', startValue: 0, endValue: 1, durationMs: 1000, easing: 'linear' });
    engine.startFade({ key: 'b', startValue: 0, endValue: 1, durationMs: 1000, easing: 'linear' });
    expect(engine.activeCount).toBe(2);

    engine.cancelAll();
    expect(engine.activeCount).toBe(0);
  });

  it('runs multiple concurrent fades independently', () => {
    const valuesA: number[] = [];
    const valuesB: number[] = [];
    engine.on('value', (key: string, val: number) => {
      if (key === 'a') valuesA.push(val);
      if (key === 'b') valuesB.push(val);
    });

    engine.startFade({ key: 'a', startValue: 0, endValue: 1, durationMs: 100, easing: 'linear' });
    engine.startFade({ key: 'b', startValue: 1, endValue: 0, durationMs: 100, easing: 'linear' });

    vi.advanceTimersByTime(120);

    expect(valuesA.length).toBeGreaterThan(0);
    expect(valuesB.length).toBeGreaterThan(0);
    // A should end at 1, B should end at 0
    expect(valuesA[valuesA.length - 1]).toBeCloseTo(1, 1);
    expect(valuesB[valuesB.length - 1]).toBeCloseTo(0, 1);
  });
});

describe('fadeKey', () => {
  it('builds key from parts', () => {
    expect(fadeKey('input', 1, 'fader')).toBe('input/1/fader');
    expect(fadeKey('dca', 5, 'pan')).toBe('dca/5/pan');
  });
});
