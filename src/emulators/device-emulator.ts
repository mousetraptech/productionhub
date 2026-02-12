/**
 * DeviceEmulator — Abstract base class for virtual device emulators
 *
 * Implements the DeviceDriver interface so the hub sees no difference
 * between a real driver and an emulator. Provides shared infrastructure:
 *   - Immediate connect/disconnect (no real transport)
 *   - Command log ring buffer with timestamps
 *   - Console logging in [Emulator:{name}] format
 *   - Feedback emission convenience method
 */

import { EventEmitter } from 'events';
import { DeviceDriver, DeviceConfig, HubContext, FeedbackEvent, OscArg } from '../drivers/device-driver';

export interface EmulatorLogEntry {
  timestamp: number;
  action: string;
  details: string;
}

export abstract class DeviceEmulator extends EventEmitter implements DeviceDriver {
  abstract readonly name: string;
  abstract readonly prefix: string;

  protected _connected = false;
  protected verbose: boolean;
  protected hubContext: HubContext;
  private _log: EmulatorLogEntry[] = [];
  private readonly maxLogSize = 200;

  constructor(config: DeviceConfig, hubContext: HubContext, verbose: boolean) {
    super();
    this.hubContext = hubContext;
    this.verbose = verbose;
  }

  connect(): void {
    this._connected = true;
    this.log('Connect', 'Emulator connected (virtual)');
    this.emit('connected');
  }

  disconnect(): void {
    this._connected = false;
    this.log('Disconnect', 'Emulator disconnected');
    this.emit('disconnected');
  }

  isConnected(): boolean {
    return this._connected;
  }

  abstract handleOSC(address: string, args: any[]): void;

  handleFadeTick(key: string, value: number): void {
    this.onFadeTick(key, value);
  }

  /** Override in subclasses that use fades (e.g. Avantis) */
  protected onFadeTick(key: string, value: number): void {
    this.log('FadeTick', `${key} = ${value.toFixed(3)}`);
  }

  /** Append to ring buffer and console log */
  protected log(action: string, details: string): void {
    const entry: EmulatorLogEntry = {
      timestamp: Date.now(),
      action,
      details,
    };

    this._log.push(entry);
    if (this._log.length > this.maxLogSize) {
      this._log.shift();
    }

    if (this.verbose) {
      console.log(`[Emulator:${this.name}] ${action}: ${details}`);
    }
  }

  /** Get all log entries */
  getLog(): EmulatorLogEntry[] {
    return [...this._log];
  }

  /** Get device-specific state snapshot */
  abstract getState(): Record<string, any>;

  /** Emit a feedback event for the hub to relay to OSC clients */
  protected emitFeedback(address: string, args: OscArg[]): void {
    const event: FeedbackEvent = { address, args };
    this.emit('feedback', event);
  }
}
