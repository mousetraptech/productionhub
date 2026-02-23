/**
 * Avantis Device Driver
 *
 * Wraps the Allen & Heath Avantis MIDI TCP protocol as a DeviceDriver.
 * Extracted from bridge.ts — all Avantis-specific MIDI logic lives here.
 *
 * Uses:
 *   - midi-protocol.ts for MIDI message building and strip resolution
 *   - midi-parser.ts for parsing incoming MIDI from the desk
 *   - HubContext for shared fade engine integration
 */

import { EventEmitter } from 'events';
import {
  DeviceDriver,
  DeviceConfig,
  HubContext,
  FeedbackEvent,
  OscArg,
} from './device-driver';
import { getFloat, getInt, getString, getBool } from './osc-args';
import { ReconnectQueue } from './reconnect-queue';
import {
  AvantisTCPTransport,
  resolveStrip,
  reverseResolveStrip,
  stripToOSCPrefix,
  buildNRPNFader,
  buildMuteMessage,
  buildSceneRecall,
  floatToMidi,
  midiToFloat,
  StripType,
  StripAddress,
  NRPN_PARAM,
} from '../midi-protocol';
import { MIDIStreamParser, MIDIEvent, MIDINRPNEvent, MIDINoteOnEvent } from '../midi-parser';
import { EasingType } from '../fade-engine';

export interface AvantisConfig extends DeviceConfig {
  type: 'avantis';
  midiBaseChannel?: number;    // 1-indexed, default 1
  feedback?: {
    enabled?: boolean;         // default true
    echoSuppressionMs?: number; // default 100
  };
}

export class AvantisDriver extends EventEmitter implements DeviceDriver {
  readonly name: string;
  readonly prefix: string;

  private transport: AvantisTCPTransport;
  private midiParser: MIDIStreamParser;
  private hubContext: HubContext;
  private baseMidiChannel: number; // 0-indexed
  private feedbackEnabled: boolean;
  private echoSuppressionMs: number;
  private verbose: boolean;

  // Echo suppression: tracks when we last sent a command per strip key
  private lastSentTimestamps: Map<string, number> = new Map();

  // Dedup: track last MIDI value sent per key to avoid redundant sends during fades
  private lastMidiValues: Map<string, number> = new Map();

  // Queue for messages sent while disconnected
  private reconnectQueue = new ReconnectQueue<{ address: string; args: any[] }>(64);

  // Strip state for dashboard UI
  private strips: Map<string, { fader: number; mute: boolean; pan: number }> = new Map();
  private currentScene: number = 0;

  constructor(config: AvantisConfig, hubContext: HubContext, verbose = false) {
    super();
    this.name = 'avantis';
    this.prefix = config.prefix;
    this.hubContext = hubContext;
    this.verbose = verbose;

    this.baseMidiChannel = ((config.midiBaseChannel ?? 1) - 1); // 1-indexed to 0-indexed
    this.feedbackEnabled = config.feedback?.enabled ?? true;
    this.echoSuppressionMs = config.feedback?.echoSuppressionMs ?? 100;

    this.transport = new AvantisTCPTransport(config.host, config.port);
    this.midiParser = new MIDIStreamParser();

    // Wire transport events
    this.transport.on('connected', () => {
      this.emit('connected');
      this.flushQueue();
    });
    this.transport.on('disconnected', () => this.emit('disconnected'));
    this.transport.on('error', (err: Error) => this.emit('error', err));

    // Wire MIDI data -> parser -> feedback handler
    this.transport.on('data', (data: Buffer) => {
      this.midiParser.feed(data);
    });

    this.midiParser.on('midi', (event: MIDIEvent) => {
      this.handleMIDIFeedback(event);
    });
  }

  connect(): void {
    if (this.verbose) {
      console.log(`[Avantis] Connecting to ${this.transport['host']}:${this.transport['port']}`);
    }
    this.transport.connect();
  }

  disconnect(): void {
    this.transport.disconnect();
  }

  isConnected(): boolean {
    return this.transport.isConnected();
  }

  /**
   * Replay queued messages after reconnection.
   */
  private flushQueue(): void {
    const queued = this.reconnectQueue.flush();
    if (queued.length === 0) return;
    console.log(`[Avantis] Replaying ${queued.length} queued message(s)`);
    for (const msg of queued) {
      this.handleOSC(msg.address, msg.args);
    }
  }

  /**
   * Handle an incoming OSC message (prefix already stripped by hub).
   * Parses Avantis-style addresses: /ch/{n}/mix/fader, /scene/recall, etc.
   */
  handleOSC(address: string, args: any[]): void {
    // Queue messages if not connected
    if (!this.isConnected()) {
      this.reconnectQueue.push({ address, args });
      if (this.verbose) {
        console.warn(`[Avantis] Not connected, queued message (${this.reconnectQueue.size} in queue)`);
      }
      return;
    }

    const addr = address.toLowerCase().replace(/\/$/, '');
    const parts = addr.split('/').filter(Boolean);

    if (parts.length === 0) return;

    // Dispatch by strip type
    switch (parts[0]) {
      case 'ch':
        if (parts.length >= 2) {
          const n = parseInt(parts[1], 10);
          if (!isNaN(n)) this.handleStripCommand(StripType.Input, n, parts.slice(2), args);
        }
        break;
      case 'mix':
        if (parts.length >= 2) {
          const n = parseInt(parts[1], 10);
          if (!isNaN(n)) this.handleStripCommand(StripType.Mix, n, parts.slice(2), args);
        }
        break;
      case 'fxsend':
        if (parts.length >= 2) {
          const n = parseInt(parts[1], 10);
          if (!isNaN(n)) this.handleStripCommand(StripType.FXSend, n, parts.slice(2), args);
        }
        break;
      case 'fxrtn':
        if (parts.length >= 2) {
          const n = parseInt(parts[1], 10);
          if (!isNaN(n)) this.handleStripCommand(StripType.FXReturn, n, parts.slice(2), args);
        }
        break;
      case 'dca':
        if (parts.length >= 2) {
          const n = parseInt(parts[1], 10);
          if (!isNaN(n)) {
            const subParts = parts.slice(2);
            // /dca/{n}/fader or /dca/{n}/mute (short form)
            if (subParts.length === 1 && subParts[0] === 'fader') {
              this.handleFader({ type: StripType.DCA, number: n }, getFloat(args));
              return;
            }
            if (subParts.length === 1 && subParts[0] === 'mute') {
              this.handleMute({ type: StripType.DCA, number: n }, getBool(args));
              return;
            }
            this.handleStripCommand(StripType.DCA, n, subParts, args);
          }
        }
        break;
      case 'grp':
        if (parts.length >= 2) {
          const n = parseInt(parts[1], 10);
          if (!isNaN(n)) this.handleStripCommand(StripType.Group, n, parts.slice(2), args);
        }
        break;
      case 'mtx':
        if (parts.length >= 2) {
          const n = parseInt(parts[1], 10);
          if (!isNaN(n)) this.handleStripCommand(StripType.Matrix, n, parts.slice(2), args);
        }
        break;
      case 'main':
        this.handleStripCommand(StripType.Main, 1, parts.slice(1), args);
        break;
      case 'scene':
        if (parts[1] === 'recall') {
          this.handleScene(getInt(args));
        }
        break;
      case 'fade':
        if (parts[1] === 'stop') {
          // Per-driver fade stop (hub handles global /fade/stop)
          if (args.length > 0) {
            const key = `${this.name}:${getString(args)}`;
            this.hubContext.cancelFade(key, true);
          }
        }
        break;
      default:
        if (this.verbose) {
          console.warn(`[Avantis] Unrecognized OSC: ${address}`);
        }
    }
  }

  /**
   * Handle a fade tick from the shared FadeEngine.
   * Key format: "stripType/number/param" (driver prefix already stripped)
   *
   * Deduplicates: only sends MIDI when the quantized value actually changes.
   * At 100Hz tick rate, many ticks produce the same 7-bit MIDI value (0-127).
   * Skipping duplicates reduces TCP traffic and prevents the desk from
   * processing redundant identical messages.
   */
  handleFadeTick(key: string, value: number): void {
    const parts = key.split('/');
    if (parts.length !== 3) return;

    const [stripTypeStr, numStr, param] = parts;

    if (param === 'fader' || param === 'pan') {
      // Dedup: skip if the quantized MIDI value hasn't changed
      const midiValue = floatToMidi(value);
      const lastMidi = this.lastMidiValues.get(key);
      if (lastMidi === midiValue) return;
      this.lastMidiValues.set(key, midiValue);
    }

    const strip: StripAddress = { type: stripTypeStr as StripType, number: parseInt(numStr, 10) };

    if (param === 'fader') {
      this.handleFader(strip, value);
    } else if (param === 'pan') {
      this.handlePan(strip, value);
    }
  }

  // --- Strip command dispatch ---

  private handleStripCommand(stripType: StripType, num: number, subParts: string[], args: any[]): void {
    const paramPath = subParts.join('/');

    switch (paramPath) {
      case 'mix/fader':
      case 'fader':
        this.handleFader({ type: stripType, number: num }, getFloat(args));
        break;
      case 'mix/mute':
      case 'mute':
        this.handleMute({ type: stripType, number: num }, getBool(args));
        break;
      case 'mix/pan':
      case 'pan':
        this.handlePan({ type: stripType, number: num }, getFloat(args));
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

  // --- MIDI senders ---

  private handleFader(strip: StripAddress, value: number): void {
    const key = `${strip.type}/${strip.number}/fader`;
    this.hubContext.setCurrentValue(`${this.name}:${key}`, value);
    this.stampSent(key);

    const { midiChannel, stripHex } = resolveStrip(strip, this.baseMidiChannel);
    const level = floatToMidi(value);

    // Update dedup cache so fade ticks after a direct set stay in sync
    this.lastMidiValues.set(key, level);

    const bytes = buildNRPNFader(midiChannel, stripHex, level);

    if (this.verbose) {
      console.log(
        `[Avantis] Fader ${strip.type}/${strip.number} = ${value.toFixed(3)} ` +
        `-> NRPN ch=${midiChannel} strip=0x${stripHex.toString(16)} lvl=${level} ` +
        `bytes=[${bytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}]`
      );
    }

    this.transport.send(bytes);
  }

  private handleMute(strip: StripAddress, value: boolean): void {
    const key = `${strip.type}/${strip.number}/mute`;
    this.stampSent(key);

    const { midiChannel, stripHex } = resolveStrip(strip, this.baseMidiChannel);
    const bytes = buildMuteMessage(midiChannel, stripHex, value);

    if (this.verbose) {
      console.log(
        `[Avantis] Mute ${strip.type}/${strip.number} = ${value} ` +
        `-> Note On ch=${midiChannel} note=0x${stripHex.toString(16)} vel=${value ? 0x7f : 0x3f} ` +
        `bytes=[${bytes.map(b => b.toString(16).padStart(2, '0')).join(' ')}]`
      );
    }

    this.transport.send(bytes);

    // Optimistically update strip state and broadcast so UI reflects immediately
    this.getStrip(`${strip.type}/${strip.number}`).mute = value;
    const prefix = stripToOSCPrefix(strip);
    this.emitFeedback(`${prefix}/mix/mute`, [{ type: 'i', value: value ? 1 : 0 }]);
  }

  private handlePan(strip: StripAddress, value: number): void {
    const key = `${strip.type}/${strip.number}/pan`;
    this.hubContext.setCurrentValue(`${this.name}:${key}`, value);
    this.stampSent(key);

    const { midiChannel, stripHex } = resolveStrip(strip, this.baseMidiChannel);
    const panValue = floatToMidi(value);

    // Update dedup cache so fade ticks after a direct set stay in sync
    this.lastMidiValues.set(key, panValue);
    const status = 0xb0 | (midiChannel & 0x0f);
    const bytes = [
      status, 99, stripHex & 0x7f,
      status, 98, 0x18,  // Pan parameter
      status, 6, panValue,
    ];

    if (this.verbose) {
      console.log(
        `[Avantis] Pan ${strip.type}/${strip.number} = ${value.toFixed(3)} ` +
        `-> NRPN ch=${midiChannel} strip=0x${stripHex.toString(16)} pan=${panValue}`
      );
    }

    this.transport.send(bytes);
  }

  private handleScene(sceneNumber: number): void {
    this.currentScene = sceneNumber;
    const bytes = buildSceneRecall(this.baseMidiChannel, sceneNumber);
    if (this.verbose) {
      console.log(`[Avantis] Scene recall ${sceneNumber}`);
    }
    this.transport.send(bytes);
  }

  private handleFadeRequest(stripType: StripType, num: number, param: 'fader' | 'pan', args: any[]): void {
    if (args.length < 2) {
      console.warn(`[Avantis] Fade requires at least 2 args (target, duration), got ${args.length}`);
      return;
    }

    const targetValue = getFloat(args);
    const durationSecs = getFloat(args, 1);
    const easingStr = args.length >= 3 ? getString(args, 2) : 'scurve';
    const easing = (['linear', 'scurve', 'easein', 'easeout'].includes(easingStr)
      ? easingStr
      : 'scurve') as EasingType;

    const localKey = `${stripType}/${num}/${param}`;
    const fadeKey = `${this.name}:${localKey}`;

    if (this.verbose) {
      const from = this.hubContext.getCurrentValue(fadeKey);
      console.log(
        `[Avantis] Fade ${localKey}: ${from?.toFixed(3) ?? '?'} -> ${targetValue.toFixed(3)} over ${durationSecs}s (${easing})`
      );
    }

    this.hubContext.startFade({
      key: fadeKey,
      startValue: 0, // fallback — engine prefers tracked current value
      endValue: targetValue,
      durationMs: durationSecs * 1000,
      easing,
    });
  }

  // --- Echo suppression ---

  private stampSent(key: string): void {
    this.lastSentTimestamps.set(key, Date.now());
  }

  private isSuppressed(key: string): boolean {
    const ts = this.lastSentTimestamps.get(key);
    if (ts === undefined) return false;
    return (Date.now() - ts) < this.echoSuppressionMs;
  }

  // --- MIDI feedback (desk → OSC clients via hub) ---

  private handleMIDIFeedback(event: MIDIEvent): void {
    if (!this.feedbackEnabled) return;

    switch (event.type) {
      case 'nrpn':
        this.handleNRPNFeedback(event);
        break;
      case 'noteon':
        this.handleMuteFeedback(event);
        break;
      case 'pc':
        if (this.verbose) {
          console.log(`[Avantis] Feedback: Scene changed to ${event.program}`);
        }
        this.emitFeedback('/scene/current', [{ type: 'i', value: event.program }]);
        break;
    }
  }

  private getStrip(key: string): { fader: number; mute: boolean; pan: number } {
    let s = this.strips.get(key);
    if (!s) {
      s = { fader: 0, mute: false, pan: 0.5 };
      this.strips.set(key, s);
    }
    return s;
  }

  getState(): Record<string, any> {
    const strips: Record<string, { fader: number; mute: boolean; pan: number }> = {};
    for (const [key, val] of this.strips) {
      strips[key] = { ...val };
    }
    return { currentScene: this.currentScene, strips };
  }

  private handleNRPNFeedback(event: MIDINRPNEvent): void {
    const strip = reverseResolveStrip(event.channel, event.paramMSB, this.baseMidiChannel);
    if (!strip) {
      if (this.verbose) {
        console.log(
          `[Avantis] Feedback: Unknown NRPN ch=${event.channel} MSB=0x${event.paramMSB.toString(16)} ` +
          `LSB=0x${event.paramLSB.toString(16)} val=${event.value}`
        );
      }
      return;
    }

    const prefix = stripToOSCPrefix(strip);
    const floatVal = midiToFloat(event.value);

    if (event.paramLSB === NRPN_PARAM.FADER_LEVEL) {
      const key = `${strip.type}/${strip.number}/fader`;
      const fadeKey = `${this.name}:${key}`;

      // Always update tracked value so fades start from the right place
      this.hubContext.setCurrentValue(fadeKey, floatVal);
      this.getStrip(`${strip.type}/${strip.number}`).fader = floatVal;

      if (this.isSuppressed(key)) return;

      this.emitFeedback(`${prefix}/mix/fader`, [{ type: 'f', value: floatVal }]);
      if (this.verbose) {
        console.log(`[Avantis] Feedback: ${prefix}/mix/fader = ${floatVal.toFixed(3)}`);
      }
    } else if (event.paramLSB === NRPN_PARAM.PAN) {
      const key = `${strip.type}/${strip.number}/pan`;
      const fadeKey = `${this.name}:${key}`;
      this.hubContext.setCurrentValue(fadeKey, floatVal);
      this.getStrip(`${strip.type}/${strip.number}`).pan = floatVal;

      if (this.isSuppressed(key)) return;

      this.emitFeedback(`${prefix}/mix/pan`, [{ type: 'f', value: floatVal }]);
      if (this.verbose) {
        console.log(`[Avantis] Feedback: ${prefix}/mix/pan = ${floatVal.toFixed(3)}`);
      }
    }
  }

  private handleMuteFeedback(event: MIDINoteOnEvent): void {
    const strip = reverseResolveStrip(event.channel, event.note, this.baseMidiChannel);
    if (!strip) {
      if (this.verbose) {
        console.log(`[Avantis] Feedback: Unknown mute ch=${event.channel} note=${event.note} vel=${event.velocity}`);
      }
      return;
    }

    const key = `${strip.type}/${strip.number}/mute`;
    this.getStrip(`${strip.type}/${strip.number}`).mute = event.velocity >= 0x40;
    if (this.isSuppressed(key)) return;

    const prefix = stripToOSCPrefix(strip);
    const muted = event.velocity >= 0x40 ? 1 : 0;

    this.emitFeedback(`${prefix}/mix/mute`, [{ type: 'i', value: muted }]);
    if (this.verbose) {
      console.log(`[Avantis] Feedback: ${prefix}/mix/mute = ${muted}`);
    }
  }

  /** Emit a feedback event for the hub to relay to OSC clients */
  private emitFeedback(address: string, args: OscArg[]): void {
    const event: FeedbackEvent = { address, args };
    this.emit('feedback', event);
  }

}
