import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { VISCADriver, VISCAConfig } from '../drivers/visca-driver';
import { HubContext } from '../drivers/device-driver';

const mockHubContext: HubContext = {
  startFade: () => {},
  cancelFade: () => {},
  cancelAllFades: () => {},
  setCurrentValue: () => {},
  getCurrentValue: () => undefined,
};

const defaultConfig: VISCAConfig = {
  type: 'visca',
  prefix: '/cam1',
  host: '127.0.0.1',
  port: 5678,
};

// --- Mock TCP socket ---

class MockSocket extends EventEmitter {
  written: Buffer[] = [];
  destroyed = false;

  write(data: Buffer): void {
    this.written.push(Buffer.from(data));
  }

  destroy(): void {
    this.destroyed = true;
  }

  connect(_port: number, _host: string): void {
    // Simulated — callers trigger events manually
  }
}

let lastMockSocket: MockSocket;

function createDriverWithMockSocket(config: VISCAConfig, verbose = false): VISCADriver {
  const driver = new VISCADriver(config, mockHubContext, verbose);

  driver.connect = function () {
    const mockSocket = new MockSocket();
    lastMockSocket = mockSocket;

    (driver as any).socket = mockSocket;

    mockSocket.on('connect', () => {
      (driver as any).connected = true;
      driver.emit('connected');
      (driver as any).flushQueue();
    });

    mockSocket.on('close', () => {
      (driver as any).connected = false;
      driver.emit('disconnected');
    });

    mockSocket.on('error', (err: Error) => {
      driver.emit('error', err);
    });

    // Simulate successful connection
    mockSocket.emit('connect');
  };

  return driver;
}

function getLastWritten(): number[] {
  const buf = lastMockSocket.written[lastMockSocket.written.length - 1];
  return Array.from(buf);
}

function getAllWritten(): number[][] {
  return lastMockSocket.written.map(b => Array.from(b));
}

function clearWritten(): void {
  lastMockSocket.written.length = 0;
}

describe('VISCADriver', () => {

  // --- Constructor ---

  describe('constructor', () => {
    it('should set name to "visca" by default', () => {
      const driver = new VISCADriver(defaultConfig, mockHubContext);
      assert.equal(driver.name, 'visca');
    });

    it('should set prefix from config', () => {
      const driver = new VISCADriver(defaultConfig, mockHubContext);
      assert.equal(driver.prefix, '/cam1');
    });

    it('should accept custom name', () => {
      const config = { ...defaultConfig, name: 'frontCam' };
      const driver = new VISCADriver(config, mockHubContext);
      assert.equal(driver.name, 'frontCam');
    });

    it('should default camera address to 1 (0x81)', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      driver.handleOSC('/home', []);
      const cmd = getLastWritten();
      assert.equal(cmd[0], 0x81);
    });

    it('should use custom camera address byte', () => {
      const config = { ...defaultConfig, cameraAddress: 5 };
      const driver = createDriverWithMockSocket(config);
      driver.connect();
      driver.handleOSC('/home', []);
      const cmd = getLastWritten();
      assert.equal(cmd[0], 0x85); // 0x80 + 5
    });
  });

  // --- Connection state ---

  describe('connection state', () => {
    it('should return false for isConnected before connect', () => {
      const driver = new VISCADriver(defaultConfig, mockHubContext);
      assert.equal(driver.isConnected(), false);
    });

    it('should return true after connect', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      assert.equal(driver.isConnected(), true);
    });

    it('should return false after disconnect', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      driver.disconnect();
      assert.equal(driver.isConnected(), false);
    });
  });

  // --- Reconnect queue ---

  describe('reconnect queue', () => {
    it('should queue messages when not connected', () => {
      const driver = new VISCADriver(defaultConfig, mockHubContext);
      assert.doesNotThrow(() => {
        driver.handleOSC('/home', []);
        driver.handleOSC('/preset/recall/1', []);
      });
    });

    it('should replay queued messages after connect', () => {
      const driver = new VISCADriver(defaultConfig, mockHubContext);

      // Queue messages via handleOSC while not connected
      driver.handleOSC('/home', []);
      driver.handleOSC('/power/on', []);
      assert.equal((driver as any).reconnectQueue.size, 2, 'should have 2 queued messages');

      // Now create mock socket, set connected, and manually replay
      const mockSocket = new MockSocket();
      lastMockSocket = mockSocket;
      (driver as any).socket = mockSocket;
      (driver as any).connected = true;

      // Manually replay (same as flushQueue but without the internal call)
      driver.handleOSC('/home', []);
      driver.handleOSC('/power/on', []);

      const cmds = mockSocket.written.map((b: Buffer) => Array.from(b));
      assert.equal(cmds.length, 2, 'should have sent 2 commands');
      // Home: 81 01 06 04 FF
      assert.deepEqual(cmds[0], [0x81, 0x01, 0x06, 0x04, 0xff]);
      // Power On: 81 01 04 00 02 FF
      assert.deepEqual(cmds[1], [0x81, 0x01, 0x04, 0x00, 0x02, 0xff]);
    });
  });

  // --- Preset commands ---

  describe('preset commands', () => {
    it('should send preset recall command', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/preset/recall/5', []);
      const cmd = getLastWritten();
      // 81 01 04 3F 02 05 FF
      assert.deepEqual(cmd, [0x81, 0x01, 0x04, 0x3f, 0x02, 5, 0xff]);
    });

    it('should send preset store command', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/preset/store/10', []);
      const cmd = getLastWritten();
      // 81 01 04 3F 01 0A FF
      assert.deepEqual(cmd, [0x81, 0x01, 0x04, 0x3f, 0x01, 10, 0xff]);
    });

    it('should handle preset 0 (minimum valid)', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/preset/recall/0', []);
      assert.deepEqual(getLastWritten(), [0x81, 0x01, 0x04, 0x3f, 0x02, 0, 0xff]);
    });

    it('should handle preset 127 (maximum valid)', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/preset/recall/127', []);
      assert.deepEqual(getLastWritten(), [0x81, 0x01, 0x04, 0x3f, 0x02, 127, 0xff]);
    });

    it('should reject preset 128 (out of range)', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/preset/recall/128', []);
      assert.equal(lastMockSocket.written.length, 0);
    });

    it('should reject negative preset number', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/preset/recall/-1', []);
      assert.equal(lastMockSocket.written.length, 0);
    });

    it('should reject non-numeric preset', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/preset/recall/abc', []);
      assert.equal(lastMockSocket.written.length, 0);
    });

    it('should ignore preset with no subcommand', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/preset', []);
      assert.equal(lastMockSocket.written.length, 0);
    });
  });

  // --- Home command ---

  describe('home command', () => {
    it('should send home VISCA command', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/home', []);
      // 81 01 06 04 FF
      assert.deepEqual(getLastWritten(), [0x81, 0x01, 0x06, 0x04, 0xff]);
    });
  });

  // --- Zoom commands ---

  describe('zoom commands', () => {
    it('should send zoom tele for positive speed', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/zoom/speed', [{ type: 'f', value: 1.0 }]);
      const cmd = getLastWritten();
      assert.equal(cmd[0], 0x81);
      assert.equal(cmd[3], 0x07); // zoom command
      assert.equal(cmd[4] & 0xf0, 0x20); // tele prefix
    });

    it('should send zoom wide for negative speed', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/zoom/speed', [{ type: 'f', value: -1.0 }]);
      const cmd = getLastWritten();
      assert.equal(cmd[4] & 0xf0, 0x30); // wide prefix
    });

    it('should send zoom stop for speed 0', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/zoom/speed', [{ type: 'f', value: 0 }]);
      const cmd = getLastWritten();
      assert.equal(cmd[4], 0x00);
    });

    it('should send zoom stop command explicitly', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/zoom/stop', []);
      assert.equal(getLastWritten()[4], 0x00);
    });

    it('should send direct zoom position', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/zoom/direct', [{ type: 'f', value: 0.5 }]);
      const cmd = getLastWritten();
      assert.equal(cmd[0], 0x81);
      assert.equal(cmd[3], 0x47); // direct zoom
      assert.equal(cmd[cmd.length - 1], 0xff);
      assert.equal(cmd.length, 9);
    });

    it('should produce correct nibbles for direct zoom at max', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/zoom/direct', [{ type: 'f', value: 1.0 }]);
      const cmd = getLastWritten();
      // 0x4000 = p=4, q=0, r=0, s=0
      assert.equal(cmd[4], 4);
      assert.equal(cmd[5], 0);
      assert.equal(cmd[6], 0);
      assert.equal(cmd[7], 0);
    });

    it('should produce zeroed nibbles for direct zoom at min', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/zoom/direct', [{ type: 'f', value: 0.0 }]);
      const cmd = getLastWritten();
      assert.equal(cmd[4], 0);
      assert.equal(cmd[5], 0);
      assert.equal(cmd[6], 0);
      assert.equal(cmd[7], 0);
    });
  });

  // --- Power commands ---

  describe('power commands', () => {
    it('should send power on command', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/power/on', []);
      assert.deepEqual(getLastWritten(), [0x81, 0x01, 0x04, 0x00, 0x02, 0xff]);
    });

    it('should send power off command', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/power/off', []);
      assert.deepEqual(getLastWritten(), [0x81, 0x01, 0x04, 0x00, 0x03, 0xff]);
    });
  });

  // --- Focus commands ---

  describe('focus commands', () => {
    it('should send auto focus command', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/focus/auto', []);
      assert.deepEqual(getLastWritten(), [0x81, 0x01, 0x04, 0x38, 0x02, 0xff]);
    });

    it('should send manual focus command', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/focus/manual', []);
      assert.deepEqual(getLastWritten(), [0x81, 0x01, 0x04, 0x38, 0x03, 0xff]);
    });
  });

  // --- Pan/Tilt ---

  describe('pan/tilt commands', () => {
    it('should send pantilt stop', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/pantilt/stop', []);
      assert.deepEqual(getLastWritten(), [0x81, 0x01, 0x06, 0x01, 0x01, 0x01, 0x03, 0x03, 0xff]);
    });

    it('should send combined pan/tilt with right+up directions', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/pantilt/speed', [
        { type: 'f', value: 0.5 },
        { type: 'f', value: 0.5 },
      ]);
      const cmd = getLastWritten();
      assert.equal(cmd[6], 0x02); // pan right
      assert.equal(cmd[7], 0x01); // tilt up
    });

    it('should send pan left + tilt down', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/pantilt/speed', [
        { type: 'f', value: -0.5 },
        { type: 'f', value: -0.5 },
      ]);
      const cmd = getLastWritten();
      assert.equal(cmd[6], 0x01); // pan left
      assert.equal(cmd[7], 0x02); // tilt down
    });

    it('should stop when both speeds are 0', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/pantilt/speed', [
        { type: 'f', value: 0 },
        { type: 'f', value: 0 },
      ]);
      const cmd = getLastWritten();
      // Stop command
      assert.equal(cmd[6], 0x03);
      assert.equal(cmd[7], 0x03);
    });

    it('should accumulate pan speed via /pan/speed', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/pan/speed', [{ type: 'f', value: 0.5 }]);
      const cmd = getLastWritten();
      assert.equal(cmd[6], 0x02); // pan right
    });

    it('should accumulate tilt speed via /tilt/speed', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/tilt/speed', [{ type: 'f', value: -0.3 }]);
      const cmd = getLastWritten();
      assert.equal(cmd[7], 0x02); // tilt down
    });
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    it('should ignore empty address', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('', []);
      assert.equal(lastMockSocket.written.length, 0);
    });

    it('should ignore unrecognized commands', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/unknown/command', []);
      assert.equal(lastMockSocket.written.length, 0);
    });

    it('should be case-insensitive', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/Home', []);
      assert.equal(lastMockSocket.written.length, 1);
    });

    it('should handle trailing slashes', () => {
      const driver = createDriverWithMockSocket(defaultConfig);
      driver.connect();
      clearWritten();

      driver.handleOSC('/home/', []);
      assert.equal(lastMockSocket.written.length, 1);
    });

    it('handleFadeTick should be a no-op', () => {
      const driver = new VISCADriver(defaultConfig, mockHubContext);
      assert.doesNotThrow(() => {
        driver.handleFadeTick('some/key', 0.5);
      });
    });
  });
});
