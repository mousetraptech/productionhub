/**
 * DeviceDriver Interface
 *
 * All booth devices (audio console, lighting desk, cameras, streaming)
 * implement this interface. The ProductionHub routes OSC messages to
 * drivers by prefix and collects feedback from them.
 */

import { EventEmitter } from 'events';

/** OSC argument for feedback messages */
export interface OscArg {
  type: string;  // 'f', 'i', 's', etc.
  value: any;
}

/** Feedback event emitted by drivers */
export interface FeedbackEvent {
  address: string;  // OSC address relative to driver prefix, e.g. "/ch/1/mix/fader"
  args: OscArg[];
}

/** Fade request that drivers can ask the hub to execute */
export interface DriverFadeRequest {
  key: string;           // opaque key for the fade engine, e.g. "input/1/fader"
  startValue: number;    // fallback only — engine prefers tracked current value
  endValue: number;
  durationMs: number;
  easing: 'linear' | 'scurve' | 'easein' | 'easeout';
}

/**
 * Callback interface a driver uses to interact with the hub.
 * Passed to driver on construction so it can request fades and
 * report current values for fade tracking.
 */
export interface HubContext {
  /** Start a timed fade (hub owns the shared FadeEngine) */
  startFade(req: DriverFadeRequest): void;
  /** Cancel a fade by key */
  cancelFade(key: string, snapToTarget?: boolean): void;
  /** Cancel all fades */
  cancelAllFades(): void;
  /** Update the fade engine's tracked current value for a key */
  setCurrentValue(key: string, value: number): void;
  /** Get the fade engine's tracked current value for a key */
  getCurrentValue(key: string): number | undefined;
}

/**
 * Base interface for all device drivers.
 *
 * Drivers extend EventEmitter and emit:
 *   'feedback' (event: FeedbackEvent) — desk state change to relay to OSC clients
 *   'connected' — transport connected
 *   'disconnected' — transport disconnected
 *   'error' (err: Error) — non-fatal error
 */
export interface DeviceDriver extends EventEmitter {
  /** Human-readable name, e.g. "avantis", "chamsys", "obs" */
  readonly name: string;

  /** OSC prefix this driver handles, e.g. "/avantis" */
  readonly prefix: string;

  /** Open transport connections */
  connect(): void;

  /** Close transport connections */
  disconnect(): void;

  /** Whether the transport is currently connected */
  isConnected(): boolean;

  /**
   * Handle an incoming OSC message.
   * The address has already been stripped of the driver prefix.
   * e.g. if the full OSC address was "/avantis/ch/1/mix/fader",
   * this receives "/ch/1/mix/fader".
   */
  handleOSC(address: string, args: any[]): void;

  /**
   * Handle a fade tick from the hub's shared FadeEngine.
   * Called at ~50Hz during active fades with the interpolated value.
   * The key format is driver-specific (e.g. "input/1/fader").
   */
  handleFadeTick(key: string, value: number): void;

  /**
   * Handle unsolicited device feedback arriving on the hub's OSC port
   * without the driver prefix. For example, a ChamSys QuickQ sends
   * bare /pb/1, /master, etc. to port 9000 as feedback.
   *
   * The address is the raw OSC address (not prefix-stripped).
   * Returns true if the driver recognized and handled the address.
   * Optional — only needed for devices that send unprefixed feedback.
   */
  handleFeedback?(address: string, args: any[]): boolean;
}

/** Per-device configuration (type-specific fields are in the extras) */
export interface DeviceConfig {
  type: string;
  prefix: string;
  host: string;
  port: number;
  [key: string]: any;  // type-specific options
}
