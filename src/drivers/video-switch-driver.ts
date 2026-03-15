/**
 * Video Switch Device Driver
 *
 * Models an IR-controlled HDMI switch with N inputs and 1 output.
 * Delegates physical control to the Broadlink driver via OSC routing.
 * Tracks selected input state locally (no feedback from the switch).
 *
 * OSC addresses (prefix stripped):
 *   /input/{n}              Select input N
 *   /status                 Emit current input as feedback
 *
 * Config maps input numbers to Broadlink IR command names:
 *   inputs:
 *     1: { label: "Mac Mini", ir: "hdmi_sw_1" }
 *     2: { label: "Apple TV", ir: "hdmi_sw_2" }
 */

import { EventEmitter } from 'events';
import { DeviceDriver, DeviceConfig, HubContext, FeedbackEvent, OscArg } from './device-driver';
import { getLogger } from '../logger';

const log = getLogger('VideoSwitch');

export interface VideoSwitchInput {
  label: string;
  /** IR command name in the Broadlink driver */
  ir: string;
}

export interface VideoSwitchConfig extends DeviceConfig {
  type: 'video-switch';
  /** Broadlink driver prefix (e.g. "/ir") for routing IR commands */
  irPrefix: string;
  inputs: Record<string, VideoSwitchInput>;
}

export class VideoSwitchDriver extends EventEmitter implements DeviceDriver {
  readonly name: string;
  readonly prefix: string;

  private inputs: Map<number, VideoSwitchInput>;
  private irPrefix: string;
  private routeOSC: ((address: string, args: any[]) => void) | null = null;
  private currentInput: number = 0;
  private connected: boolean = false;

  constructor(config: VideoSwitchConfig, _hubContext: HubContext, _verbose = false) {
    super();
    this.name = config.name ?? 'video-switch';
    this.prefix = config.prefix;
    this.irPrefix = config.irPrefix;
    this.inputs = new Map();
    for (const [key, val] of Object.entries(config.inputs ?? {})) {
      this.inputs.set(parseInt(key, 10), val);
    }
  }

  /** Set the OSC router so we can send commands to the Broadlink driver */
  setRouter(routeOSC: (address: string, args: any[]) => void): void {
    this.routeOSC = routeOSC;
  }

  connect(): void {
    this.connected = true;
    this.emit('connected');
    log.info({ inputs: this.inputs.size }, 'Video switch ready');
  }

  disconnect(): void {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  handleOSC(address: string, _args: any[]): void {
    const addr = address.toLowerCase();

    // /input/{n} — select input
    const inputMatch = addr.match(/^\/input\/(\d+)$/);
    if (inputMatch) {
      const n = parseInt(inputMatch[1], 10);
      this.selectInput(n);
      return;
    }

    // /status — emit current state
    if (addr === '/status') {
      this.emitState();
      return;
    }

    log.warn({ address }, 'Unknown address');
  }

  handleFadeTick(_key: string, _value: number): void {
    // No-op
  }

  private selectInput(n: number): void {
    const input = this.inputs.get(n);
    if (!input) {
      log.warn({ input: n, available: Array.from(this.inputs.keys()) }, 'Invalid input');
      this.emitFeedback('/error', [{ type: 's', value: `Invalid input: ${n}` }]);
      return;
    }

    // Send IR command via Broadlink
    if (this.routeOSC) {
      this.routeOSC(`${this.irPrefix}/send/${input.ir}`, []);
    } else {
      log.warn('No OSC router — cannot send IR command');
      return;
    }

    this.currentInput = n;
    log.info({ input: n, label: input.label }, 'Input selected');
    this.emitState();
  }

  private emitState(): void {
    const input = this.inputs.get(this.currentInput);
    this.emitFeedback('/input', [
      { type: 'i', value: this.currentInput },
      { type: 's', value: input?.label ?? 'unknown' },
    ]);
  }

  /** Get state for dashboard/brain */
  getState(): { currentInput: number; label: string; inputs: Record<number, string> } {
    const input = this.inputs.get(this.currentInput);
    const inputLabels: Record<number, string> = {};
    for (const [n, v] of this.inputs) {
      inputLabels[n] = v.label;
    }
    return {
      currentInput: this.currentInput,
      label: input?.label ?? 'none',
      inputs: inputLabels,
    };
  }

  private emitFeedback(address: string, args: OscArg[]): void {
    const event: FeedbackEvent = { address, args };
    this.emit('feedback', event);
  }
}
