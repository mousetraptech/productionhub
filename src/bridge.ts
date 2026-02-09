/**
 * OSC-to-MIDI Bridge
 *
 * Translates incoming OSC commands into Avantis MIDI messages
 * and sends them via TCP to the mixer.
 */

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
  NRPN_PARAM,
} from './midi-protocol';
import { MIDIStreamParser, MIDIEvent, MIDINRPNEvent, MIDINoteOnEvent } from './midi-parser';
import {
  AvantisOSCServer,
  OSCEvent,
  OSCFaderEvent,
  OSCMuteEvent,
  OSCPanEvent,
  OSCSceneEvent,
  OSCFadeEvent,
  OSCFadeStopEvent,
} from './osc-server';
import { FadeEngine, fadeKey } from './fade-engine';
import { Config } from './config';

export class AvantisBridge {
  private oscServer: AvantisOSCServer;
  private midiTransport: AvantisTCPTransport;
  private fadeEngine: FadeEngine;
  private midiParser: MIDIStreamParser;
  private config: Config;
  private baseMidiChannel: number;
  private feedbackEnabled: boolean;
  private echoSuppressionMs: number;

  // Echo suppression: tracks when we last sent a command per strip key.
  // When the desk echoes our command back, we ignore it within the window
  // to prevent OSC→MIDI→OSC feedback loops.
  private lastSentTimestamps: Map<string, number> = new Map();

  constructor(config: Config) {
    this.config = config;
    this.baseMidiChannel = (config.midi.baseChannel ?? 12) - 1; // convert 1-based to 0-based
    this.feedbackEnabled = config.feedback?.enabled ?? true;
    this.echoSuppressionMs = config.feedback?.echoSuppressionMs ?? 100;

    this.oscServer = new AvantisOSCServer({
      localAddress: config.osc.listenAddress,
      localPort: config.osc.listenPort,
      replyPort: config.osc.replyPort,
    });

    this.midiTransport = new AvantisTCPTransport(
      config.midi.host,
      config.midi.port,
    );

    this.fadeEngine = new FadeEngine();
    this.midiParser = new MIDIStreamParser();
  }

  start(): void {
    console.log('[Bridge] Starting Avantis OSC Bridge...');
    console.log(`[Bridge] OSC: ${this.config.osc.listenAddress}:${this.config.osc.listenPort}`);
    console.log(`[Bridge] MIDI TCP: ${this.config.midi.host}:${this.config.midi.port}`);
    console.log(`[Bridge] Base MIDI channel: ${this.baseMidiChannel + 1}`);

    this.oscServer.on('command', (event: OSCEvent) => {
      this.handleOSCEvent(event);
    });

    this.oscServer.on('error', (err: Error) => {
      console.error(`[Bridge] OSC error: ${err.message}`);
    });

    this.midiTransport.on('connected', () => {
      console.log('[Bridge] MIDI TCP connected to Avantis');
    });

    this.midiTransport.on('disconnected', () => {
      console.warn('[Bridge] MIDI TCP disconnected from Avantis');
    });

    this.midiTransport.on('data', (data: Buffer) => {
      this.midiParser.feed(data);
    });

    this.midiParser.on('midi', (event: MIDIEvent) => {
      this.handleMIDIFeedback(event);
    });

    // Fade engine: on each tick, send the interpolated value as a fader/pan MIDI message
    this.fadeEngine.on('value', (key: string, value: number) => {
      this.handleFadeValue(key, value);
    });

    this.fadeEngine.on('fadeComplete', (key: string) => {
      if (this.config.logging?.verbose) {
        console.log(`[Bridge] Fade complete: ${key}`);
      }
    });

    this.oscServer.start();
    this.midiTransport.connect();
    this.fadeEngine.start();
  }

  stop(): void {
    console.log('[Bridge] Stopping...');
    this.fadeEngine.stop();
    this.oscServer.stop();
    this.midiTransport.disconnect();
  }

  private handleOSCEvent(event: OSCEvent): void {
    switch (event.type) {
      case 'fader':
        this.handleFader(event);
        break;
      case 'mute':
        this.handleMute(event);
        break;
      case 'pan':
        this.handlePan(event);
        break;
      case 'scene':
        this.handleScene(event);
        break;
      case 'fade':
        this.handleFade(event);
        break;
      case 'fadeStop':
        this.handleFadeStop(event);
        break;
    }
  }

  /** Record that we just sent a command for this strip key (echo suppression) */
  private stampSent(key: string): void {
    this.lastSentTimestamps.set(key, Date.now());
  }

  /** Check whether feedback for this key should be suppressed (we sent recently) */
  private isSuppressed(key: string): boolean {
    const ts = this.lastSentTimestamps.get(key);
    if (ts === undefined) return false;
    return (Date.now() - ts) < this.echoSuppressionMs;
  }

  private handleFader(event: OSCFaderEvent): void {
    const key = fadeKey(event.strip.type, event.strip.number, 'fader');
    this.fadeEngine.setCurrentValue(key, event.value);
    this.stampSent(key);

    const { midiChannel, stripHex } = resolveStrip(event.strip, this.baseMidiChannel);
    const level = floatToMidi(event.value);
    const bytes = buildNRPNFader(midiChannel, stripHex, level);

    if (this.config.logging?.verbose) {
      console.log(
        `[Bridge] Fader ${event.strip.type}/${event.strip.number} = ${event.value.toFixed(3)} ` +
        `-> NRPN ch=${midiChannel} strip=0x${stripHex.toString(16)} lvl=${level}`
      );
    }

    this.midiTransport.send(bytes);
  }

  private handleMute(event: OSCMuteEvent): void {
    const key = fadeKey(event.strip.type, event.strip.number, 'mute');
    this.stampSent(key);

    const { midiChannel, stripHex } = resolveStrip(event.strip, this.baseMidiChannel);
    const bytes = buildMuteMessage(midiChannel, stripHex, event.value);

    if (this.config.logging?.verbose) {
      console.log(
        `[Bridge] Mute ${event.strip.type}/${event.strip.number} = ${event.value} ` +
        `-> Note On ch=${midiChannel} note=0x${stripHex.toString(16)} vel=${event.value ? 0x7f : 0x00}`
      );
    }

    this.midiTransport.send(bytes);
  }

  private handlePan(event: OSCPanEvent): void {
    const key = fadeKey(event.strip.type, event.strip.number, 'pan');
    this.fadeEngine.setCurrentValue(key, event.value);
    this.stampSent(key);

    // Pan uses the same NRPN structure but with parameter 0x18
    const { midiChannel, stripHex } = resolveStrip(event.strip, this.baseMidiChannel);
    const panValue = floatToMidi(event.value);
    const status = 0xb0 | (midiChannel & 0x0f);
    const bytes = [
      status, 99, stripHex & 0x7f,
      status, 98, 0x18,  // Pan parameter
      status, 6, panValue,
    ];

    if (this.config.logging?.verbose) {
      console.log(
        `[Bridge] Pan ${event.strip.type}/${event.strip.number} = ${event.value.toFixed(3)} ` +
        `-> NRPN ch=${midiChannel} strip=0x${stripHex.toString(16)} pan=${panValue}`
      );
    }

    this.midiTransport.send(bytes);
  }

  private handleScene(event: OSCSceneEvent): void {
    // Scene recall uses Program Change on the base MIDI channel
    const bytes = buildSceneRecall(this.baseMidiChannel, event.sceneNumber);

    if (this.config.logging?.verbose) {
      console.log(`[Bridge] Scene recall ${event.sceneNumber}`);
    }

    this.midiTransport.send(bytes);
  }

  private handleFade(event: OSCFadeEvent): void {
    const key = fadeKey(event.strip.type, event.strip.number, event.param);

    if (this.config.logging?.verbose) {
      const from = this.fadeEngine.getCurrentValue(key);
      console.log(
        `[Bridge] Fade ${key}: ${from?.toFixed(3) ?? '?'} -> ${event.targetValue.toFixed(3)} over ${event.durationSecs}s (${event.easing})`
      );
    }

    this.fadeEngine.startFade({
      key,
      startValue: 0, // fallback only — engine prefers its tracked current value
      endValue: event.targetValue,
      durationMs: event.durationSecs * 1000,
      easing: event.easing,
    });
  }

  private handleFadeStop(event: OSCFadeStopEvent): void {
    if (event.key) {
      this.fadeEngine.cancelFade(event.key, true);
      if (this.config.logging?.verbose) {
        console.log(`[Bridge] Fade stopped: ${event.key}`);
      }
    } else {
      this.fadeEngine.cancelAll();
      if (this.config.logging?.verbose) {
        console.log('[Bridge] All fades stopped');
      }
    }
  }

  /**
   * Called by the fade engine on each interpolation tick (~50Hz).
   * Routes the value to the correct MIDI sender based on the fade key.
   */
  private handleFadeValue(key: string, value: number): void {
    // key format: "stripType/number/param"
    const parts = key.split('/');
    if (parts.length !== 3) return;

    const [stripTypeStr, numStr, param] = parts;
    const stripType = stripTypeStr as StripType;
    const num = parseInt(numStr, 10);
    const strip = { type: stripType, number: num };

    if (param === 'fader') {
      this.handleFader({ type: 'fader', strip, value });
    } else if (param === 'pan') {
      this.handlePan({ type: 'pan', strip, value });
    }
  }

  /**
   * Handle parsed MIDI messages coming back from the Avantis.
   * Translates them to OSC and sends to all tracked clients.
   * Respects echo suppression and feedback config.
   */
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
        // Scene change feedback
        if (this.config.logging?.verbose) {
          console.log(`[Feedback] Scene changed to ${event.program}`);
        }
        this.oscServer.sendToClients('/scene/current', [
          { type: 'i', value: event.program },
        ]);
        break;
    }
  }

  private handleNRPNFeedback(event: MIDINRPNEvent): void {
    const strip = reverseResolveStrip(event.channel, event.paramMSB, this.baseMidiChannel);
    if (!strip) {
      if (this.config.logging?.verbose) {
        console.log(
          `[Feedback] Unknown NRPN: ch=${event.channel} MSB=0x${event.paramMSB.toString(16)} ` +
          `LSB=0x${event.paramLSB.toString(16)} val=${event.value}`
        );
      }
      return;
    }

    const prefix = stripToOSCPrefix(strip);
    const floatVal = midiToFloat(event.value);

    if (event.paramLSB === NRPN_PARAM.FADER_LEVEL) {
      const key = fadeKey(strip.type, strip.number, 'fader');

      // Always update tracked value so fades start from the right place
      this.fadeEngine.setCurrentValue(key, floatVal);

      // Suppress echo if we just sent this value
      if (this.isSuppressed(key)) return;

      this.oscServer.sendToClients(`${prefix}/mix/fader`, [
        { type: 'f', value: floatVal },
      ]);

      if (this.config.logging?.verbose) {
        console.log(`[Feedback] ${prefix}/mix/fader = ${floatVal.toFixed(3)}`);
      }
    } else if (event.paramLSB === NRPN_PARAM.PAN) {
      const key = fadeKey(strip.type, strip.number, 'pan');
      this.fadeEngine.setCurrentValue(key, floatVal);

      if (this.isSuppressed(key)) return;

      this.oscServer.sendToClients(`${prefix}/mix/pan`, [
        { type: 'f', value: floatVal },
      ]);

      if (this.config.logging?.verbose) {
        console.log(`[Feedback] ${prefix}/mix/pan = ${floatVal.toFixed(3)}`);
      }
    }
  }

  private handleMuteFeedback(event: MIDINoteOnEvent): void {
    const strip = reverseResolveStrip(event.channel, event.note, this.baseMidiChannel);
    if (!strip) {
      if (this.config.logging?.verbose) {
        console.log(`[Feedback] Unknown mute: ch=${event.channel} note=${event.note} vel=${event.velocity}`);
      }
      return;
    }

    const key = fadeKey(strip.type, strip.number, 'mute');
    if (this.isSuppressed(key)) return;

    const prefix = stripToOSCPrefix(strip);
    const muted = event.velocity >= 0x40 ? 1 : 0;

    this.oscServer.sendToClients(`${prefix}/mix/mute`, [
      { type: 'i', value: muted },
    ]);

    if (this.config.logging?.verbose) {
      console.log(`[Feedback] ${prefix}/mix/mute = ${muted}`);
    }
  }
}
