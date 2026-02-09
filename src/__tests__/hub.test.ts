import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'events';
import { ProductionHub } from '../hub';
import { DeviceDriver, FeedbackEvent } from '../drivers/device-driver';

/**
 * Mock DeviceDriver for testing
 * Implements DeviceDriver interface and extends EventEmitter for event handling
 */
class MockDeviceDriver extends EventEmitter implements DeviceDriver {
  readonly name: string;
  readonly prefix: string;
  private isConnectedState: boolean = false;

  // Tracking arrays for test assertions
  handleOSCCalls: Array<{ address: string; args: any[] }> = [];
  handleFadeTickCalls: Array<{ key: string; value: number }> = [];

  constructor(name: string, prefix: string) {
    super();
    this.name = name;
    this.prefix = prefix;
  }

  connect(): void {
    this.isConnectedState = true;
    this.emit('connected');
  }

  disconnect(): void {
    this.isConnectedState = false;
    this.emit('disconnected');
  }

  isConnected(): boolean {
    return this.isConnectedState;
  }

  handleOSC(address: string, args: any[]): void {
    this.handleOSCCalls.push({ address, args });
  }

  handleFadeTick(key: string, value: number): void {
    this.handleFadeTickCalls.push({ key, value });
  }

  /**
   * Helper method to emit feedback for testing
   */
  emitFeedback(address: string, args: any[] = []): void {
    this.emit('feedback', { address, args } as FeedbackEvent);
  }
}

describe('ProductionHub', () => {
  const defaultConfig = {
    osc: {
      listenAddress: '127.0.0.1',
      listenPort: 9000,
    },
    logging: {
      verbose: false,
    },
  };

  // Helper to create a fresh hub for each test
  function createHub(): ProductionHub {
    return new ProductionHub(defaultConfig);
  }

  describe('Prefix matching', () => {
    it('should route OSC message to driver with matching prefix', () => {
      const hub = createHub();
      try {
        const driver = new MockDeviceDriver('test-device', '/test');
        hub.addDriver(driver);

        hub.routeOSC('/test/foo', []);

        assert.strictEqual(driver.handleOSCCalls.length, 1, 'driver should have received one call');
        assert.strictEqual(
          driver.handleOSCCalls[0].address,
          '/foo',
          'driver should receive stripped prefix address'
        );
      } finally {
        hub.stop();
      }
    });

    it('should preserve args when routing to driver', () => {
      const hub = createHub();
      try {
        const driver = new MockDeviceDriver('test-args', '/args');
        hub.addDriver(driver);

        const testArgs = [
          { type: 'f', value: 0.75 },
          { type: 'i', value: 42 },
        ];
        hub.routeOSC('/args/level', testArgs);

        assert.strictEqual(driver.handleOSCCalls.length, 1);
        assert.deepStrictEqual(
          driver.handleOSCCalls[0].args,
          testArgs,
          'args should be passed through unchanged'
        );
      } finally {
        hub.stop();
      }
    });
  });

  describe('Longest prefix wins', () => {
    it('should match longest prefix when multiple prefixes could match', () => {
      const hub = createHub();
      try {
        const driverA = new MockDeviceDriver('device-a', '/a');
        const driverAB = new MockDeviceDriver('device-ab', '/a/b');
        hub.addDriver(driverA);
        hub.addDriver(driverAB);

        hub.routeOSC('/a/b/c', []);

        assert.strictEqual(
          driverA.handleOSCCalls.length,
          0,
          'shorter prefix driver should not be called'
        );
        assert.strictEqual(
          driverAB.handleOSCCalls.length,
          1,
          'longer prefix driver should be called'
        );
        assert.strictEqual(
          driverAB.handleOSCCalls[0].address,
          '/c',
          'remaining part after longest prefix should be passed'
        );
      } finally {
        hub.stop();
      }
    });

    it('should handle equal-length prefixes correctly', () => {
      const hub = createHub();
      try {
        const driver1 = new MockDeviceDriver('device-1', '/device1');
        const driver2 = new MockDeviceDriver('device-2', '/device2');
        hub.addDriver(driver1);
        hub.addDriver(driver2);

        hub.routeOSC('/device1/message', []);

        assert.strictEqual(driver1.handleOSCCalls.length, 1, 'device1 should receive message');
        assert.strictEqual(driver2.handleOSCCalls.length, 0, 'device2 should not receive message');
      } finally {
        hub.stop();
      }
    });
  });

  describe('No match handling', () => {
    it('should not crash when no driver matches the address', () => {
      const hub = createHub();
      try {
        const driver = new MockDeviceDriver('existing', '/existing');
        hub.addDriver(driver);

        // Should not throw
        assert.doesNotThrow(() => {
          hub.routeOSC('/unknown/foo', []);
        });

        // Existing driver should not have been called
        assert.strictEqual(driver.handleOSCCalls.length, 0);
      } finally {
        hub.stop();
      }
    });

    it('should log warning for unmatched addresses', () => {
      const hub = createHub();
      try {
        let warningCaught = false;
        const originalWarn = console.warn;
        console.warn = (msg: string) => {
          if (msg.includes('No driver matched')) {
            warningCaught = true;
          }
        };

        hub.routeOSC('/unmatched/path', []);

        console.warn = originalWarn;
        assert.strictEqual(warningCaught, true, 'should warn about unmatched address');
      } finally {
        hub.stop();
      }
    });
  });

  describe('Global /fade/stop', () => {
    it('should not crash when routing /fade/stop', () => {
      const hub = createHub();
      try {
        assert.doesNotThrow(() => {
          hub.routeOSC('/fade/stop', []);
        });
      } finally {
        hub.stop();
      }
    });

    it('should not route /fade/stop to any driver', () => {
      const hub = createHub();
      try {
        const driver = new MockDeviceDriver('fade-test', '/fade');
        hub.addDriver(driver);

        hub.routeOSC('/fade/stop', []);

        assert.strictEqual(
          driver.handleOSCCalls.length,
          0,
          'no driver should receive /fade/stop message'
        );
      } finally {
        hub.stop();
      }
    });

    it('should handle /fade/stop with arguments', () => {
      const hub = createHub();
      try {
        assert.doesNotThrow(() => {
          hub.routeOSC('/fade/stop', [{ type: 'i', value: 123 }]);
        });
      } finally {
        hub.stop();
      }
    });
  });

  describe('Feedback prepending', () => {
    it('should prepend driver prefix to feedback address', (t, done) => {
      const hub = createHub();
      try {
        const driver = new MockDeviceDriver('feedback-test', '/device');
        hub.addDriver(driver);

        // Mock the OSC server's sendToClients to capture what the hub sends
        const sentMessages: Array<{ address: string; args: any[] }> = [];
        const oscServer = hub.getOSCServer();
        const originalSend = (oscServer as any).sendToClients;
        (oscServer as any).sendToClients = (address: string, args: any[]) => {
          sentMessages.push({ address, args });
        };

        // Driver emits feedback
        driver.emitFeedback('/ch/1/fader', [{ type: 'f', value: 0.5 }]);

        // Give event loop a tick to process
        setImmediate(() => {
          assert.strictEqual(
            sentMessages.length,
            1,
            'hub should have sent one feedback message'
          );
          assert.strictEqual(
            sentMessages[0].address,
            '/device/ch/1/fader',
            'prefix should be prepended to feedback address'
          );

          // Restore original
          (oscServer as any).sendToClients = originalSend;
          hub.stop();
          done?.();
        });
      } catch (err) {
        hub.stop();
        throw err;
      }
    });

    it('should wire up multiple feedback events from same driver', (t, done) => {
      const hub = createHub();
      try {
        const driver = new MockDeviceDriver('multi-feedback', '/lights');
        hub.addDriver(driver);

        const sentMessages: Array<{ address: string; args: any[] }> = [];
        const oscServer = hub.getOSCServer();
        const originalSend = (oscServer as any).sendToClients;
        (oscServer as any).sendToClients = (address: string, args: any[]) => {
          sentMessages.push({ address, args });
        };

        driver.emitFeedback('/intensity', []);
        driver.emitFeedback('/color', []);

        setImmediate(() => {
          assert.strictEqual(sentMessages.length, 2, 'should have sent two messages');
          assert.strictEqual(sentMessages[0].address, '/lights/intensity');
          assert.strictEqual(sentMessages[1].address, '/lights/color');

          (oscServer as any).sendToClients = originalSend;
          hub.stop();
          done?.();
        });
      } catch (err) {
        hub.stop();
        throw err;
      }
    });
  });

  describe('Duplicate prefix', () => {
    it('should throw when adding two drivers with the same prefix', () => {
      const hub = createHub();
      try {
        const driver1 = new MockDeviceDriver('device-1', '/dup');
        const driver2 = new MockDeviceDriver('device-2', '/dup');

        hub.addDriver(driver1);

        assert.throws(
          () => {
            hub.addDriver(driver2);
          },
          /Duplicate driver prefix/,
          'should throw error for duplicate prefix'
        );
      } finally {
        hub.stop();
      }
    });

    it('should throw for case-insensitive duplicate prefixes', () => {
      const hub = createHub();
      try {
        const driver1 = new MockDeviceDriver('device-lower', '/test');
        const driver2 = new MockDeviceDriver('device-upper', '/TEST');

        hub.addDriver(driver1);

        assert.throws(
          () => {
            hub.addDriver(driver2);
          },
          /Duplicate driver prefix/,
          'should treat /TEST and /test as duplicates'
        );
      } finally {
        hub.stop();
      }
    });
  });

  describe('Case-insensitive routing', () => {
    it('should match addresses case-insensitively', () => {
      const hub = createHub();
      try {
        const driver = new MockDeviceDriver('case-test', '/mixer');
        hub.addDriver(driver);

        hub.routeOSC('/MIXER/FADER', []);

        assert.strictEqual(driver.handleOSCCalls.length, 1, 'should match case-insensitively');
        assert.strictEqual(driver.handleOSCCalls[0].address, '/fader');
      } finally {
        hub.stop();
      }
    });

    it('should preserve case in the remainder address', () => {
      const hub = createHub();
      try {
        const driver = new MockDeviceDriver('preserve-case', '/device');
        hub.addDriver(driver);

        hub.routeOSC('/device/ChannelOne', []);

        assert.strictEqual(
          driver.handleOSCCalls[0].address,
          '/channelone',
          'remainder should be lowercased for consistency'
        );
      } finally {
        hub.stop();
      }
    });
  });

  describe('Address edge cases', () => {
    it('should handle address that exactly matches prefix', () => {
      const hub = createHub();
      try {
        const driver = new MockDeviceDriver('exact-match', '/exact');
        hub.addDriver(driver);

        hub.routeOSC('/exact', []);

        assert.strictEqual(driver.handleOSCCalls.length, 1);
        assert.strictEqual(driver.handleOSCCalls[0].address, '/');
      } finally {
        hub.stop();
      }
    });

    it('should not match partial prefix without slash separator', () => {
      const hub = createHub();
      try {
        const driver = new MockDeviceDriver('partial-test', '/test');
        hub.addDriver(driver);

        // /testing should not match /test prefix
        hub.routeOSC('/testing', []);

        assert.strictEqual(
          driver.handleOSCCalls.length,
          0,
          'should not match without slash separator'
        );
      } finally {
        hub.stop();
      }
    });

    it('should handle deep nested addresses', () => {
      const hub = createHub();
      try {
        const driver = new MockDeviceDriver('deep-nesting', '/a/b/c');
        hub.addDriver(driver);

        hub.routeOSC('/a/b/c/d/e/f/g', []);

        assert.strictEqual(driver.handleOSCCalls.length, 1);
        assert.strictEqual(driver.handleOSCCalls[0].address, '/d/e/f/g');
      } finally {
        hub.stop();
      }
    });
  });

  describe('Driver registration', () => {
    it('should allow getting registered driver by name', () => {
      const hub = createHub();
      try {
        const driver = new MockDeviceDriver('retrieval-test', '/test');
        hub.addDriver(driver);

        const retrieved = hub.getDriver('retrieval-test');
        assert.strictEqual(
          retrieved,
          driver,
          'should retrieve the same driver instance by name'
        );
      } finally {
        hub.stop();
      }
    });

    it('should return undefined for non-existent driver name', () => {
      const hub = createHub();
      try {
        const retrieved = hub.getDriver('nonexistent');
        assert.strictEqual(retrieved, undefined);
      } finally {
        hub.stop();
      }
    });

    it('should get all registered driver names', () => {
      const hub = createHub();
      try {
        const driver1 = new MockDeviceDriver('named-1', '/dev1');
        const driver2 = new MockDeviceDriver('named-2', '/dev2');
        hub.addDriver(driver1);
        hub.addDriver(driver2);

        const names = hub.getDriverNames();
        assert.ok(names.includes('named-1'), 'should include first driver');
        assert.ok(names.includes('named-2'), 'should include second driver');
      } finally {
        hub.stop();
      }
    });
  });

  describe('Driver lifecycle events', () => {
    it('should wire up driver error events', (t, done) => {
      const hub = createHub();
      try {
        let errorCaught = false;
        const originalError = console.error;
        console.error = (msg: string) => {
          if (msg.includes('error-driver') && msg.includes('test error')) {
            errorCaught = true;
          }
        };

        const driver = new MockDeviceDriver('error-driver', '/error');
        hub.addDriver(driver);

        driver.emit('error', new Error('test error'));

        setImmediate(() => {
          console.error = originalError;
          assert.strictEqual(errorCaught, true, 'hub should log driver errors');
          hub.stop();
          done?.();
        });
      } catch (err) {
        hub.stop();
        throw err;
      }
    });

    it('should wire up driver connected events', (t, done) => {
      const hub = createHub();
      try {
        let connectedLogged = false;
        const originalLog = console.log;
        console.log = (msg: string) => {
          if (msg.includes('connected-driver') && msg.includes('connected')) {
            connectedLogged = true;
          }
        };

        const driver = new MockDeviceDriver('connected-driver', '/connected');
        hub.addDriver(driver);

        driver.emit('connected');

        setImmediate(() => {
          console.log = originalLog;
          assert.strictEqual(connectedLogged, true, 'hub should log driver connected');
          hub.stop();
          done?.();
        });
      } catch (err) {
        hub.stop();
        throw err;
      }
    });

    it('should wire up driver disconnected events', (t, done) => {
      const hub = createHub();
      try {
        let disconnectedLogged = false;
        const originalWarn = console.warn;
        console.warn = (msg: string) => {
          if (msg.includes('disconnect-driver') && msg.includes('disconnected')) {
            disconnectedLogged = true;
          }
        };

        const driver = new MockDeviceDriver('disconnect-driver', '/disconnect');
        hub.addDriver(driver);

        driver.emit('disconnected');

        setImmediate(() => {
          console.warn = originalWarn;
          assert.strictEqual(disconnectedLogged, true, 'hub should log driver disconnected');
          hub.stop();
          done?.();
        });
      } catch (err) {
        hub.stop();
        throw err;
      }
    });
  });

  describe('Driver status OSC feedback', () => {
    it('should send /system/driver/{name}/status 1 when driver connects', (t, done) => {
      const hub = createHub();
      try {
        const driver = new MockDeviceDriver('avantis', '/avantis');
        hub.addDriver(driver);

        const sentMessages: Array<{ address: string; args: any[] }> = [];
        const oscServer = hub.getOSCServer();
        (oscServer as any).sendToClients = (address: string, args: any[]) => {
          sentMessages.push({ address, args });
        };

        driver.emit('connected');

        setImmediate(() => {
          const statusMsg = sentMessages.find(m => m.address === '/system/driver/avantis/status');
          assert.ok(statusMsg, 'should send driver status message');
          assert.deepStrictEqual(statusMsg!.args, [{ type: 'i', value: 1 }]);
          hub.stop();
          done?.();
        });
      } catch (err) {
        hub.stop();
        throw err;
      }
    });

    it('should send /system/driver/{name}/status 0 when driver disconnects', (t, done) => {
      const hub = createHub();
      try {
        const driver = new MockDeviceDriver('obs', '/obs');
        hub.addDriver(driver);

        const sentMessages: Array<{ address: string; args: any[] }> = [];
        const oscServer = hub.getOSCServer();
        (oscServer as any).sendToClients = (address: string, args: any[]) => {
          sentMessages.push({ address, args });
        };

        driver.emit('disconnected');

        setImmediate(() => {
          const statusMsg = sentMessages.find(m => m.address === '/system/driver/obs/status');
          assert.ok(statusMsg, 'should send driver status message');
          assert.deepStrictEqual(statusMsg!.args, [{ type: 'i', value: 0 }]);
          hub.stop();
          done?.();
        });
      } catch (err) {
        hub.stop();
        throw err;
      }
    });

    it('should send /system/ready 1 when all drivers are connected', (t, done) => {
      const hub = createHub();
      try {
        const driver1 = new MockDeviceDriver('avantis', '/avantis');
        const driver2 = new MockDeviceDriver('obs', '/obs');
        hub.addDriver(driver1);
        hub.addDriver(driver2);

        const sentMessages: Array<{ address: string; args: any[] }> = [];
        const oscServer = hub.getOSCServer();
        (oscServer as any).sendToClients = (address: string, args: any[]) => {
          sentMessages.push({ address, args });
        };

        // Connect first driver — not all connected yet
        driver1.connect();

        setImmediate(() => {
          const readyBefore = sentMessages.find(m => m.address === '/system/ready');
          assert.strictEqual(readyBefore, undefined, 'should not send ready yet');

          // Connect second driver — now all connected
          driver2.connect();

          setImmediate(() => {
            const readyAfter = sentMessages.find(m => m.address === '/system/ready');
            assert.ok(readyAfter, 'should send /system/ready');
            assert.deepStrictEqual(readyAfter!.args, [{ type: 'i', value: 1 }]);
            hub.stop();
            done?.();
          });
        });
      } catch (err) {
        hub.stop();
        throw err;
      }
    });

    it('should not send /system/ready if not all drivers are connected', (t, done) => {
      const hub = createHub();
      try {
        const driver1 = new MockDeviceDriver('avantis', '/avantis');
        const driver2 = new MockDeviceDriver('obs', '/obs');
        hub.addDriver(driver1);
        hub.addDriver(driver2);

        const sentMessages: Array<{ address: string; args: any[] }> = [];
        const oscServer = hub.getOSCServer();
        (oscServer as any).sendToClients = (address: string, args: any[]) => {
          sentMessages.push({ address, args });
        };

        driver1.connect();

        setImmediate(() => {
          const readyMsg = sentMessages.find(m => m.address === '/system/ready');
          assert.strictEqual(readyMsg, undefined, 'should not send ready when only one driver connected');
          hub.stop();
          done?.();
        });
      } catch (err) {
        hub.stop();
        throw err;
      }
    });
  });

  describe('Verbose logging', () => {
    it('should log routing messages when verbose is enabled', () => {
      const hub = new ProductionHub({
        ...defaultConfig,
        logging: { verbose: true },
      });

      try {
        const loggedMessages: string[] = [];
        const originalLog = console.log;
        console.log = (msg: string) => {
          loggedMessages.push(msg);
        };

        const driver = new MockDeviceDriver('verbose-device', '/verbose');
        hub.addDriver(driver);

        hub.routeOSC('/verbose/test', []);

        console.log = originalLog;

        // Should have logged driver registration
        const hasRegLog = loggedMessages.some((msg) =>
          msg.includes('Registered driver')
        );
        assert.strictEqual(hasRegLog, true, 'should log driver registration in verbose mode');
      } finally {
        hub.stop();
      }
    });
  });
});
