/**
 * VISCA Emulator
 *
 * Virtual PTZ camera. Mirrors the real VISCADriver's OSC address space:
 *   /preset/recall/{N}     Recall preset N (0-127)
 *   /preset/store/{N}      Store preset N
 *   /home                  Home position
 *   /pan/speed             float -1.0 to 1.0
 *   /tilt/speed            float -1.0 to 1.0
 *   /pantilt/stop          Stop movement
 *   /pantilt/speed         float pan, float tilt
 *   /zoom/speed            float -1.0 to 1.0
 *   /zoom/direct           float 0.0-1.0
 *   /zoom/stop             Stop zoom
 *   /power/on|off
 *   /focus/auto|manual
 *
 * No feedback is emitted (matching real VISCA driver behavior).
 */

import { DeviceConfig, HubContext } from '../drivers/device-driver';
import { DeviceEmulator } from './device-emulator';

export class VISCAEmulator extends DeviceEmulator {
  readonly name: string;
  readonly prefix: string;

  private currentPreset: number = 0;
  private panSpeed: number = 0;
  private tiltSpeed: number = 0;
  private zoomSpeed: number = 0;
  private zoomPosition: number = 0;
  private power: boolean = true;
  private focusMode: 'auto' | 'manual' = 'auto';
  private storedPresets: Set<number> = new Set();

  constructor(config: DeviceConfig, hubContext: HubContext, verbose = false) {
    super(config, hubContext, verbose);
    this.name = config.name ?? 'visca';
    this.prefix = config.prefix;
  }

  handleOSC(address: string, args: any[]): void {
    const addr = address.toLowerCase().replace(/\/$/, '');
    const parts = addr.split('/').filter(Boolean);

    if (parts.length === 0) return;

    switch (parts[0]) {
      case 'preset':
        this.handlePreset(parts.slice(1));
        break;
      case 'home':
        this.currentPreset = 0;
        this.panSpeed = 0;
        this.tiltSpeed = 0;
        this.log('Home', 'Camera returned to home position');
        break;
      case 'pan':
        if (parts[1] === 'speed') {
          this.panSpeed = this.getFloat(args);
          this.log('Pan', `speed → ${this.panSpeed.toFixed(2)}`);
        }
        break;
      case 'tilt':
        if (parts[1] === 'speed') {
          this.tiltSpeed = this.getFloat(args);
          this.log('Tilt', `speed → ${this.tiltSpeed.toFixed(2)}`);
        }
        break;
      case 'pantilt':
        if (parts[1] === 'stop') {
          this.panSpeed = 0;
          this.tiltSpeed = 0;
          this.log('PanTilt', 'stopped');
        } else if (parts[1] === 'speed') {
          this.panSpeed = this.getFloat(args, 0);
          this.tiltSpeed = this.getFloat(args, 1);
          this.log('PanTilt', `speed → pan=${this.panSpeed.toFixed(2)} tilt=${this.tiltSpeed.toFixed(2)}`);
        }
        break;
      case 'zoom':
        this.handleZoom(parts.slice(1), args);
        break;
      case 'power':
        if (parts[1] === 'on') {
          this.power = true;
          this.log('Power', 'ON');
        } else if (parts[1] === 'off') {
          this.power = false;
          this.log('Power', 'OFF');
        }
        break;
      case 'focus':
        if (parts[1] === 'auto') {
          this.focusMode = 'auto';
          this.log('Focus', 'auto');
        } else if (parts[1] === 'manual') {
          this.focusMode = 'manual';
          this.log('Focus', 'manual');
        }
        break;
      default:
        this.log('Unhandled', `${address} [${this.formatArgs(args)}]`);
    }
  }

  /** VISCA doesn't use the fade engine */
  protected onFadeTick(_key: string, _value: number): void {
    // No-op
  }

  getState(): Record<string, any> {
    return {
      currentPreset: this.currentPreset,
      panSpeed: this.panSpeed,
      tiltSpeed: this.tiltSpeed,
      zoomSpeed: this.zoomSpeed,
      zoomPosition: this.zoomPosition,
      power: this.power,
      focusMode: this.focusMode,
      storedPresets: Array.from(this.storedPresets).sort((a, b) => a - b),
    };
  }

  private handlePreset(parts: string[]): void {
    if (parts.length < 2) return;
    const n = parseInt(parts[1], 10);
    if (isNaN(n) || n < 0 || n > 127) {
      this.log('PresetError', `Out of range (0-127): ${parts[1]}`);
      return;
    }

    if (parts[0] === 'recall') {
      this.currentPreset = n;
      this.log('Preset', `recall → ${n}`);
    } else if (parts[0] === 'store') {
      this.storedPresets.add(n);
      this.log('Preset', `store → ${n}`);
    }
  }

  private handleZoom(parts: string[], args: any[]): void {
    if (parts.length === 0) return;

    if (parts[0] === 'speed') {
      this.zoomSpeed = this.getFloat(args);
      this.log('Zoom', `speed → ${this.zoomSpeed.toFixed(2)}`);
    } else if (parts[0] === 'stop') {
      this.zoomSpeed = 0;
      this.log('Zoom', 'stopped');
    } else if (parts[0] === 'direct') {
      this.zoomPosition = Math.max(0, Math.min(1, this.getFloat(args)));
      this.log('Zoom', `position → ${this.zoomPosition.toFixed(3)}`);
    }
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
