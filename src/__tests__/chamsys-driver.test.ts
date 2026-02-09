import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as dgram from 'dgram';
import * as osc from 'osc';
import { ChamSysDriver } from '../drivers/chamsys-driver';
import { HubContext } from '../drivers/device-driver';

const mockHubContext: HubContext = {
  startFade: () => {},
  cancelFade: () => {},
  cancelAllFades: () => {},
  setCurrentValue: () => {},
  getCurrentValue: () => undefined,
};

const defaultConfig = {
  type: 'chamsys' as const,
  prefix: '/lights',
  host: '127.0.0.1',
  port: 7000,
};

describe('ChamSysDriver', () => {

  // --- Constructor ---

  describe('constructor', () => {
    it('should set name to "chamsys" by default', () => {
      const driver = new ChamSysDriver(defaultConfig, mockHubContext);
      assert.equal(driver.name, 'chamsys');
    });

    it('should set prefix from config', () => {
      const driver = new ChamSysDriver(defaultConfig, mockHubContext);
      assert.equal(driver.prefix, '/lights');
    });

    it('should accept custom name via config', () => {
      const config = { ...defaultConfig, name: 'myLights' };
      const driver = new ChamSysDriver(config, mockHubContext);
      assert.equal(driver.name, 'myLights');
    });
  });

  // --- Connection state ---

  describe('connection state', () => {
    it('should return false for isConnected before connect', () => {
      const driver = new ChamSysDriver(defaultConfig, mockHubContext);
      assert.equal(driver.isConnected(), false);
    });

    it('should return true after connect completes', (_, done) => {
      const driver = new ChamSysDriver(defaultConfig, mockHubContext);
      driver.on('connected', () => {
        assert.equal(driver.isConnected(), true);
        driver.disconnect();
        done();
      });
      driver.connect();
    });

    it('should return false after disconnect', (_, done) => {
      const driver = new ChamSysDriver(defaultConfig, mockHubContext);
      driver.on('connected', () => {
        driver.disconnect();
        assert.equal(driver.isConnected(), false);
        done();
      });
      driver.connect();
    });

    it('should emit "connected" event when UDP socket binds', (_, done) => {
      const driver = new ChamSysDriver(defaultConfig, mockHubContext);
      driver.on('connected', () => {
        driver.disconnect();
        done();
      });
      driver.connect();
    });
  });

  // --- Message dropping when not connected ---

  describe('not connected behavior', () => {
    it('should not throw when handling OSC without connect', () => {
      const driver = new ChamSysDriver(defaultConfig, mockHubContext);
      assert.doesNotThrow(() => {
        driver.handleOSC('/pb/1/1', []);
      });
    });

    it('should not throw when handling OSC with args without connect', () => {
      const driver = new ChamSysDriver(defaultConfig, mockHubContext);
      assert.doesNotThrow(() => {
        driver.handleOSC('/pb/1/1/level', [{ type: 'f', value: 0.75 }]);
      });
    });
  });

  // --- UDP relay tests with a real receiver ---

  describe('UDP relay', () => {
    /** Helper: create a receiver, run a test, clean up */
    function withReceiver(fn: (receiver: dgram.Socket, port: number, cleanup: () => void) => void, done: (err?: any) => void) {
      const recv = dgram.createSocket('udp4');
      recv.bind(0, '127.0.0.1', () => {
        const port = (recv.address() as any).port;
        const cleanup = () => { try { recv.close(); } catch {} };
        fn(recv, port, cleanup);
      });
    }

    it('should relay OSC message to target host:port', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        const driver = new ChamSysDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          assert.equal(parsed.address, '/pb/1/1');
          driver.disconnect();
          cleanup();
          done();
        });

        driver.on('connected', () => { driver.handleOSC('/pb/1/1', []); });
        driver.connect();
      }, done);
    });

    it('should relay float args correctly', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        const driver = new ChamSysDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          assert.equal(parsed.address, '/pb/1/1/level');
          const arg = parsed.args[0] as any;
          assert.equal(arg.type, 'f');
          assert.ok(Math.abs(arg.value - 0.75) < 0.001);
          driver.disconnect();
          cleanup();
          done();
        });

        driver.on('connected', () => { driver.handleOSC('/pb/1/1/level', [{ type: 'f', value: 0.75 }]); });
        driver.connect();
      }, done);
    });

    it('should relay integer args correctly', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        const driver = new ChamSysDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          assert.equal(parsed.address, '/exec/5');
          const arg = parsed.args[0] as any;
          assert.equal(arg.type, 'i');
          assert.equal(arg.value, 42);
          driver.disconnect();
          cleanup();
          done();
        });

        driver.on('connected', () => { driver.handleOSC('/exec/5', [{ type: 'i', value: 42 }]); });
        driver.connect();
      }, done);
    });

    it('should normalize raw float args to typed objects', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        const driver = new ChamSysDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          const arg = parsed.args[0] as any;
          assert.equal(arg.type, 'f');
          assert.ok(Math.abs(arg.value - 0.5) < 0.001);
          driver.disconnect();
          cleanup();
          done();
        });

        driver.on('connected', () => { driver.handleOSC('/pb/2/1/level', [0.5]); });
        driver.connect();
      }, done);
    });

    it('should normalize raw integer args', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        const driver = new ChamSysDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          const arg = parsed.args[0] as any;
          assert.equal(arg.type, 'i');
          assert.equal(arg.value, 3);
          driver.disconnect();
          cleanup();
          done();
        });

        driver.on('connected', () => { driver.handleOSC('/release/1', [3]); });
        driver.connect();
      }, done);
    });

    it('should relay messages with no args', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        const driver = new ChamSysDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          assert.equal(parsed.address, '/pb/1/1');
          assert.equal(parsed.args.length, 0);
          driver.disconnect();
          cleanup();
          done();
        });

        driver.on('connected', () => { driver.handleOSC('/pb/1/1', []); });
        driver.connect();
      }, done);
    });

    it('should relay multiple args', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        const driver = new ChamSysDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          assert.equal(parsed.args.length, 2);
          driver.disconnect();
          cleanup();
          done();
        });

        driver.on('connected', () => {
          driver.handleOSC('/intensity/1/100', [
            { type: 'f', value: 0.8 },
            { type: 'i', value: 255 },
          ]);
        });
        driver.connect();
      }, done);
    });

    it('should preserve address path for playback commands', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        const driver = new ChamSysDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          assert.equal(parsed.address, '/pb/3/2');
          driver.disconnect();
          cleanup();
          done();
        });

        driver.on('connected', () => { driver.handleOSC('/pb/3/2', []); });
        driver.connect();
      }, done);
    });
  });

  // --- Reconnect queue ---

  describe('reconnect queue', () => {
    it('should queue messages when not connected', () => {
      const driver = new ChamSysDriver(defaultConfig, mockHubContext);
      // Not connected — should not throw, should queue
      assert.doesNotThrow(() => {
        driver.handleOSC('/pb/1/1', []);
        driver.handleOSC('/exec/1', [{ type: 'i', value: 1 }]);
      });
    });

    it('should replay queued messages on connect', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        const driver = new ChamSysDriver(config, mockHubContext);

        // Queue messages while disconnected
        driver.handleOSC('/pb/1/1', []);
        driver.handleOSC('/exec/5', [{ type: 'i', value: 42 }]);

        const received: string[] = [];
        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          received.push(parsed.address);
          if (received.length === 2) {
            assert.deepEqual(received, ['/pb/1/1', '/exec/5']);
            driver.disconnect();
            cleanup();
            done();
          }
        });

        // Connect — should replay queued messages
        driver.connect();
      }, done);
    });

    function withReceiver(fn: (receiver: dgram.Socket, port: number, cleanup: () => void) => void, done: (err?: any) => void) {
      const recv = dgram.createSocket('udp4');
      recv.bind(0, '127.0.0.1', () => {
        const port = (recv.address() as any).port;
        const cleanup = () => { try { recv.close(); } catch {} };
        fn(recv, port, cleanup);
      });
    }
  });

  // --- Fade engine ---

  describe('fade engine', () => {
    it('handleFadeTick should be a no-op', () => {
      const driver = new ChamSysDriver(defaultConfig, mockHubContext);
      assert.doesNotThrow(() => {
        driver.handleFadeTick('some/key', 0.5);
      });
    });
  });
});
