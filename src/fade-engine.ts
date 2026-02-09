/**
 * Fade Engine
 *
 * Handles timed parameter interpolation at high resolution.
 * Instead of relying on the OSC client to send 128 discrete steps,
 * this engine accepts a target + duration and smoothly interpolates
 * at ~50Hz (20ms intervals), sending MIDI updates each tick.
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

const TICK_INTERVAL_MS = 20; // 50Hz update rate

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
   * Falls back to req.startValue only if we've never seen this key before.
   */
  startFade(req: FadeRequest): void {
    const currentVal = this.currentValues.get(req.key);
    const startValue = currentVal !== undefined ? currentVal : req.startValue;

    const fade: ActiveFade = {
      key: req.key,
      startValue,
      endValue: req.endValue,
      startTime: Date.now(),
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

    const now = Date.now();
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
