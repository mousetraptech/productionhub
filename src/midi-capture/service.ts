/**
 * MIDI Capture Service
 *
 * Flight recorder for all MIDI events received from the Avantis.
 * Writes every parsed MIDI event to MongoDB, tagged with show_id when active.
 * Runs always — not gated by show context.
 */

import { randomUUID } from 'crypto';
import { MongoClient, Collection, Db } from 'mongodb';
import { MIDIStreamParser } from '../midi-parser';
import { MIDIEvent, MIDINRPNEvent, MIDINoteOnEvent, MIDIProgramChangeEvent } from '../midi-parser';
import { reverseResolveStrip, midiToFloat, NRPN_PARAM } from '../midi-protocol';
import { ShowContextService } from '../show-context';
import { MIDIEventDocument } from './types';
import { getLogger } from '../logger';

const log = getLogger('MIDICapture');

export interface MIDICaptureConfig {
  mongoUrl: string;
  dbName?: string;
}

export class MIDICaptureService {
  private client: MongoClient;
  private db: Db | null = null;
  private collection: Collection<MIDIEventDocument> | null = null;
  private dbName: string;
  private parser: MIDIStreamParser;
  private showContext: ShowContextService | null;
  private baseMidiChannel: number;
  private listener: ((event: MIDIEvent) => void) | null = null;

  constructor(
    config: MIDICaptureConfig,
    parser: MIDIStreamParser,
    showContext: ShowContextService | null,
    baseMidiChannel = 0,
  ) {
    this.client = new MongoClient(config.mongoUrl);
    this.dbName = config.dbName ?? 'productionhub';
    this.parser = parser;
    this.showContext = showContext;
    this.baseMidiChannel = baseMidiChannel;
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.db = this.client.db(this.dbName);
    this.collection = this.db.collection<MIDIEventDocument>('midi_events');

    // Create indexes
    await this.collection.createIndex({ show_id: 1 }, { sparse: true });
    await this.collection.createIndex({ timestamp: -1 });
    await this.collection.createIndex({ show_id: 1, timestamp: -1 });

    log.info('MIDI capture service connected');
  }

  async disconnect(): Promise<void> {
    this.stop();
    await this.client.close();
    this.db = null;
    this.collection = null;
  }

  /** Attach listener to MIDIStreamParser */
  start(): void {
    if (this.listener) return; // already started

    this.listener = (event: MIDIEvent) => {
      this.captureEvent(event);
    };
    this.parser.on('midi', this.listener);

    log.info('MIDI capture started');
  }

  /** Detach listener */
  stop(): void {
    if (this.listener) {
      this.parser.removeListener('midi', this.listener);
      this.listener = null;
    }
  }

  /** Process and write a MIDI event — fire and forget, never throws */
  private captureEvent(event: MIDIEvent): void {
    const doc = this.buildDocument(event);

    // Get show_id async, then write
    const showIdPromise = this.showContext
      ? this.showContext.getCurrentShowId()
      : Promise.resolve(null);

    showIdPromise
      .then(showId => {
        doc.show_id = showId;
        return this.collection?.insertOne(doc);
      })
      .catch(err => {
        log.warn({ err: err.message }, 'MIDI capture write failed');
      });
  }

  /** Build a document from a parsed MIDI event */
  private buildDocument(event: MIDIEvent): MIDIEventDocument {
    const base: Omit<MIDIEventDocument, 'type' | 'strip' | 'param' | 'value' | 'raw'> = {
      event_id: randomUUID(),
      show_id: null, // filled async
      timestamp: new Date().toISOString(),
      source: 'avantis',
    };

    switch (event.type) {
      case 'nrpn':
        return { ...base, ...this.buildNRPN(event) };
      case 'noteon':
        return { ...base, ...this.buildNoteOn(event) };
      case 'pc':
        return { ...base, ...this.buildPC(event) };
    }
  }

  private buildNRPN(event: MIDINRPNEvent): Pick<MIDIEventDocument, 'type' | 'strip' | 'param' | 'value' | 'raw'> {
    const strip = reverseResolveStrip(event.channel, event.paramMSB, this.baseMidiChannel);

    let param: MIDIEventDocument['param'] = 'unknown';
    let value = event.value;

    if (event.paramLSB === NRPN_PARAM.FADER_LEVEL) {
      param = 'fader';
      value = midiToFloat(event.value);
    } else if (event.paramLSB === NRPN_PARAM.PAN) {
      param = 'pan';
      value = midiToFloat(event.value);
    }

    // If strip couldn't be resolved, mark param as unknown
    if (!strip) {
      param = 'unknown';
    }

    return {
      type: 'nrpn',
      strip: strip ? { type: strip.type, number: strip.number } : null,
      param,
      value,
      raw: {
        channel: event.channel,
        paramMSB: event.paramMSB,
        paramLSB: event.paramLSB,
        value: event.value,
      },
    };
  }

  private buildNoteOn(event: MIDINoteOnEvent): Pick<MIDIEventDocument, 'type' | 'strip' | 'param' | 'value' | 'raw'> {
    return {
      type: 'noteon',
      strip: null, // Note On mute — strip resolution from note number is complex, skip for now
      param: 'mute',
      value: event.velocity >= 0x40 ? 1 : 0,
      raw: {
        channel: event.channel,
        note: event.note,
        velocity: event.velocity,
      },
    };
  }

  private buildPC(event: MIDIProgramChangeEvent): Pick<MIDIEventDocument, 'type' | 'strip' | 'param' | 'value' | 'raw'> {
    return {
      type: 'pc',
      strip: null,
      param: 'scene',
      value: event.program,
      raw: {
        channel: event.channel,
        program: event.program,
      },
    };
  }
}
