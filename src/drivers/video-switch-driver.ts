/**
 * Video Switch Device Driver
 *
 * Models an IR-controlled HDMI switch with N inputs and 1 output.
 * Delegates physical control to the Broadlink driver via OSC routing.
 * Tracks selected input state locally and persists to MongoDB (ui_state).
 *
 * OSC addresses (prefix stripped):
 *   /input/{n}              Select input N
 *   /status                 Emit current input as feedback
 *
 * Config maps input numbers to Broadlink IR command names:
 *   inputs:
 *     1: { label: "Guest Laptop", ir: "hdmi_1" }
 *     3: { label: "Wireless HDMI", ir: "hdmi_3" }
 */

import { EventEmitter } from 'events';
import { MongoClient, Collection } from 'mongodb';
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
  /** MongoDB connection URL (injected by index.ts) */
  mongoUrl?: string;
  /** MongoDB database name */
  mongoDbName?: string;
}

interface UiStateDoc {
  key: string;
  value: string | null;
}

export class VideoSwitchDriver extends EventEmitter implements DeviceDriver {
  readonly name: string;
  readonly prefix: string;

  private inputs: Map<number, VideoSwitchInput>;
  private irPrefix: string;
  private routeOSC: ((address: string, args: any[]) => void) | null = null;
  private currentInput: number = 0;
  private connected: boolean = false;
  private mongoUrl: string | null;
  private mongoDbName: string;
  private uiState: Collection<UiStateDoc> | null = null;
  private mongoClient: MongoClient | null = null;

  constructor(config: VideoSwitchConfig, _hubContext: HubContext, _verbose = false) {
    super();
    this.name = config.name ?? 'video-switch';
    this.prefix = config.prefix;
    this.irPrefix = config.irPrefix;
    this.mongoUrl = config.mongoUrl ?? null;
    this.mongoDbName = config.mongoDbName ?? 'productionhub';
    this.inputs = new Map();
    for (const [key, val] of Object.entries(config.inputs ?? {})) {
      this.inputs.set(parseInt(key, 10), val);
    }
  }

  /** Set the OSC router so we can send commands to the Broadlink driver */
  setRouter(routeOSC: (address: string, args: any[]) => void): void {
    this.routeOSC = routeOSC;
  }

  async connect(): Promise<void> {
    // Connect to MongoDB and restore last state
    if (this.mongoUrl) {
      try {
        this.mongoClient = new MongoClient(this.mongoUrl);
        await this.mongoClient.connect();
        this.uiState = this.mongoClient.db(this.mongoDbName).collection<UiStateDoc>('ui_state');
        await this.uiState.createIndex({ key: 1 }, { unique: true });

        // Restore persisted input
        const doc = await this.uiState.findOne({ key: 'videoInput' });
        if (doc?.value) {
          // Find input number by label match
          for (const [n, input] of this.inputs) {
            if (input.label.toLowerCase().replace(/\s+/g, '_') === doc.value || String(n) === doc.value) {
              this.currentInput = n;
              log.info({ input: n, label: input.label }, 'Restored video input from DB');
              break;
            }
          }
        }
      } catch (err: any) {
        log.warn({ err: err.message }, 'MongoDB unavailable — video switch state will not persist');
        this.uiState = null;
      }
    }

    this.connected = true;
    this.emit('connected');
    log.info({ inputs: this.inputs.size }, 'Video switch ready');

    // Emit initial state so dashboard picks it up
    if (this.currentInput > 0) {
      this.emitState();
    }
  }

  disconnect(): void {
    this.connected = false;
    if (this.mongoClient) {
      this.mongoClient.close().catch(() => {});
      this.mongoClient = null;
      this.uiState = null;
    }
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

  private async selectInput(n: number): Promise<void> {
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

    // Persist to MongoDB
    if (this.uiState) {
      const stateValue = String(n);
      this.uiState.updateOne(
        { key: 'videoInput' },
        { $set: { key: 'videoInput', value: stateValue } },
        { upsert: true },
      ).catch(err => log.warn({ err: err.message }, 'Failed to persist video input state'));
    }

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
