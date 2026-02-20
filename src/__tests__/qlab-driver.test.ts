import { describe, it, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as dgram from 'dgram';
import * as osc from 'osc';
import { QLabDriver } from '../drivers/qlab-driver';
import { HubContext } from '../drivers/device-driver';

const mockHubContext: HubContext = {
  startFade: () => {},
  cancelFade: () => {},
  cancelAllFades: () => {},
  setCurrentValue: () => {},
  getCurrentValue: () => undefined,
};

const defaultConfig = {
  type: 'qlab' as const,
  prefix: '/sfx',
  host: '127.0.0.1',
  port: 53900,
};

describe('QLabDriver', () => {
  let driver: QLabDriver | null = null;

  afterEach(() => {
    if (driver) {
      driver.disconnect();
      driver = null;
    }
  });

  // --- Constructor ---

  describe('constructor', () => {
    it('should set name to "qlab" by default', () => {
      driver = new QLabDriver(defaultConfig, mockHubContext);
      assert.equal(driver.name, 'qlab');
    });

    it('should set prefix from config', () => {
      driver = new QLabDriver(defaultConfig, mockHubContext);
      assert.equal(driver.prefix, '/sfx');
    });

    it('should accept custom name via config', () => {
      const config = { ...defaultConfig, name: 'myQLab' };
      driver = new QLabDriver(config, mockHubContext);
      assert.equal(driver.name, 'myQLab');
    });
  });

  // --- Connection state ---

  describe('connection state', () => {
    it('should return false for isConnected before connect', () => {
      driver = new QLabDriver(defaultConfig, mockHubContext);
      assert.equal(driver.isConnected(), false);
    });

    it('should return true after connect completes', (_, done) => {
      driver = new QLabDriver(defaultConfig, mockHubContext);
      driver.on('connected', () => {
        assert.equal(driver!.isConnected(), true);
        done();
      });
      driver.connect();
    });

    it('should return false after disconnect', (_, done) => {
      driver = new QLabDriver(defaultConfig, mockHubContext);
      driver.on('connected', () => {
        driver!.disconnect();
        assert.equal(driver!.isConnected(), false);
        driver = null;
        done();
      });
      driver.connect();
    });
  });

  // --- handleOSC ---

  describe('handleOSC', () => {
    /** Helper: create a receiver, run a test, clean up */
    function withReceiver(fn: (receiver: dgram.Socket, port: number, cleanup: () => void) => void, done: (err?: any) => void) {
      const recv = dgram.createSocket('udp4');
      recv.bind(0, '127.0.0.1', () => {
        const port = (recv.address() as any).port;
        const cleanup = () => { try { recv.close(); } catch {} };
        fn(recv, port, cleanup);
      });
    }

    it('should send OSC messages to the target port', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        driver = new QLabDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          if (parsed.address === '/cue/applause/start') {
            cleanup();
            done();
          }
        });

        driver.on('connected', () => {
          driver!.handleOSC('/cue/applause/start', []);
        });
        driver.connect();
      }, done);
    });

    it('should send /connect handshake on startup', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        driver = new QLabDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          if (parsed.address === '/connect') {
            cleanup();
            done();
          }
        });

        driver.connect();
      }, done);
    });

    it('should send /updates 1 on startup', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        driver = new QLabDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          if (parsed.address === '/updates') {
            const arg = parsed.args[0] as any;
            assert.equal(arg.type, 'i');
            assert.equal(arg.value, 1);
            cleanup();
            done();
          }
        });

        driver.connect();
      }, done);
    });

    it('should send /connect with passcode when configured', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port, passcode: 'secret123' };
        driver = new QLabDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          if (parsed.address === '/connect') {
            const arg = parsed.args[0] as any;
            assert.equal(arg.type, 's');
            assert.equal(arg.value, 'secret123');
            cleanup();
            done();
          }
        });

        driver.connect();
      }, done);
    });

    it('should relay float args correctly', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        driver = new QLabDriver(config, mockHubContext);

        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          if (parsed.address === '/cue/1/level') {
            const arg = parsed.args[0] as any;
            assert.equal(arg.type, 'f');
            assert.ok(Math.abs(arg.value - 0.75) < 0.001);
            cleanup();
            done();
          }
        });

        driver.on('connected', () => {
          driver!.handleOSC('/cue/1/level', [{ type: 'f', value: 0.75 }]);
        });
        driver.connect();
      }, done);
    });

    it('should not throw when handling OSC without connect', () => {
      driver = new QLabDriver(defaultConfig, mockHubContext);
      assert.doesNotThrow(() => {
        driver!.handleOSC('/go', []);
      });
    });
  });

  // --- getState ---

  describe('getState', () => {
    it('should return correct initial state', () => {
      driver = new QLabDriver(defaultConfig, mockHubContext);
      const state = driver.getState();
      assert.equal(state.connected, false);
      assert.equal(state.playhead, '');
      assert.deepEqual(state.runningCues, []);
      assert.equal(state.runningCount, 0);
    });

    it('should return connected true after connect', (_, done) => {
      driver = new QLabDriver(defaultConfig, mockHubContext);
      driver.on('connected', () => {
        const state = driver!.getState();
        assert.equal(state.connected, true);
        done();
      });
      driver.connect();
    });
  });

  // --- Fade engine ---

  describe('fade engine', () => {
    it('handleFadeTick should be a no-op', () => {
      driver = new QLabDriver(defaultConfig, mockHubContext);
      assert.doesNotThrow(() => {
        driver!.handleFadeTick('some/key', 0.5);
      });
    });
  });

  // --- Reconnect queue ---

  describe('reconnect queue', () => {
    /** Helper: create a receiver, run a test, clean up */
    function withReceiver(fn: (receiver: dgram.Socket, port: number, cleanup: () => void) => void, done: (err?: any) => void) {
      const recv = dgram.createSocket('udp4');
      recv.bind(0, '127.0.0.1', () => {
        const port = (recv.address() as any).port;
        const cleanup = () => { try { recv.close(); } catch {} };
        fn(recv, port, cleanup);
      });
    }

    it('should queue messages when not connected', () => {
      driver = new QLabDriver(defaultConfig, mockHubContext);
      assert.doesNotThrow(() => {
        driver!.handleOSC('/go', []);
        driver!.handleOSC('/cue/1/start', []);
      });
    });

    it('should replay queued messages on connect', (_, done) => {
      withReceiver((receiver, port, cleanup) => {
        const config = { ...defaultConfig, port };
        driver = new QLabDriver(config, mockHubContext);

        // Queue messages while disconnected
        driver.handleOSC('/go', []);
        driver.handleOSC('/cue/5/start', []);

        const received: string[] = [];
        receiver.on('message', (msg) => {
          const parsed = osc.readMessage(msg, { metadata: true });
          // Skip handshake messages (/connect, /updates)
          if (parsed.address === '/connect' || parsed.address === '/updates') return;
          received.push(parsed.address);
          if (received.length === 2) {
            assert.deepEqual(received, ['/go', '/cue/5/start']);
            cleanup();
            done();
          }
        });

        // Connect — should replay queued messages after handshake
        driver.connect();
      }, done);
    });
  });
});
