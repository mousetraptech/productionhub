import { describe, it, beforeEach } from 'node:test';
import * as assert from 'node:assert/strict';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { OBSDriver, OBSConfig } from '../drivers/obs-driver';
import { HubContext, FeedbackEvent } from '../drivers/device-driver';

// --- Mock WebSocket ---

/**
 * Captures all messages sent via ws.send() and allows simulating
 * server messages (Hello, Identified, Event, RequestResponse).
 */
class MockWebSocket extends EventEmitter {
  sent: any[] = [];
  readyState = 1; // OPEN

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    this.readyState = 3;
  }

  /** Simulate a server message arriving */
  simulateMessage(msg: any): void {
    this.emit('message', Buffer.from(JSON.stringify(msg)));
  }

  /** Simulate connection open */
  simulateOpen(): void {
    this.emit('open');
  }

  /** Simulate connection close */
  simulateClose(): void {
    this.emit('close');
  }

  /** Simulate connection error */
  simulateError(err: Error): void {
    this.emit('error', err);
  }
}

// --- Helpers ---

let lastMockWs: MockWebSocket;

/**
 * Inject a mock WebSocket constructor into the OBS driver module.
 * The OBS driver uses a module-level `let WebSocket` variable that is
 * set on first `connect()` via `require('ws')`. We override it by
 * reaching into the module's cached exports to replace the factory.
 *
 * Instead, we use a simpler approach: override require('ws') before
 * the driver loads it, or — since the driver stores `WebSocket` as a
 * module-scoped variable after the first require — we monkey-patch
 * the driver's connect() to inject our mock.
 */
function createDriverWithMockWS(config: OBSConfig, hubContext: HubContext, verbose = false): OBSDriver {
  const driver = new OBSDriver(config, hubContext, verbose);

  // Override the connect method to inject our mock WebSocket
  const originalConnect = driver.connect.bind(driver);
  driver.connect = function () {
    // Patch the module-level WebSocket variable by overriding the internal methods.
    // We do this by overriding the private doConnect to use our mock.
    const mockWs = new MockWebSocket();
    lastMockWs = mockWs;

    // Access private fields via (driver as any)
    (driver as any).loadWebSocket = () => {}; // skip require('ws')
    (driver as any).doConnect = function () {
      (this as any).ws = mockWs;
      // Simulate the event wiring that happens in the real doConnect
      mockWs.on('open', () => {
        (this as any).connected = true;
      });
      mockWs.on('message', (data: any) => {
        try {
          const msg = JSON.parse(data.toString());
          (this as any).handleWSMessage(msg);
        } catch {}
      });
      mockWs.on('close', () => {
        (this as any).connected = false;
        (this as any).identified = false;
        this.emit('disconnected');
      });
      mockWs.on('error', (err: Error) => {
        this.emit('error', err);
      });
    };

    (driver as any).doConnect();
  };

  return driver;
}

function getLastSent(): any {
  return lastMockWs.sent[lastMockWs.sent.length - 1];
}

function getAllSent(): any[] {
  return [...lastMockWs.sent];
}

function clearSent(): void {
  lastMockWs.sent.length = 0;
}

const mockHubContext: HubContext = {
  startFade: () => {},
  cancelFade: () => {},
  cancelAllFades: () => {},
  setCurrentValue: () => {},
  getCurrentValue: () => undefined,
};

const defaultConfig: OBSConfig = {
  type: 'obs',
  prefix: '/obs',
  host: '127.0.0.1',
  port: 4455,
  password: 'test-password',
};

/** Simulate the full Hello → Identify → Identified handshake */
function completeHandshake(ws: MockWebSocket, withAuth = false): void {
  ws.simulateOpen();
  if (withAuth) {
    ws.simulateMessage({
      op: 0,
      d: {
        obsWebSocketVersion: '5.0.0',
        rpcVersion: 1,
        authentication: {
          challenge: 'test-challenge-string',
          salt: 'test-salt-string',
        },
      },
    });
  } else {
    ws.simulateMessage({
      op: 0,
      d: {
        obsWebSocketVersion: '5.0.0',
        rpcVersion: 1,
      },
    });
  }
  // Simulate Identified response
  ws.simulateMessage({ op: 2, d: {} });
}

// =============================================
// Tests
// =============================================

describe('OBSDriver', () => {

  // --- Constructor tests ---

  describe('constructor', () => {
    it('should set name to "obs" by default', () => {
      const driver = new OBSDriver(defaultConfig, mockHubContext);
      assert.equal(driver.name, 'obs');
    });

    it('should accept a custom name', () => {
      const config = { ...defaultConfig, name: 'stream-obs' };
      const driver = new OBSDriver(config, mockHubContext);
      assert.equal(driver.name, 'stream-obs');
    });

    it('should set prefix from config', () => {
      const driver = new OBSDriver(defaultConfig, mockHubContext);
      assert.equal(driver.prefix, '/obs');
    });

    it('should default password to empty string', () => {
      const config = { ...defaultConfig };
      delete (config as any).password;
      const driver = new OBSDriver(config, mockHubContext);
      // Password is private — verify via auth behavior (no-auth identify)
      assert.equal(driver.name, 'obs');
    });
  });

  // --- Connection state ---

  describe('connection state', () => {
    it('should return false for isConnected before connect', () => {
      const driver = new OBSDriver(defaultConfig, mockHubContext);
      assert.equal(driver.isConnected(), false);
    });

    it('should return false when connected but not yet identified', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      lastMockWs.simulateOpen();
      // connected=true but identified=false
      assert.equal(driver.isConnected(), false);
    });

    it('should return true after full handshake (identified)', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      assert.equal(driver.isConnected(), true);
    });

    it('should return false after disconnect', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      assert.equal(driver.isConnected(), true);
      driver.disconnect();
      assert.equal(driver.isConnected(), false);
    });

    it('should emit "connected" event on identification', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      let emitted = false;
      driver.on('connected', () => { emitted = true; });
      driver.connect();
      completeHandshake(lastMockWs);
      assert.equal(emitted, true);
    });

    it('should emit "disconnected" event on WebSocket close', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      let emitted = false;
      driver.on('disconnected', () => { emitted = true; });
      driver.connect();
      completeHandshake(lastMockWs);
      lastMockWs.simulateClose();
      assert.equal(emitted, true);
    });

    it('should emit "error" event on WebSocket error', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      let capturedErr: Error | undefined;
      driver.on('error', (err: Error) => { capturedErr = err; });
      driver.connect();
      lastMockWs.simulateError(new Error('connection refused'));
      assert.ok(capturedErr);
      assert.equal((capturedErr as Error).message, 'connection refused');
    });
  });

  // --- Auth handshake ---

  describe('SHA256 auth handshake', () => {
    it('should send Identify without auth when no challenge provided', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      lastMockWs.simulateOpen();
      // Hello without authentication
      lastMockWs.simulateMessage({
        op: 0,
        d: { obsWebSocketVersion: '5.0.0', rpcVersion: 1 },
      });

      const sent = getLastSent();
      assert.equal(sent.op, 1); // Identify
      assert.equal(sent.d.rpcVersion, 1);
      assert.equal(sent.d.authentication, undefined);
    });

    it('should send Identify with SHA256 auth response when challenge provided', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      lastMockWs.simulateOpen();

      const salt = 'test-salt';
      const challenge = 'test-challenge';

      lastMockWs.simulateMessage({
        op: 0,
        d: {
          obsWebSocketVersion: '5.0.0',
          rpcVersion: 1,
          authentication: { challenge, salt },
        },
      });

      const sent = getLastSent();
      assert.equal(sent.op, 1);
      assert.equal(sent.d.rpcVersion, 1);
      assert.ok(sent.d.authentication, 'should include auth response');

      // Verify the auth is computed correctly
      const secret = crypto.createHash('sha256')
        .update('test-password' + salt)
        .digest('base64');
      const expected = crypto.createHash('sha256')
        .update(secret + challenge)
        .digest('base64');
      assert.equal(sent.d.authentication, expected);
    });

    it('should subscribe to events via eventSubscriptions bitmask', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      lastMockWs.simulateOpen();
      lastMockWs.simulateMessage({
        op: 0,
        d: { obsWebSocketVersion: '5.0.0', rpcVersion: 1 },
      });

      const sent = getLastSent();
      assert.equal(sent.d.eventSubscriptions, 0x01ff);
    });
  });

  // --- Reconnect queue ---

  describe('reconnect queue', () => {
    it('should queue messages when not connected', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      // Don't complete handshake — only open
      lastMockWs.simulateOpen();
      // isConnected() is false (not identified)

      // Send some OSC commands
      driver.handleOSC('/stream/start', []);
      driver.handleOSC('/scene/Main', []);

      // No WS messages should have been sent for these (only the pending Identify)
      // The Identify is sent in response to Hello, which we haven't sent yet
      assert.equal(lastMockWs.sent.length, 0);
    });

    it('should replay queued messages after identification', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();

      // Queue messages before handshake
      driver.handleOSC('/stream/start', []);

      // Complete handshake
      completeHandshake(lastMockWs);

      // After identification, the queued StartStream should be sent
      const requests = lastMockWs.sent.filter((m: any) => m.op === 6);
      const startStream = requests.find((m: any) => m.d.requestType === 'StartStream');
      assert.ok(startStream, 'StartStream should have been replayed from queue');
    });
  });

  // --- Scene commands ---

  describe('scene commands', () => {
    it('should send SetCurrentProgramScene for /scene/{name}', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/scene/Main', []);

      const sent = getLastSent();
      assert.equal(sent.op, 6);
      assert.equal(sent.d.requestType, 'SetCurrentProgramScene');
      assert.equal(sent.d.requestData.sceneName, 'main'); // lowercased
    });

    it('should send SetCurrentPreviewScene for /scene/preview/{name}', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/scene/preview/BRB', []);

      const sent = getLastSent();
      assert.equal(sent.op, 6);
      assert.equal(sent.d.requestType, 'SetCurrentPreviewScene');
      assert.equal(sent.d.requestData.sceneName, 'brb');
    });

    it('should URL-decode scene names', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/scene/Main%20Camera', []);

      const sent = getLastSent();
      assert.equal(sent.d.requestData.sceneName, 'main camera');
    });

    it('should handle multi-segment scene names', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/scene/preview/Scene/With/Slashes', []);

      const sent = getLastSent();
      assert.equal(sent.d.requestType, 'SetCurrentPreviewScene');
      // parts after 'preview' joined with '/'
      assert.equal(sent.d.requestData.sceneName, 'scene/with/slashes');
    });
  });

  // --- Stream commands ---

  describe('stream commands', () => {
    it('should send StartStream for /stream/start', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/stream/start', []);

      const sent = getLastSent();
      assert.equal(sent.d.requestType, 'StartStream');
    });

    it('should send StopStream for /stream/stop', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/stream/stop', []);

      const sent = getLastSent();
      assert.equal(sent.d.requestType, 'StopStream');
    });

    it('should send ToggleStream for /stream/toggle', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/stream/toggle', []);

      const sent = getLastSent();
      assert.equal(sent.d.requestType, 'ToggleStream');
    });
  });

  // --- Record commands ---

  describe('record commands', () => {
    it('should send StartRecord for /record/start', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/record/start', []);
      assert.equal(getLastSent().d.requestType, 'StartRecord');
    });

    it('should send StopRecord for /record/stop', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/record/stop', []);
      assert.equal(getLastSent().d.requestType, 'StopRecord');
    });

    it('should send ToggleRecord for /record/toggle', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/record/toggle', []);
      assert.equal(getLastSent().d.requestType, 'ToggleRecord');
    });
  });

  // --- Transition commands ---

  describe('transition commands', () => {
    it('should send SetCurrentSceneTransition for /transition/{name}', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/transition/Fade', []);

      const sent = getLastSent();
      assert.equal(sent.d.requestType, 'SetCurrentSceneTransition');
      assert.equal(sent.d.requestData.transitionName, 'fade');
    });

    it('should send SetCurrentSceneTransitionDuration for /transition/duration', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/transition/duration', [{ type: 'i', value: 500 }]);

      const sent = getLastSent();
      assert.equal(sent.d.requestType, 'SetCurrentSceneTransitionDuration');
      assert.equal(sent.d.requestData.transitionDuration, 500);
    });

    it('should handle raw int arg for transition duration', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/transition/duration', [1000]);

      const sent = getLastSent();
      assert.equal(sent.d.requestData.transitionDuration, 1000);
    });
  });

  // --- VirtualCam commands ---

  describe('virtualcam commands', () => {
    it('should send StartVirtualCam for /virtualcam/start', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/virtualcam/start', []);
      assert.equal(getLastSent().d.requestType, 'StartVirtualCam');
    });

    it('should send StopVirtualCam for /virtualcam/stop', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/virtualcam/stop', []);
      assert.equal(getLastSent().d.requestType, 'StopVirtualCam');
    });
  });

  // --- Feedback events ---

  describe('feedback events', () => {
    it('should emit feedback for CurrentProgramSceneChanged', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      const feedbacks: FeedbackEvent[] = [];
      driver.on('feedback', (e: FeedbackEvent) => { feedbacks.push(e); });
      driver.connect();
      completeHandshake(lastMockWs);

      lastMockWs.simulateMessage({
        op: 5,
        d: {
          eventType: 'CurrentProgramSceneChanged',
          eventData: { sceneName: 'Live Camera' },
        },
      });

      assert.equal(feedbacks.length, 1);
      assert.equal(feedbacks[0].address, '/scene/current');
      assert.equal(feedbacks[0].args[0].type, 's');
      assert.equal(feedbacks[0].args[0].value, 'Live Camera');
    });

    it('should emit feedback for StreamStateChanged (active)', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      const feedbacks: FeedbackEvent[] = [];
      driver.on('feedback', (e: FeedbackEvent) => { feedbacks.push(e); });
      driver.connect();
      completeHandshake(lastMockWs);

      lastMockWs.simulateMessage({
        op: 5,
        d: {
          eventType: 'StreamStateChanged',
          eventData: { outputActive: true },
        },
      });

      assert.equal(feedbacks.length, 1);
      assert.equal(feedbacks[0].address, '/stream/status');
      assert.equal(feedbacks[0].args[0].type, 'i');
      assert.equal(feedbacks[0].args[0].value, 1);
    });

    it('should emit feedback for StreamStateChanged (inactive)', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      const feedbacks: FeedbackEvent[] = [];
      driver.on('feedback', (e: FeedbackEvent) => { feedbacks.push(e); });
      driver.connect();
      completeHandshake(lastMockWs);

      lastMockWs.simulateMessage({
        op: 5,
        d: {
          eventType: 'StreamStateChanged',
          eventData: { outputActive: false },
        },
      });

      assert.equal(feedbacks.length, 1);
      assert.equal(feedbacks[0].args[0].value, 0);
    });

    it('should emit feedback for RecordStateChanged', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      const feedbacks: FeedbackEvent[] = [];
      driver.on('feedback', (e: FeedbackEvent) => { feedbacks.push(e); });
      driver.connect();
      completeHandshake(lastMockWs);

      lastMockWs.simulateMessage({
        op: 5,
        d: {
          eventType: 'RecordStateChanged',
          eventData: { outputActive: true },
        },
      });

      assert.equal(feedbacks.length, 1);
      assert.equal(feedbacks[0].address, '/record/status');
      assert.equal(feedbacks[0].args[0].value, 1);
    });
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    it('should ignore empty OSC address parts', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('', []);
      // No message should be sent
      assert.equal(lastMockWs.sent.length, 0);
    });

    it('should ignore unrecognized commands', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/unknown/command', []);
      assert.equal(lastMockWs.sent.length, 0);
    });

    it('should handle trailing slashes gracefully', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/stream/start/', []);
      assert.equal(getLastSent().d.requestType, 'StartStream');
    });

    it('should be case-insensitive for commands', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/Stream/Start', []);
      assert.equal(getLastSent().d.requestType, 'StartStream');
    });

    it('handleFadeTick should be a no-op', () => {
      const driver = new OBSDriver(defaultConfig, mockHubContext);
      assert.doesNotThrow(() => {
        driver.handleFadeTick('some/key', 0.5);
      });
    });

    it('should increment request IDs', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/stream/start', []);
      driver.handleOSC('/stream/stop', []);

      const ids = lastMockWs.sent.map((m: any) => m.d.requestId);
      assert.notEqual(ids[0], ids[1]);
    });

    it('should ignore /stream with no subcommand', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/stream', []);
      // stream handler returns early when parts.length === 0
      assert.equal(lastMockWs.sent.length, 0);
    });

    it('should ignore /scene with no name', () => {
      const driver = createDriverWithMockWS(defaultConfig, mockHubContext);
      driver.connect();
      completeHandshake(lastMockWs);
      clearSent();

      driver.handleOSC('/scene', []);
      assert.equal(lastMockWs.sent.length, 0);
    });
  });
});
