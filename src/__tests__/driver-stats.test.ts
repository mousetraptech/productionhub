import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createDriverStats, inferTransportType } from '../driver-stats';

describe('createDriverStats', () => {
  it('should return correct initial values', () => {
    const stats = createDriverStats('avantis', '/avantis', 'tcp', '192.168.1.70', 51325);

    assert.equal(stats.name, 'avantis');
    assert.equal(stats.prefix, '/avantis');
    assert.equal(stats.transportType, 'tcp');
    assert.equal(stats.host, '192.168.1.70');
    assert.equal(stats.port, 51325);
    assert.equal(stats.connected, false);
    assert.equal(stats.reconnectCount, 0);
    assert.equal(stats.lastConnectedAt, null);
    assert.equal(stats.lastDisconnectedAt, null);
    assert.equal(stats.lastMessageReceivedAt, null);
    assert.equal(stats.lastError, null);
    assert.equal(stats.lastErrorAt, null);
  });

  it('should work with different transport types', () => {
    const ws = createDriverStats('obs', '/obs', 'websocket', '127.0.0.1', 4455);
    assert.equal(ws.transportType, 'websocket');

    const udp = createDriverStats('chamsys', '/lights', 'udp', '192.168.1.71', 7000);
    assert.equal(udp.transportType, 'udp');
  });
});

describe('inferTransportType', () => {
  it('should return tcp for avantis', () => {
    assert.equal(inferTransportType('avantis'), 'tcp');
  });

  it('should return tcp for visca', () => {
    assert.equal(inferTransportType('visca'), 'tcp');
  });

  it('should return websocket for obs', () => {
    assert.equal(inferTransportType('obs'), 'websocket');
  });

  it('should return udp for chamsys', () => {
    assert.equal(inferTransportType('chamsys'), 'udp');
  });

  it('should return udp for touchdesigner', () => {
    assert.equal(inferTransportType('touchdesigner'), 'udp');
  });

  it('should default to udp for unknown types', () => {
    assert.equal(inferTransportType('unknown'), 'udp');
    assert.equal(inferTransportType(''), 'udp');
  });
});
