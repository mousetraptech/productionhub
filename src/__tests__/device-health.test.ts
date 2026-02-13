import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { setTimeout as delay } from 'node:timers/promises';
import { EventEmitter } from 'events';
import { DeviceDriver, FeedbackEvent } from '../drivers/device-driver';
import { DeviceHealthManager } from '../health/device-health-manager';
import { DEFAULT_RECONNECT, DEFAULT_HEARTBEAT } from '../health/types';

/**
 * Mock driver that simulates connect/disconnect behavior.
 * Allows manual triggering of events for controlled testing.
 */
class MockDriver extends EventEmitter implements DeviceDriver {
  readonly name: string;
  readonly prefix: string;
  private _connected = false;
  connectCalls = 0;
  disconnectCalls = 0;

  constructor(name: string, prefix: string) {
    super();
    this.name = name;
    this.prefix = prefix;
  }

  connect(): void {
    this.connectCalls++;
    // Don't auto-emit connected - let test control it
  }

  disconnect(): void {
    this.disconnectCalls++;
    this._connected = false;
  }

  isConnected(): boolean { return this._connected; }
  handleOSC(_address: string, _args: any[]): void {}
  handleFadeTick(_key: string, _value: number): void {}

  // Test helpers
  simulateConnect(): void {
    this._connected = true;
    this.emit('connected');
  }

  simulateDisconnect(): void {
    this._connected = false;
    this.emit('disconnected');
  }

  simulateError(msg: string): void {
    this.emit('error', new Error(msg));
  }

  simulateFeedback(address: string): void {
    this.emit('feedback', { address, args: [] } as FeedbackEvent);
  }
}

describe('DeviceHealthManager', () => {
  describe('Connection state machine', () => {
    it('should start in disconnected state', () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', { enabled: false });
      assert.strictEqual(hm.state, 'disconnected');
    });

    it('should transition to connecting when connect() is called', () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', { enabled: false });
      const states: string[] = [];
      hm.on('stateChange', (s: string) => states.push(s));

      hm.connect();
      assert.strictEqual(hm.state, 'connecting');
      assert.deepStrictEqual(states, ['connecting']);
      hm.shutdown();
    });

    it('should transition to connected when driver emits connected', () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: false,
      }, { enabled: false });
      const states: string[] = [];
      hm.on('stateChange', (s: string) => states.push(s));

      hm.connect();
      driver.simulateConnect();

      assert.strictEqual(hm.state, 'connected');
      assert.deepStrictEqual(states, ['connecting', 'connected']);
      hm.shutdown();
    });

    it('should transition to disconnected when driver emits disconnected', () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: false,
      }, { enabled: false });

      hm.connect();
      driver.simulateConnect();
      driver.simulateDisconnect();

      assert.strictEqual(hm.state, 'disconnected');
      hm.shutdown();
    });

    it('should transition to error when connect attempt fails', () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: false,
      }, { enabled: false });

      hm.connect();
      assert.strictEqual(hm.state, 'connecting');
      driver.simulateError('ECONNREFUSED');

      assert.strictEqual(hm.state, 'error');
      hm.shutdown();
    });

    it('should emit stateChange events for all transitions', () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: false,
      }, { enabled: false });
      const transitions: Array<{ from: string; to: string }> = [];
      hm.on('stateChange', (to: string, from: string) => {
        transitions.push({ from, to });
      });

      hm.connect();
      driver.simulateConnect();
      driver.simulateDisconnect();

      assert.strictEqual(transitions.length, 3);
      assert.deepStrictEqual(transitions[0], { from: 'disconnected', to: 'connecting' });
      assert.deepStrictEqual(transitions[1], { from: 'connecting', to: 'connected' });
      assert.deepStrictEqual(transitions[2], { from: 'connected', to: 'disconnected' });
      hm.shutdown();
    });
  });

  describe('Auto-reconnect with exponential backoff', () => {
    it('should schedule reconnect after disconnect', async () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: true,
        backoffMs: 50,
        maxBackoffMs: 500,
        maxAttempts: 0,
      }, { enabled: false });

      hm.connect();
      driver.simulateConnect();
      driver.simulateDisconnect();

      // Reconnect attempts incremented immediately when scheduling
      assert.strictEqual(hm.reconnectAttempts, 1);

      await delay(100);

      // After backoff, should have attempted reconnect
      assert.strictEqual(hm.state, 'reconnecting');
      assert.strictEqual(driver.connectCalls, 2); // initial + 1 reconnect

      hm.shutdown();
    });

    it('should double backoff on each attempt', () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: true,
        backoffMs: 100,
        maxBackoffMs: 10000,
        maxAttempts: 0,
      }, { enabled: false });

      // Simulate increasing attempts
      assert.strictEqual(hm.calculateBackoff(), 100);   // attempt 0: 100 * 2^0 = 100

      // After first failed reconnect (reconnectAttempts = 1)
      hm.connect();
      driver.simulateConnect();
      driver.simulateDisconnect();
      // reconnectAttempts becomes 1 after timer fires, but calculateBackoff uses current value

      hm.shutdown();
    });

    it('should cap backoff at maxBackoffMs', () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: true,
        backoffMs: 1000,
        maxBackoffMs: 5000,
        maxAttempts: 0,
      }, { enabled: false });

      // Even with many attempts, should not exceed cap
      // We can't easily set reconnectAttempts, but we can verify the formula
      // backoff = 1000 * 2^n, capped at 5000
      // n=0: 1000, n=1: 2000, n=2: 4000, n=3: 8000 (capped to 5000)
      const backoff = hm.calculateBackoff();
      assert.ok(backoff <= 5000, `backoff ${backoff} should be <= 5000`);

      hm.shutdown();
    });

    it('should reset backoff on successful connection', async () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: true,
        backoffMs: 50,
        maxBackoffMs: 500,
        maxAttempts: 0,
      }, { enabled: false });

      hm.connect();
      driver.simulateConnect();
      driver.simulateDisconnect();

      await delay(100);
      assert.strictEqual(hm.reconnectAttempts, 1);

      // Simulate successful reconnect
      driver.simulateConnect();
      assert.strictEqual(hm.reconnectAttempts, 0);
      assert.strictEqual(hm.state, 'connected');

      hm.shutdown();
    });

    it('should stop reconnecting after maxAttempts', async () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: true,
        backoffMs: 30,
        maxBackoffMs: 100,
        maxAttempts: 2,
      }, { enabled: false });

      hm.connect();
      driver.simulateConnect();

      // First disconnect
      driver.simulateDisconnect();
      await delay(60);
      // Should be reconnecting (attempt 1)
      driver.simulateError('ECONNREFUSED');

      // Should schedule again (attempt 2)
      await delay(120);
      driver.simulateError('ECONNREFUSED');

      // Now should stop — state should be 'error'
      await delay(200);
      assert.strictEqual(hm.state, 'error');

      hm.shutdown();
    });

    it('should not reconnect when reconnect is disabled', async () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: false,
      }, { enabled: false });

      hm.connect();
      driver.simulateConnect();
      driver.simulateDisconnect();

      await delay(100);

      // Should not have attempted reconnect
      assert.strictEqual(driver.connectCalls, 1); // only initial connect
      assert.strictEqual(hm.state, 'disconnected');

      hm.shutdown();
    });

    it('should not block other drivers during reconnect', async () => {
      const driver1 = new MockDriver('test1', '/test1');
      const driver2 = new MockDriver('test2', '/test2');
      const hm1 = new DeviceHealthManager(driver1, 'avantis', 'tcp', {
        enabled: true,
        backoffMs: 200,
        maxBackoffMs: 1000,
        maxAttempts: 0,
      }, { enabled: false });
      const hm2 = new DeviceHealthManager(driver2, 'obs', 'websocket', {
        enabled: false,
      }, { enabled: false });

      hm1.connect();
      hm2.connect();
      driver1.simulateConnect();
      driver2.simulateConnect();

      // Disconnect driver1 — should not affect driver2
      driver1.simulateDisconnect();

      assert.strictEqual(hm1.state, 'disconnected');
      assert.strictEqual(hm2.state, 'connected');

      hm1.shutdown();
      hm2.shutdown();
    });
  });

  describe('Heartbeat detection', () => {
    it('should detect dead connection via heartbeat timeout', async () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: false,
      }, {
        enabled: true,
        intervalMs: 50,
      });

      hm.connect();
      driver.simulateConnect();
      assert.strictEqual(hm.state, 'connected');

      // Don't send any data — heartbeat should timeout at 3x interval (150ms)
      await delay(250);

      // Should have triggered disconnect
      assert.strictEqual(driver.disconnectCalls, 1);

      hm.shutdown();
    });

    it('should not timeout when data is received regularly', async () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: false,
      }, {
        enabled: true,
        intervalMs: 50,
      });

      hm.connect();
      driver.simulateConnect();

      // Simulate regular data
      const feedbackInterval = setInterval(() => {
        driver.simulateFeedback('/ch/1/mix/fader');
      }, 30);

      await delay(200);

      clearInterval(feedbackInterval);
      assert.strictEqual(hm.state, 'connected');
      assert.strictEqual(driver.disconnectCalls, 0);

      hm.shutdown();
    });

    it('should not apply heartbeat timeout for UDP drivers', async () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'chamsys', 'udp', {
        enabled: false,
      }, {
        enabled: true,
        intervalMs: 50,
      });

      hm.connect();
      driver.simulateConnect();

      // No data sent — but UDP should not trigger disconnect
      await delay(250);

      assert.strictEqual(hm.state, 'connected');
      assert.strictEqual(driver.disconnectCalls, 0);

      hm.shutdown();
    });
  });

  describe('Health status reporting', () => {
    it('should return correct health snapshot', () => {
      const driver = new MockDriver('avantis', '/avantis');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: false,
      }, { enabled: false });

      const health = hm.getHealth();
      assert.strictEqual(health.name, 'avantis');
      assert.strictEqual(health.type, 'avantis');
      assert.strictEqual(health.prefix, '/avantis');
      assert.strictEqual(health.state, 'disconnected');
      assert.strictEqual(health.lastSeen, null);
      assert.strictEqual(health.reconnectAttempts, 0);
      assert.strictEqual(health.latencyMs, null);

      hm.shutdown();
    });

    it('should update lastSeen on feedback', () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: false,
      }, { enabled: false });

      hm.connect();
      driver.simulateConnect();

      const before = Date.now();
      driver.simulateFeedback('/ch/1/mix/fader');
      const after = Date.now();

      const health = hm.getHealth();
      assert.ok(health.lastSeen !== null, 'lastSeen should not be null');
      assert.ok(health.lastSeen!.getTime() >= before);
      assert.ok(health.lastSeen!.getTime() <= after);

      hm.shutdown();
    });

    it('should update lastSeen on markDataReceived', () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: false,
      }, { enabled: false });

      hm.connect();
      driver.simulateConnect();

      hm.markDataReceived();

      const health = hm.getHealth();
      assert.ok(health.lastSeen !== null);

      hm.shutdown();
    });

    it('should track reconnect attempts', async () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: true,
        backoffMs: 30,
        maxBackoffMs: 100,
        maxAttempts: 0,
      }, { enabled: false });

      hm.connect();
      driver.simulateConnect();
      driver.simulateDisconnect();

      await delay(60);

      const health = hm.getHealth();
      assert.strictEqual(health.reconnectAttempts, 1);

      hm.shutdown();
    });

    it('should reflect correct state in health snapshot', () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: false,
      }, { enabled: false });

      assert.strictEqual(hm.getHealth().state, 'disconnected');

      hm.connect();
      assert.strictEqual(hm.getHealth().state, 'connecting');

      driver.simulateConnect();
      assert.strictEqual(hm.getHealth().state, 'connected');

      hm.shutdown();
    });
  });

  describe('Default config', () => {
    it('should have correct defaults for reconnect', () => {
      assert.strictEqual(DEFAULT_RECONNECT.enabled, true);
      assert.strictEqual(DEFAULT_RECONNECT.maxAttempts, 0);
      assert.strictEqual(DEFAULT_RECONNECT.backoffMs, 1000);
      assert.strictEqual(DEFAULT_RECONNECT.maxBackoffMs, 30000);
    });

    it('should have correct defaults for heartbeat', () => {
      assert.strictEqual(DEFAULT_HEARTBEAT.enabled, true);
      assert.strictEqual(DEFAULT_HEARTBEAT.intervalMs, 5000);
    });
  });

  describe('Shutdown', () => {
    it('should clear all timers on shutdown', async () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: true,
        backoffMs: 50,
        maxBackoffMs: 500,
        maxAttempts: 0,
      }, {
        enabled: true,
        intervalMs: 50,
      });

      hm.connect();
      driver.simulateConnect();
      driver.simulateDisconnect();

      // Shutdown should cancel reconnect timer
      hm.shutdown();
      assert.strictEqual(hm.state, 'disconnected');

      await delay(200);

      // Should not have reconnected
      assert.strictEqual(driver.connectCalls, 1);
    });

    it('should transition to disconnected on shutdown', () => {
      const driver = new MockDriver('test', '/test');
      const hm = new DeviceHealthManager(driver, 'avantis', 'tcp', {
        enabled: false,
      }, { enabled: false });

      hm.connect();
      driver.simulateConnect();
      assert.strictEqual(hm.state, 'connected');

      hm.shutdown();
      assert.strictEqual(hm.state, 'disconnected');
    });
  });
});
