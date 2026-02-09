import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as dgram from 'dgram';
import * as osc from 'osc';
import { TouchDesignerDriver } from '../drivers/touchdesigner-driver';
import { HubContext } from '../drivers/device-driver';

const mockHubContext: HubContext = {
  startFade: () => {},
  cancelFade: () => {},
  cancelAllFades: () => {},
  setCurrentValue: () => {},
  getCurrentValue: () => undefined,
};

const defaultConfig = {
  type: 'touchdesigner' as const,
  prefix: '/td',
  host: '127.0.0.1',
  port: 12000,
};

describe('TouchDesignerDriver', () => {

  // --- Constructor ---

  describe('constructor', () => {
    it('should set name to "touchdesigner" by default', () => {
      const driver = new TouchDesignerDriver(defaultConfig, mockHubContext);
      assert.equal(driver.name, 'touchdesigner');
    });

    it('should set prefix from config', () => {
      const driver = new TouchDesignerDriver(defaultConfig, mockHubContext);
      assert.equal(driver.prefix, '/td');
    });

    it('should accept custom name via config', () => {
      const config = { ...defaultConfig, name: 'mainRender' };
      const driver = new TouchDesignerDriver(config, mockHubContext);
      assert.equal(driver.name, 'mainRender');
    });
  });

  // --- Connection state ---

  describe('connection state', () => {
    it('should return false for isConnected before connect', () => {
      const driver = new TouchDesignerDriver(defaultConfig, mockHubContext);
      assert.equal(driver.isConnected(), false);
    });

    it('should return true after connect completes', (_, done) => {
      const driver = new TouchDesignerDriver(defaultConfig, mockHubContext);
      driver.on('connected', () => {
        assert.equal(driver.isConnected(), true);
        driver.disconnect();
        done();
      });
      driver.connect();
    });

    it('should return false after disconnect', (_, done) => {
      const driver = new TouchDesignerDriver(defaultConfig, mockHubContext);
      driver.on('connected', () => {
        driver.disconnect();
        assert.equal(driver.isConnected(), false);
        done();
      });
      driver.connect();
    });

    it('should emit "connected" event when UDP socket binds', (_, done) => {
      const driver = new TouchDesignerDriver(defaultConfig, mockHubContext);
      driver.on('connected', () => {
        driver.disconnect();
        done();
      });
      driver.connect();
    });
  });

  // --- Not-connected behavior ---

  describe('not connected behavior', () => {
    it('should not throw when handling OSC without connect', () => {
      const driver = new TouchDesignerDriver(defaultConfig, mockHubContext);
      assert.doesNotThrow(() => {
        driver.handleOSC('/render/start', []);
      });
    });

    it('should not throw when handling OSC with float args without connect', () => {
      const driver = new TouchDesignerDriver(defaultConfig, mockHubContext);
      assert.doesNotThrow(() => {
        driver.handleOSC('/param/opacity', [{ type: 'f', value: 0.75 }]);
      });
    });

    it('should not throw when handling OSC with int args without connect', () => {
      const driver = new TouchDesignerDriver(defaultConfig, mockHubContext);
      assert.doesNotThrow(() => {
        driver.handleOSC('/cue/1', [{ type: 'i', value: 1 }]);
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
        const driver = new TouchDesignerDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          assert.equal(parsed.address, '/render/start');
          driver.disconnect();
          cleanup();
          done();
        });

        driver.on('connected', () => { driver.handleOSC('/render/start', []); });
        driver.connect();
      }, done);
    });

    it('should relay float args correctly', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        const driver = new TouchDesignerDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          assert.equal(parsed.address, '/param/opacity');
          const arg = parsed.args[0] as any;
          assert.equal(arg.type, 'f');
          assert.ok(Math.abs(arg.value - 0.75) < 0.001);
          driver.disconnect();
          cleanup();
          done();
        });

        driver.on('connected', () => { driver.handleOSC('/param/opacity', [{ type: 'f', value: 0.75 }]); });
        driver.connect();
      }, done);
    });

    it('should relay integer args correctly', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        const driver = new TouchDesignerDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          assert.equal(parsed.address, '/cue/5');
          const arg = parsed.args[0] as any;
          assert.equal(arg.type, 'i');
          assert.equal(arg.value, 1);
          driver.disconnect();
          cleanup();
          done();
        });

        driver.on('connected', () => { driver.handleOSC('/cue/5', [{ type: 'i', value: 1 }]); });
        driver.connect();
      }, done);
    });

    it('should normalize raw float args', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        const driver = new TouchDesignerDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          const arg = parsed.args[0] as any;
          assert.equal(arg.type, 'f');
          assert.ok(Math.abs(arg.value - 0.5) < 0.001);
          driver.disconnect();
          cleanup();
          done();
        });

        driver.on('connected', () => { driver.handleOSC('/blend/layer1', [0.5]); });
        driver.connect();
      }, done);
    });

    it('should normalize raw integer args', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        const driver = new TouchDesignerDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          const arg = parsed.args[0] as any;
          assert.equal(arg.type, 'i');
          assert.equal(arg.value, 42);
          driver.disconnect();
          cleanup();
          done();
        });

        driver.on('connected', () => { driver.handleOSC('/render/frame', [42]); });
        driver.connect();
      }, done);
    });

    it('should normalize raw string args', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        const driver = new TouchDesignerDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          const arg = parsed.args[0] as any;
          assert.equal(arg.type, 's');
          assert.equal(arg.value, 'hello');
          driver.disconnect();
          cleanup();
          done();
        });

        driver.on('connected', () => { driver.handleOSC('/text/label', ['hello']); });
        driver.connect();
      }, done);
    });

    it('should relay messages with no args', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        const driver = new TouchDesignerDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          assert.equal(parsed.address, '/render/stop');
          assert.equal(parsed.args.length, 0);
          driver.disconnect();
          cleanup();
          done();
        });

        driver.on('connected', () => { driver.handleOSC('/render/stop', []); });
        driver.connect();
      }, done);
    });

    it('should relay multiple args', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        const driver = new TouchDesignerDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          assert.equal(parsed.args.length, 2);
          driver.disconnect();
          cleanup();
          done();
        });

        driver.on('connected', () => {
          driver.handleOSC('/render/resolution', [
            { type: 'i', value: 1920 },
            { type: 'i', value: 1080 },
          ]);
        });
        driver.connect();
      }, done);
    });

    it('should preserve arbitrary address paths (transparent relay)', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        const driver = new TouchDesignerDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          assert.equal(parsed.address, '/deeply/nested/parameter/value');
          driver.disconnect();
          cleanup();
          done();
        });

        driver.on('connected', () => { driver.handleOSC('/deeply/nested/parameter/value', []); });
        driver.connect();
      }, done);
    });
  });

  // --- Reconnect queue ---

  describe('reconnect queue', () => {
    it('should queue messages when not connected', () => {
      const driver = new TouchDesignerDriver(defaultConfig, mockHubContext);
      assert.doesNotThrow(() => {
        driver.handleOSC('/render/start', []);
        driver.handleOSC('/param/opacity', [{ type: 'f', value: 0.5 }]);
      });
    });

    it('should replay queued messages on connect', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        const driver = new TouchDesignerDriver(config, mockHubContext);

        // Queue messages while disconnected
        driver.handleOSC('/render/start', []);
        driver.handleOSC('/cue/3', [{ type: 'i', value: 1 }]);

        const received: string[] = [];
        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          received.push(parsed.address);
          if (received.length === 2) {
            assert.deepEqual(received, ['/render/start', '/cue/3']);
            driver.disconnect();
            cleanup();
            done();
          }
        });

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
      const driver = new TouchDesignerDriver(defaultConfig, mockHubContext);
      assert.doesNotThrow(() => {
        driver.handleFadeTick('some/key', 0.5);
      });
    });
  });
});
