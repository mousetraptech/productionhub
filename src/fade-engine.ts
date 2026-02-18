/**
 * Fade Engine
 *
 * Handles timed parameter interpolation at high resolution.
 * Instead of relying on the OSC client to send 128 discrete steps,
 * this engine accepts a target + duration and smoothly interpolates
 * at ~100Hz (10ms intervals), sending updates each tick.
 * The driver layer deduplicates so only actual value changes hit the wire.
 *
 * Supports multiple concurrent fades on different strips.
 * Starting a new fade on the same strip+param cancels the previous one.
 *
 * Easing curves:
 *   - linear (default)
 *   - scurve (sine-based S-curve, natural fader feel)
 *   - easein
 *   - easeout
 */

import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';

export type EasingType = 'linear' | 'scurve' | 'easein' | 'easeout';

export interface FadeRequest {
  key: string;           // unique key like "input/1/fader"
  startValue: number;    // 0.0-1.0
  endValue: number;      // 0.0-1.0
  durationMs: number;    // milliseconds
  easing: EasingType;
}

interface ActiveFade {
  key: string;
  startValue: number;
  endValue: number;
  startTime: number;
  durationMs: number;
  easing: EasingType;
}

const TICK_INTERVAL_MS = 10; // 100Hz update rate — smoother fades

export class FadeEngine extends EventEmitter {
  private activeFades: Map<string, ActiveFade> = new Map();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private currentValues: Map<string, number> = new Map();

  start(): void {
    if (this.tickTimer) return;
    this.tickTimer = setInterval(() => this.tick(), TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.activeFades.clear();
  }

  /**
   * Start a fade. Always starts from the last known value for this key
   * (whether set by a previous fade tick or a direct fader set).
   *
   * Cold start behavior: if we've never seen a value for this key (e.g.
   * no feedback from the desk yet), we snap-set to the target immediately
   * instead of fading from an arbitrary fallback. This prevents audible
   * jumps — a fader at 0.8 on the desk shouldn't suddenly drop to 0 just
   * because we haven't received NRPN feedback yet.
   */
  startFade(req: FadeRequest): void {
    const currentVal = this.currentValues.get(req.key);
    if (currentVal === undefined) {
      console.warn(
        `[Fade] Cold start: no known value for "${req.key}" — snapping to target ${req.endValue}. ` +
        `Move the fader or send a direct set first to enable smooth fading.`
      );
      // Snap to target immediately — better than fading from wrong value
      this.currentValues.set(req.key, req.endValue);
      this.emit('value', req.key, req.endValue);
      this.emit('fadeComplete', req.key);
      return;
    }

    const fade: ActiveFade = {
      key: req.key,
      startValue: currentVal,
      endValue: req.endValue,
      startTime: performance.now(),
      durationMs: req.durationMs,
      easing: req.easing,
    };

    this.activeFades.set(req.key, fade);
  }

  /** Immediately stop a fade and optionally snap to target */
  cancelFade(key: string, snapToTarget = false): void {
    const fade = this.activeFades.get(key);
    if (fade && snapToTarget) {
      this.emit('value', key, fade.endValue);
      this.currentValues.set(key, fade.endValue);
    }
    this.activeFades.delete(key);
  }

  /** Cancel all active fades */
  cancelAll(): void {
    this.activeFades.clear();
  }

  /** Set the known current value for a key (used when a direct set comes in) */
  setCurrentValue(key: string, value: number): void {
    this.currentValues.set(key, value);
  }

  /** Get the last known value for a key, or undefined if never set */
  getCurrentValue(key: string): number | undefined {
    return this.currentValues.get(key);
  }

  /** Get count of active fades */
  get activeCount(): number {
    return this.activeFades.size;
  }

  private tick(): void {
    if (this.activeFades.size === 0) return;

    const now = performance.now();
    const completed: string[] = [];

    for (const [key, fade] of this.activeFades) {
      const elapsed = now - fade.startTime;
      const progress = Math.min(1, elapsed / fade.durationMs);
      const easedProgress = applyEasing(progress, fade.easing);
      const value = fade.startValue + (fade.endValue - fade.startValue) * easedProgress;

      this.currentValues.set(key, value);
      this.emit('value', key, value);

      if (progress >= 1) {
        completed.push(key);
      }
    }

    for (const key of completed) {
      this.activeFades.delete(key);
      this.emit('fadeComplete', key);
    }
  }
}

function applyEasing(t: number, easing: EasingType): number {
  switch (easing) {
    case 'linear':
      return t;
    case 'scurve':
      // Sine-based S-curve: slow start and end, fast middle
      return (1 - Math.cos(t * Math.PI)) / 2;
    case 'easein':
      // Quadratic ease in
      return t * t;
    case 'easeout':
      // Quadratic ease out
      return t * (2 - t);
    default:
      return t;
  }
}

/** Build a fade key from strip type, number, and parameter */
export function fadeKey(stripType: string, number: number, param: string): string {
  return `${stripType}/${number}/${param}`;
}
