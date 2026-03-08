import { describe, it, before, after, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { ShowContextService } from '../show-context/service';
import { DeviceSnapshot, ShowDocument } from '../show-context/types';

const TEST_MONGO_URL = process.env.TEST_MONGO_URL ?? 'mongodb://127.0.0.1:27017';
const TEST_DB = 'productionhub_test';

function mockSnapshot(): Promise<DeviceSnapshot> {
  return Promise.resolve({
    avantis: { reachable: true, ip: '192.168.10.20' },
    chamsys: { reachable: true },
    obs: { reachable: false },
    ptz_cameras: { reachable: true },
  });
}

describe('ShowContextService', () => {
  let service: ShowContextService;
  let client: MongoClient;

  before(async () => {
    // Direct client for cleanup
    client = new MongoClient(TEST_MONGO_URL);
    await client.connect();
  });

  after(async () => {
    await client.db(TEST_DB).dropDatabase();
    await client.close();
  });

  beforeEach(async () => {
    // Drop shows collection before each test
    try {
      await client.db(TEST_DB).collection('shows').drop();
    } catch {
      // Collection may not exist yet
    }

    service = new ShowContextService(
      { mongoUrl: TEST_MONGO_URL, dbName: TEST_DB },
      mockSnapshot,
    );
    await service.connect();
  });

  // --- Start Show ---

  it('should start a show and return a document with correct fields', async () => {
    const show = await service.startShow('Spring Recital');

    assert.ok(show.show_id, 'should have a UUID show_id');
    assert.equal(show.name, 'Spring Recital');
    assert.equal(show.state, 'active');
    assert.equal(show.operator, 'dave');
    assert.equal(show.closed_properly, false);
    assert.equal(show.ended_at, null);
    assert.ok(show.started_at);
    assert.ok(show.date);

    // Device snapshot
    assert.equal(show.device_snapshot.avantis.reachable, true);
    assert.equal(show.device_snapshot.avantis.ip, '192.168.10.20');
    assert.equal(show.device_snapshot.obs.reachable, false);

    await service.disconnect();
  });

  it('should be retrievable as the active show after starting', async () => {
    await service.startShow('Test Show');
    const active = await service.getActiveShow();

    assert.ok(active);
    assert.equal(active!.name, 'Test Show');
    assert.equal(active!.state, 'active');

    await service.disconnect();
  });

  // --- End Show ---

  it('should end the active show with closed_properly = true', async () => {
    await service.startShow('Evening Concert');
    const ended = await service.endShow();

    assert.ok(ended);
    assert.equal(ended!.name, 'Evening Concert');
    assert.equal(ended!.state, 'archived');
    assert.equal(ended!.closed_properly, true);
    assert.ok(ended!.ended_at);

    // No active show after ending
    const active = await service.getActiveShow();
    assert.equal(active, null);

    await service.disconnect();
  });

  it('should return null when ending with no active show', async () => {
    const result = await service.endShow();
    assert.equal(result, null);

    await service.disconnect();
  });

  // --- Auto-close on new show ---

  it('should auto-close active show when starting a new one', async () => {
    const first = await service.startShow('Show 1');
    await service.startShow('Show 2');

    // Second show should be active
    const active = await service.getActiveShow();
    assert.equal(active!.name, 'Show 2');
    assert.equal(active!.state, 'active');

    // First show should be improperly closed
    const firstDoc = await client.db(TEST_DB).collection('shows')
      .findOne({ show_id: first.show_id }) as unknown as ShowDocument;
    assert.equal(firstDoc.state, 'improperly_closed');
    assert.equal(firstDoc.closed_properly, false);
    assert.ok(firstDoc.ended_at);

    await service.disconnect();
  });

  // --- Orphan detection ---

  it('should close orphaned active shows on connect', async () => {
    // Create an "orphaned" active show directly in the DB
    await client.db(TEST_DB).collection('shows').insertOne({
      show_id: 'orphan-123',
      name: 'Orphaned Show',
      date: '2026-03-07',
      started_at: '2026-03-07T19:00:00.000Z',
      ended_at: null,
      closed_properly: false,
      state: 'active',
      operator: 'dave',
      device_snapshot: {
        avantis: { reachable: true, ip: '192.168.10.20' },
        chamsys: { reachable: true },
        obs: { reachable: true },
        ptz_cameras: { reachable: true },
      },
      notes: '',
    });

    // Disconnect and reconnect — should detect orphan
    await service.disconnect();
    const fresh = new ShowContextService(
      { mongoUrl: TEST_MONGO_URL, dbName: TEST_DB },
      mockSnapshot,
    );
    await fresh.connect();

    // Orphan should be closed
    const orphan = await client.db(TEST_DB).collection('shows')
      .findOne({ show_id: 'orphan-123' }) as unknown as ShowDocument;
    assert.equal(orphan.state, 'improperly_closed');
    assert.equal(orphan.closed_properly, false);
    assert.ok(orphan.ended_at);

    // No active show
    const active = await fresh.getActiveShow();
    assert.equal(active, null);

    await fresh.disconnect();
  });

  // --- Status ---

  it('should report idle status when no show is active', async () => {
    const status = await service.getStatus();
    assert.equal(status.state, 'idle');
    assert.equal(status.show, null);

    await service.disconnect();
  });

  it('should report active status with show document', async () => {
    await service.startShow('Status Test');
    const status = await service.getStatus();

    assert.equal(status.state, 'active');
    assert.ok(status.show);
    assert.equal(status.show!.name, 'Status Test');

    await service.disconnect();
  });

  // --- getCurrentShowId ---

  it('should return show_id when a show is active', async () => {
    const show = await service.startShow('ID Test');
    const id = await service.getCurrentShowId();
    assert.equal(id, show.show_id);

    await service.disconnect();
  });

  it('should return null when no show is active', async () => {
    const id = await service.getCurrentShowId();
    assert.equal(id, null);

    await service.disconnect();
  });

  // --- Device snapshot integration ---

  it('should capture device snapshot at show start', async () => {
    const show = await service.startShow('Snapshot Test');

    assert.deepEqual(show.device_snapshot, {
      avantis: { reachable: true, ip: '192.168.10.20' },
      chamsys: { reachable: true },
      obs: { reachable: false },
      ptz_cameras: { reachable: true },
    });

    await service.disconnect();
  });

  // --- Not connected error ---

  it('should throw when not connected', async () => {
    await service.disconnect();
    await assert.rejects(
      () => service.startShow('Fail'),
      { message: 'ShowContextService not connected. Call connect() first.' },
    );
  });
});
