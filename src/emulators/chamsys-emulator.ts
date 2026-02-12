/**
 * ChamSys Emulator
 *
 * Virtual ChamSys QuickQ 20 lighting console. Mirrors the real
 * ChamSysDriver's OSC address space:
 *   /pb/{X}/{Y}          Playback X, button Y (go)
 *   /pb/{X}/{Y}/level    Playback fader level (float 0-1)
 *   /exec/{X}            Execute cue X
 *   /release/{X}         Release playback X
 *
 * The real driver is a transparent UDP OSC relay; this emulator
 * tracks state instead of forwarding.
 */

import { DeviceConfig, HubContext } from '../drivers/device-driver';
import { DeviceEmulator } from './device-emulator';

interface PlaybackState {
  level: number;
  active: boolean;
}

export class ChamSysEmulator extends DeviceEmulator {
  readonly name: string;
  readonly prefix: string;

  private playbacks: Map<string, PlaybackState> = new Map();
  private lastExec: number = 0;
  private lastRelease: number = 0;

  constructor(config: DeviceConfig, hubContext: HubContext, verbose = false) {
    super(config, hubContext, verbose);
    this.name = config.name ?? 'chamsys';
    this.prefix = config.prefix;
  }

  handleOSC(address: string, args: any[]): void {
    const addr = address.toLowerCase().replace(/\/$/, '');
    const parts = addr.split('/').filter(Boolean);

    if (parts.length === 0) return;

    switch (parts[0]) {
      case 'pb':
        this.handlePlayback(parts.slice(1), args);
        break;
      case 'exec':
        if (parts.length >= 2) {
          const n = parseInt(parts[1], 10);
          if (!isNaN(n)) {
            this.lastExec = n;
            this.log('Execute', `cue ${n}`);
          }
        }
        break;
      case 'release':
        if (parts.length >= 2) {
          const n = parseInt(parts[1], 10);
          if (!isNaN(n)) {
            this.lastRelease = n;
            // Deactivate any playback with this X value
            for (const [key, state] of this.playbacks) {
              if (key.startsWith(`${n}/`)) {
                state.active = false;
              }
            }
            this.log('Release', `playback ${n}`);
          }
        }
        break;
      default:
        this.log('Unhandled', `${address} [${this.formatArgs(args)}]`);
    }
  }

  /** ChamSys doesn't use the fade engine */
  protected onFadeTick(_key: string, _value: number): void {
    // No-op
  }

  getState(): Record<string, any> {
    const pbState: Record<string, PlaybackState> = {};
    for (const [key, state] of this.playbacks) {
      pbState[key] = { ...state };
    }

    return {
      playbacks: pbState,
      lastExec: this.lastExec,
      lastRelease: this.lastRelease,
    };
  }

  private handlePlayback(parts: string[], args: any[]): void {
    if (parts.length < 2) return;

    const x = parts[0];
    const y = parts[1];
    const key = `${x}/${y}`;

    // /pb/{X}/{Y}/level float
    if (parts.length >= 3 && parts[2] === 'level') {
      const level = this.getFloat(args);
      const state = this.getOrCreatePlayback(key);
      state.level = level;
      this.log('Playback', `${key} level → ${level.toFixed(2)}`);
      return;
    }

    // /pb/{X}/{Y} — go (activate)
    const state = this.getOrCreatePlayback(key);
    state.active = true;
    this.log('Playback', `${key} GO`);
  }

  private getOrCreatePlayback(key: string): PlaybackState {
    let state = this.playbacks.get(key);
    if (!state) {
      state = { level: 1.0, active: false };
      this.playbacks.set(key, state);
    }
    return state;
  }

  // --- Helpers ---

  private getFloat(args: any[], index = 0): number {
    if (!args || args.length <= index) return 0;
    const arg = args[index];
    const val = typeof arg === 'object' && arg.value !== undefined ? arg.value : arg;
    return typeof val === 'number' ? val : parseFloat(val) || 0;
  }

  private formatArgs(args: any[]): string {
    return args.map(a => {
      if (typeof a === 'object' && a.value !== undefined) return a.value;
      return a;
    }).join(', ');
  }
}
