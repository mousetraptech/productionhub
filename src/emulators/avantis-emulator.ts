/**
 * Avantis Emulator
 *
 * Virtual Allen & Heath Avantis mixer. Mirrors the real AvantisDriver's
 * OSC address space exactly:
 *   /ch/{1-64}/mix/fader|mute|pan|fade
 *   /mix/{1-12}/mix/fader|mute|pan|fade
 *   /fxsend/{1-4}/mix/fader|mute|pan
 *   /fxrtn/{1-8}/mix/fader|mute|pan
 *   /dca/{1-16}/fader|mute
 *   /grp/{1-16}/mix/fader|mute|pan
 *   /mtx/{1-6}/mix/fader|mute|pan
 *   /main/mix/fader|mute|pan
 *   /scene/recall
 *
 * State: every strip has fader (0-1), mute (bool), pan (0-1).
 * Emits feedback on every state change for round-trip testing.
 */

import { DeviceConfig, HubContext, OscArg } from '../drivers/device-driver';
import { DeviceEmulator } from './device-emulator';

interface StripState {
  fader: number;
  mute: boolean;
  pan: number;
}

/** Strip type definitions matching midi-protocol.ts */
const STRIP_COUNTS: Record<string, number> = {
  ch: 64,
  mix: 12,
  fxsend: 4,
  fxrtn: 8,
  dca: 16,
  grp: 16,
  mtx: 6,
  main: 1,
};

/** Map from fade key prefix to strip type (used by handleFadeTick) */
const FADE_KEY_TO_STRIP: Record<string, string> = {
  input: 'ch',
  mix: 'mix',
  fxsend: 'fxsend',
  fxreturn: 'fxrtn',
  dca: 'dca',
  group: 'grp',
  matrix: 'mtx',
  main: 'main',
};

function defaultStrip(): StripState {
  return { fader: 0, mute: false, pan: 0.5 };
}

export class AvantisEmulator extends DeviceEmulator {
  readonly name: string;
  readonly prefix: string;

  private strips: Map<string, StripState> = new Map();
  private currentScene: number = 0;

  constructor(config: DeviceConfig, hubContext: HubContext, verbose = false) {
    super(config, hubContext, verbose);
    this.name = 'avantis';
    this.prefix = config.prefix;
    this.initStrips();
  }

  private initStrips(): void {
    for (const [type, count] of Object.entries(STRIP_COUNTS)) {
      if (type === 'main') {
        this.strips.set('main', defaultStrip());
      } else {
        for (let i = 1; i <= count; i++) {
          this.strips.set(`${type}/${i}`, defaultStrip());
        }
      }
    }
  }

  handleOSC(address: string, args: any[]): void {
    const addr = address.toLowerCase().replace(/\/$/, '');
    const parts = addr.split('/').filter(Boolean);

    if (parts.length === 0) return;

    switch (parts[0]) {
      case 'ch':
      case 'mix':
      case 'fxsend':
      case 'fxrtn':
      case 'grp':
      case 'mtx':
        if (parts.length >= 2) {
          const n = parseInt(parts[1], 10);
          if (!isNaN(n)) {
            this.handleStripCommand(parts[0], n, parts.slice(2), args);
          }
        }
        break;
      case 'dca':
        if (parts.length >= 2) {
          const n = parseInt(parts[1], 10);
          if (!isNaN(n)) {
            const sub = parts.slice(2);
            // /dca/{n}/fader or /dca/{n}/mute (short form)
            if (sub.length === 1 && sub[0] === 'fader') {
              this.setFader(`dca/${n}`, this.getFloat(args), `/dca/${n}/fader`);
              return;
            }
            if (sub.length === 1 && sub[0] === 'mute') {
              this.setMute(`dca/${n}`, this.getBool(args), `/dca/${n}/mute`);
              return;
            }
            this.handleStripCommand('dca', n, sub, args);
          }
        }
        break;
      case 'main':
        this.handleStripCommand('main', 1, parts.slice(1), args);
        break;
      case 'scene':
        if (parts[1] === 'recall') {
          this.handleSceneRecall(args);
        }
        break;
      case 'fade':
        if (parts[1] === 'stop') {
          // Per-driver fade stop
          if (args.length > 0) {
            const key = `${this.name}:${this.getString(args)}`;
            this.hubContext.cancelFade(key, true);
            this.log('FadeStop', key);
          }
        }
        break;
      default:
        this.log('Unhandled', `${address} [${this.formatArgs(args)}]`);
    }
  }

  protected onFadeTick(key: string, value: number): void {
    // Key format: "stripType/number/param" e.g. "input/1/fader"
    const parts = key.split('/');
    if (parts.length !== 3) return;

    const [fadeType, numStr, param] = parts;
    const stripType = FADE_KEY_TO_STRIP[fadeType];
    if (!stripType) return;

    const stripKey = stripType === 'main' ? 'main' : `${stripType}/${numStr}`;
    const strip = this.strips.get(stripKey);
    if (!strip) return;

    if (param === 'fader') {
      strip.fader = value;
      const oscPrefix = this.stripToOSCPrefix(stripKey);
      this.emitFeedback(`${oscPrefix}/mix/fader`, [{ type: 'f', value }]);
    } else if (param === 'pan') {
      strip.pan = value;
      const oscPrefix = this.stripToOSCPrefix(stripKey);
      this.emitFeedback(`${oscPrefix}/mix/pan`, [{ type: 'f', value }]);
    }
  }

  getState(): Record<string, any> {
    const state: Record<string, any> = {
      currentScene: this.currentScene,
      strips: {} as Record<string, StripState>,
    };

    for (const [key, strip] of this.strips) {
      // Only include non-default strips to keep state readable
      if (strip.fader !== 0 || strip.mute !== false || strip.pan !== 0.5) {
        (state.strips as Record<string, StripState>)[key] = { ...strip };
      }
    }

    return state;
  }

  // --- Strip command dispatch ---

  private handleStripCommand(stripType: string, num: number, subParts: string[], args: any[]): void {
    const paramPath = subParts.join('/');
    const stripKey = stripType === 'main' ? 'main' : `${stripType}/${num}`;
    const oscPrefix = stripType === 'main' ? '/main' : `/${stripType}/${num}`;

    switch (paramPath) {
      case 'mix/fader':
      case 'fader':
        this.setFader(stripKey, this.getFloat(args), `${oscPrefix}/mix/fader`);
        break;
      case 'mix/mute':
      case 'mute':
        this.setMute(stripKey, this.getBool(args), `${oscPrefix}/mix/mute`);
        break;
      case 'mix/pan':
      case 'pan':
        this.setPan(stripKey, this.getFloat(args), `${oscPrefix}/mix/pan`);
        break;
      case 'mix/fade':
      case 'fade':
        this.handleFadeRequest(stripType, num, 'fader', args);
        break;
      case 'mix/fade/pan':
      case 'fade/pan':
        this.handleFadeRequest(stripType, num, 'pan', args);
        break;
    }
  }

  // --- State setters ---

  private setFader(stripKey: string, value: number, oscAddress: string): void {
    const strip = this.strips.get(stripKey);
    if (!strip) return;

    strip.fader = value;

    // Track in fade engine for fade start values
    const fadeKey = `${this.name}:${this.stripKeyToFadeKey(stripKey)}/fader`;
    this.hubContext.setCurrentValue(fadeKey, value);

    this.emitFeedback(oscAddress, [{ type: 'f', value }]);
    this.log('Fader', `${stripKey} → ${value.toFixed(3)}`);
  }

  private setMute(stripKey: string, value: boolean, oscAddress: string): void {
    const strip = this.strips.get(stripKey);
    if (!strip) return;

    strip.mute = value;

    this.emitFeedback(oscAddress, [{ type: 'i', value: value ? 1 : 0 }]);
    this.log('Mute', `${stripKey} → ${value ? 'ON' : 'OFF'}`);
  }

  private setPan(stripKey: string, value: number, oscAddress: string): void {
    const strip = this.strips.get(stripKey);
    if (!strip) return;

    strip.pan = value;

    const fadeKey = `${this.name}:${this.stripKeyToFadeKey(stripKey)}/pan`;
    this.hubContext.setCurrentValue(fadeKey, value);

    this.emitFeedback(oscAddress, [{ type: 'f', value }]);
    this.log('Pan', `${stripKey} → ${value.toFixed(3)}`);
  }

  private handleSceneRecall(args: any[]): void {
    const scene = this.getInt(args);
    this.currentScene = scene;

    // Reset all strips to defaults
    for (const strip of this.strips.values()) {
      strip.fader = 0;
      strip.mute = false;
      strip.pan = 0.5;
    }

    this.emitFeedback('/scene/current', [{ type: 'i', value: scene }]);
    this.log('Scene', `Recall → ${scene} (all strips reset)`);
  }

  private handleFadeRequest(stripType: string, num: number, param: 'fader' | 'pan', args: any[]): void {
    if (args.length < 2) {
      this.log('FadeError', `Fade requires at least 2 args (target, duration), got ${args.length}`);
      return;
    }

    const targetValue = this.getFloat(args);
    const durationSecs = this.getFloat(args, 1);
    const easingStr = args.length >= 3 ? this.getString(args, 2) : 'scurve';
    const easing = (['linear', 'scurve', 'easein', 'easeout'].includes(easingStr)
      ? easingStr
      : 'scurve') as 'linear' | 'scurve' | 'easein' | 'easeout';

    const stripKey = stripType === 'main' ? 'main' : `${stripType}/${num}`;
    const fadeKeyBase = this.stripKeyToFadeKey(stripKey);
    const fadeKey = `${this.name}:${fadeKeyBase}/${param}`;

    this.log('Fade', `${stripKey}/${param}: → ${targetValue.toFixed(3)} over ${durationSecs}s (${easing})`);

    this.hubContext.startFade({
      key: fadeKey,
      startValue: 0,
      endValue: targetValue,
      durationMs: durationSecs * 1000,
      easing,
    });
  }

  // --- Helpers ---

  /** Convert strip key "ch/1" to fade engine key "input/1" */
  private stripKeyToFadeKey(stripKey: string): string {
    const [type, num] = stripKey.split('/');
    const fadeType = Object.entries(FADE_KEY_TO_STRIP).find(([_, v]) => v === type)?.[0] ?? type;
    return num ? `${fadeType}/${num}` : fadeType;
  }

  /** Convert strip key "ch/1" to OSC prefix "/ch/1" */
  private stripToOSCPrefix(stripKey: string): string {
    return `/${stripKey}`;
  }

  private getFloat(args: any[], index = 0): number {
    if (!args || args.length <= index) return 0;
    const arg = args[index];
    const val = typeof arg === 'object' && arg.value !== undefined ? arg.value : arg;
    return typeof val === 'number' ? val : parseFloat(val) || 0;
  }

  private getInt(args: any[], index = 0): number {
    if (!args || args.length <= index) return 0;
    const arg = args[index];
    const val = typeof arg === 'object' && arg.value !== undefined ? arg.value : arg;
    return typeof val === 'number' ? Math.round(val) : parseInt(val, 10) || 0;
  }

  private getBool(args: any[], index = 0): boolean {
    return this.getInt(args, index) >= 1;
  }

  private getString(args: any[], index = 0): string {
    if (!args || args.length <= index) return '';
    const arg = args[index];
    const val = typeof arg === 'object' && arg.value !== undefined ? arg.value : arg;
    return String(val);
  }

  private formatArgs(args: any[]): string {
    return args.map(a => {
      if (typeof a === 'object' && a.value !== undefined) return a.value;
      return a;
    }).join(', ');
  }
}
