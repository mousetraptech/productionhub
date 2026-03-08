import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { EventEmitter } from 'events';
import { MIDICaptureService } from '../midi-capture/service';
import { MIDINRPNEvent, MIDINoteOnEvent, MIDIProgramChangeEvent } from '../midi-parser';

const TEST_MONGO_URL = process.env.TEST_MONGO_URL ?? 'mongodb://127.0.0.1:27017';
const TEST_DB = 'productionhub_test_capture';

// Minimal mock for MIDIStreamParser — just needs to be an EventEmitter
class MockParser extends EventEmitter {}

// Minimal mock for ShowContextService
class MockShowContext {
  private showId: string | null = null;
  setShowId(id: string | null) { this.showId = id; }
  async getCurrentShowId(): Promise<string | null> { return this.showId; }
}

describe('MIDICaptureService', () => {
  let client: MongoClient;
  let parser: MockParser;
  let showContext: MockShowContext;
  let service: MIDICaptureService;

  before(async () => {
    client = new MongoClient(TEST_MONGO_URL);
    await client.connect();
  });

  after(async () => {
    await client.db(TEST_DB).dropDatabase();
    await client.close();
  });

  beforeEach(async () => {
    try {
      await client.db(TEST_DB).collection('midi_events').drop();
    } catch {}

    parser = new MockParser();
    showContext = new MockShowContext();
    service = new MIDICaptureService(
      { mongoUrl: TEST_MONGO_URL, dbName: TEST_DB },
      parser as any,
      showContext as any,
      0, // baseMidiChannel
    );
    await service.connect();
    service.start();
  });

  afterEach(async () => {
    service.stop();
    await service.disconnect();
  });

  // --- NRPN fader event with resolvable strip ---

  it('should write NRPN fader event with resolved strip', async () => {
    const event: MIDINRPNEvent = {
      type: 'nrpn',
      channel: 0,      // base+0 = inputs
      paramMSB: 0x02,  // strip 3 (0-indexed)
      paramLSB: 0x17,  // fader level
      value: 100,
    };

    parser.emit('midi', event);

    // Wait for async write
    await new Promise(r => setTimeout(r, 50));

    const docs = await client.db(TEST_DB).collection('midi_events').find().toArray();
    assert.equal(docs.length, 1);

    const doc = docs[0] as any;
    assert.equal(doc.source, 'avantis');
    assert.equal(doc.type, 'nrpn');
    assert.equal(doc.param, 'fader');
    assert.ok(doc.event_id);
    assert.ok(doc.timestamp);

    // Strip resolved: input 3
    assert.deepEqual(doc.strip, { type: 'input', number: 3 });

    // Value normalized: midiToFloat(100) = 100/127
    assert.ok(Math.abs(doc.value - 100 / 127) < 0.001);

    // Raw preserved
    assert.deepEqual(doc.raw, { channel: 0, paramMSB: 0x02, paramLSB: 0x17, value: 100 });
  });

  // --- NRPN event with unresolvable strip ---

  it('should write event with strip=null when strip cannot be resolved', async () => {
    const event: MIDINRPNEvent = {
      type: 'nrpn',
      channel: 0,
      paramMSB: 0x7F,  // invalid strip
      paramLSB: 0x17,
      value: 64,
    };

    parser.emit('midi', event);
    await new Promise(r => setTimeout(r, 50));

    const docs = await client.db(TEST_DB).collection('midi_events').find().toArray();
    assert.equal(docs.length, 1);

    const doc = docs[0] as any;
    assert.equal(doc.strip, null);
    assert.equal(doc.param, 'unknown');
    assert.deepEqual(doc.raw, { channel: 0, paramMSB: 0x7F, paramLSB: 0x17, value: 64 });
  });

  // --- show_id is null when no show active ---

  it('should set show_id to null when no show is active', async () => {
    showContext.setShowId(null);

    const event: MIDINRPNEvent = {
      type: 'nrpn',
      channel: 0,
      paramMSB: 0x00,
      paramLSB: 0x17,
      value: 50,
    };

    parser.emit('midi', event);
    await new Promise(r => setTimeout(r, 50));

    const doc = await client.db(TEST_DB).collection('midi_events').findOne() as any;
    assert.equal(doc.show_id, null);
  });

  // --- show_id is populated when show is active ---

  it('should set show_id when a show is active', async () => {
    showContext.setShowId('test-show-uuid-123');

    const event: MIDINRPNEvent = {
      type: 'nrpn',
      channel: 0,
      paramMSB: 0x00,
      paramLSB: 0x17,
      value: 50,
    };

    parser.emit('midi', event);
    await new Promise(r => setTimeout(r, 50));

    const doc = await client.db(TEST_DB).collection('midi_events').findOne() as any;
    assert.equal(doc.show_id, 'test-show-uuid-123');
  });

  // --- Note On mute event ---

  it('should capture mute on event (velocity >= 0x40)', async () => {
    const event: MIDINoteOnEvent = {
      type: 'noteon',
      channel: 0,
      note: 5,
      velocity: 0x7F,
    };

    parser.emit('midi', event);
    await new Promise(r => setTimeout(r, 50));

    const doc = await client.db(TEST_DB).collection('midi_events').findOne() as any;
    assert.equal(doc.type, 'noteon');
    assert.equal(doc.param, 'mute');
    assert.equal(doc.value, 1);
    assert.deepEqual(doc.raw, { channel: 0, note: 5, velocity: 0x7F });
  });

  it('should capture mute off event (velocity < 0x40)', async () => {
    const event: MIDINoteOnEvent = {
      type: 'noteon',
      channel: 0,
      note: 5,
      velocity: 0x3F,
    };

    parser.emit('midi', event);
    await new Promise(r => setTimeout(r, 50));

    const doc = await client.db(TEST_DB).collection('midi_events').findOne() as any;
    assert.equal(doc.param, 'mute');
    assert.equal(doc.value, 0);
  });

  // --- Program Change scene event ---

  it('should capture program change as scene event', async () => {
    const event: MIDIProgramChangeEvent = {
      type: 'pc',
      channel: 0,
      program: 42,
    };

    parser.emit('midi', event);
    await new Promise(r => setTimeout(r, 50));

    const doc = await client.db(TEST_DB).collection('midi_events').findOne() as any;
    assert.equal(doc.type, 'pc');
    assert.equal(doc.param, 'scene');
    assert.equal(doc.value, 42);
    assert.deepEqual(doc.raw, { channel: 0, program: 42 });
  });

  // --- NRPN pan event ---

  it('should capture NRPN pan event', async () => {
    const event: MIDINRPNEvent = {
      type: 'nrpn',
      channel: 0,
      paramMSB: 0x00,
      paramLSB: 0x18, // pan
      value: 64,
    };

    parser.emit('midi', event);
    await new Promise(r => setTimeout(r, 50));

    const doc = await client.db(TEST_DB).collection('midi_events').findOne() as any;
    assert.equal(doc.param, 'pan');
    assert.ok(Math.abs(doc.value - 64 / 127) < 0.001);
  });

  // --- start/stop attaches and detaches listener ---

  it('should not write events after stop()', async () => {
    service.stop();

    const event: MIDINRPNEvent = {
      type: 'nrpn',
      channel: 0,
      paramMSB: 0x00,
      paramLSB: 0x17,
      value: 50,
    };

    parser.emit('midi', event);
    await new Promise(r => setTimeout(r, 50));

    const count = await client.db(TEST_DB).collection('midi_events').countDocuments();
    assert.equal(count, 0);
  });

  it('should resume writing after start() is called again', async () => {
    service.stop();
    service.start();

    const event: MIDINRPNEvent = {
      type: 'nrpn',
      channel: 0,
      paramMSB: 0x00,
      paramLSB: 0x17,
      value: 50,
    };

    parser.emit('midi', event);
    await new Promise(r => setTimeout(r, 50));

    const count = await client.db(TEST_DB).collection('midi_events').countDocuments();
    assert.equal(count, 1);
  });

  // --- Failed DB write logs warning, does not throw ---

  it('should not throw on DB write failure', async () => {
    // Disconnect to force write failure
    await service.disconnect();

    const event: MIDINRPNEvent = {
      type: 'nrpn',
      channel: 0,
      paramMSB: 0x00,
      paramLSB: 0x17,
      value: 50,
    };

    // Should not throw
    parser.emit('midi', event);
    await new Promise(r => setTimeout(r, 50));

    // No crash = pass
    assert.ok(true);
  });
});
