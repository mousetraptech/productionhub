import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { HubContext, FeedbackEvent } from '../drivers/device-driver';
import {
  DeviceEmulator,
  AvantisEmulator,
  OBSEmulator,
  VISCAEmulator,
  ChamSysEmulator,
  TouchDesignerEmulator,
  createEmulator,
} from '../emulators';

// --- Shared helpers ---

function stubHubContext(overrides?: Partial<HubContext>): HubContext {
  return {
    startFade: overrides?.startFade ?? (() => {}),
    cancelFade: overrides?.cancelFade ?? (() => {}),
    cancelAllFades: overrides?.cancelAllFades ?? (() => {}),
    setCurrentValue: overrides?.setCurrentValue ?? (() => {}),
    getCurrentValue: overrides?.getCurrentValue ?? (() => undefined),
  };
}

function collectFeedback(emulator: DeviceEmulator): FeedbackEvent[] {
  const events: FeedbackEvent[] = [];
  emulator.on('feedback', (event: FeedbackEvent) => events.push(event));
  return events;
}

// =========================================================================
// DeviceEmulator base class
// =========================================================================

describe('DeviceEmulator base', () => {
  it('connect() emits connected and isConnected returns true', () => {
    const emu = new AvantisEmulator(
      { type: 'avantis', prefix: '/avantis', host: '127.0.0.1', port: 51325 },
      stubHubContext(),
      false,
    );
    let connected = false;
    emu.on('connected', () => { connected = true; });

    emu.connect();

    assert.equal(emu.isConnected(), true);
    assert.equal(connected, true);
  });

  it('disconnect() emits disconnected and isConnected returns false', () => {
    const emu = new AvantisEmulator(
      { type: 'avantis', prefix: '/avantis', host: '127.0.0.1', port: 51325 },
      stubHubContext(),
      false,
    );
    emu.connect();

    let disconnected = false;
    emu.on('disconnected', () => { disconnected = true; });

    emu.disconnect();

    assert.equal(emu.isConnected(), false);
    assert.equal(disconnected, true);
  });

  it('log ring buffer caps at 200 entries', () => {
    const emu = new AvantisEmulator(
      { type: 'avantis', prefix: '/avantis', host: '127.0.0.1', port: 51325 },
      stubHubContext(),
      false,
    );
    emu.connect();

    // Generate 210 log entries via OSC commands
    for (let i = 0; i < 210; i++) {
      emu.handleOSC(`/ch/${(i % 64) + 1}/mix/fader`, [{ type: 'f', value: 0.5 }]);
    }

    const log = emu.getLog();
    assert.ok(log.length <= 200, `Expected <= 200 log entries, got ${log.length}`);
  });
});

// =========================================================================
// AvantisEmulator
// =========================================================================

describe('AvantisEmulator', () => {
  let emu: AvantisEmulator;
  let feedback: FeedbackEvent[];
  let ctx: HubContext;

  beforeEach(() => {
    ctx = stubHubContext();
    emu = new AvantisEmulator(
      { type: 'avantis', prefix: '/avantis', host: '127.0.0.1', port: 51325 },
      ctx,
      false,
    );
    feedback = collectFeedback(emu);
    emu.connect();
  });

  it('fader set updates state and emits feedback', () => {
    emu.handleOSC('/ch/1/mix/fader', [{ type: 'f', value: 0.75 }]);

    assert.equal(feedback.length, 1);
    assert.equal(feedback[0].address, '/ch/1/mix/fader');
    assert.equal(feedback[0].args[0].type, 'f');
    assert.equal(feedback[0].args[0].value, 0.75);

    const state = emu.getState();
    assert.equal(state.strips['ch/1']?.fader, 0.75);
  });

  it('mute on/off updates state and emits feedback', () => {
    emu.handleOSC('/ch/2/mix/mute', [{ type: 'i', value: 1 }]);

    assert.equal(feedback.length, 1);
    assert.equal(feedback[0].address, '/ch/2/mix/mute');
    assert.equal(feedback[0].args[0].value, 1);

    let state = emu.getState();
    assert.equal(state.strips['ch/2']?.mute, true);

    emu.handleOSC('/ch/2/mix/mute', [{ type: 'i', value: 0 }]);

    // After unmute, strip is back to all defaults so it's filtered from state
    // Verify via feedback instead
    assert.equal(feedback.length, 2);
    assert.equal(feedback[1].address, '/ch/2/mix/mute');
    assert.equal(feedback[1].args[0].value, 0);
  });

  it('pan updates state', () => {
    emu.handleOSC('/ch/3/mix/pan', [{ type: 'f', value: 0.25 }]);

    const state = emu.getState();
    assert.equal(state.strips['ch/3']?.pan, 0.25);
  });

  it('scene recall resets all strips to defaults', () => {
    // Set some strip state
    emu.handleOSC('/ch/1/mix/fader', [0.8]);
    emu.handleOSC('/ch/1/mix/mute', [1]);

    let state = emu.getState();
    assert.equal(state.strips['ch/1']?.fader, 0.8);
    assert.equal(state.strips['ch/1']?.mute, true);

    // Recall scene
    feedback.length = 0;
    emu.handleOSC('/scene/recall', [42]);

    state = emu.getState();
    assert.equal(state.currentScene, 42);
    // ch/1 should be back to defaults (won't appear in state since defaults are filtered)
    assert.equal(state.strips['ch/1'], undefined);

    // Scene recall emits feedback
    assert.ok(feedback.some(f => f.address === '/scene/current'));
  });

  it('all strip types are addressable', () => {
    const cases = [
      ['/ch/1/mix/fader', 'ch/1'],
      ['/mix/3/mix/fader', 'mix/3'],
      ['/fxsend/2/mix/fader', 'fxsend/2'],
      ['/fxrtn/4/mix/fader', 'fxrtn/4'],
      ['/dca/8/fader', 'dca/8'],
      ['/grp/5/mix/fader', 'grp/5'],
      ['/mtx/2/mix/fader', 'mtx/2'],
      ['/main/mix/fader', 'main'],
    ];

    for (const [address, stripKey] of cases) {
      emu.handleOSC(address, [0.6]);
      const state = emu.getState();
      assert.ok(state.strips[stripKey], `Strip ${stripKey} should exist after ${address}`);
      assert.equal(state.strips[stripKey].fader, 0.6, `${stripKey} fader should be 0.6`);
    }
  });

  it('fade request calls hubContext.startFade', () => {
    let fadeReq: any = null;
    const ctx = stubHubContext({
      startFade: (req) => { fadeReq = req; },
    });
    const emu2 = new AvantisEmulator(
      { type: 'avantis', prefix: '/avantis', host: '127.0.0.1', port: 51325 },
      ctx,
      false,
    );

    emu2.handleOSC('/ch/1/mix/fade', [1.0, 2.0, 'linear']);

    assert.ok(fadeReq, 'startFade should have been called');
    assert.equal(fadeReq.endValue, 1.0);
    assert.equal(fadeReq.durationMs, 2000);
    assert.equal(fadeReq.easing, 'linear');
    assert.ok(fadeReq.key.startsWith('avantis:'));
  });

  it('handleFadeTick updates strip state and emits feedback', () => {
    emu.handleFadeTick('input/1/fader', 0.42);

    const state = emu.getState();
    assert.equal(state.strips['ch/1']?.fader, 0.42);

    assert.ok(feedback.some(f =>
      f.address === '/ch/1/mix/fader' && f.args[0].value === 0.42
    ));
  });

  it('DCA short form fader and mute work', () => {
    emu.handleOSC('/dca/5/fader', [0.9]);
    let state = emu.getState();
    assert.equal(state.strips['dca/5']?.fader, 0.9);

    emu.handleOSC('/dca/5/mute', [1]);
    state = emu.getState();
    assert.equal(state.strips['dca/5']?.mute, true);
  });

  it('unknown address does not crash', () => {
    assert.doesNotThrow(() => {
      emu.handleOSC('/something/unknown', [1, 2, 3]);
    });
  });
});

// =========================================================================
// OBSEmulator
// =========================================================================

describe('OBSEmulator', () => {
  let emu: OBSEmulator;
  let feedback: FeedbackEvent[];

  beforeEach(() => {
    emu = new OBSEmulator(
      { type: 'obs', prefix: '/obs', host: '127.0.0.1', port: 4455 },
      stubHubContext(),
      false,
    );
    feedback = collectFeedback(emu);
    emu.connect();
  });

  it('scene switch updates state and emits feedback', () => {
    emu.handleOSC('/scene/Camera1', []);

    const state = emu.getState();
    assert.equal(state.currentScene, 'camera1');  // lowercase from addr parsing

    assert.equal(feedback.length, 1);
    assert.equal(feedback[0].address, '/scene/current');
  });

  it('preview scene updates state', () => {
    emu.handleOSC('/scene/preview/MyPreview', []);

    const state = emu.getState();
    assert.equal(state.previewScene, 'mypreview');
  });

  it('stream start/stop/toggle', () => {
    emu.handleOSC('/stream/start', []);
    assert.equal(emu.getState().streaming, true);
    assert.ok(feedback.some(f => f.address === '/stream/status' && f.args[0].value === 1));

    emu.handleOSC('/stream/stop', []);
    assert.equal(emu.getState().streaming, false);

    emu.handleOSC('/stream/toggle', []);
    assert.equal(emu.getState().streaming, true);
  });

  it('record start/stop/toggle', () => {
    emu.handleOSC('/record/start', []);
    assert.equal(emu.getState().recording, true);
    assert.ok(feedback.some(f => f.address === '/record/status' && f.args[0].value === 1));

    emu.handleOSC('/record/stop', []);
    assert.equal(emu.getState().recording, false);

    emu.handleOSC('/record/toggle', []);
    assert.equal(emu.getState().recording, true);
  });

  it('transition set updates state', () => {
    emu.handleOSC('/transition/Fade', []);
    assert.equal(emu.getState().currentTransition, 'fade');

    emu.handleOSC('/transition/duration', [{ type: 'i', value: 500 }]);
    assert.equal(emu.getState().transitionDuration, 500);
  });

  it('virtualcam start/stop', () => {
    emu.handleOSC('/virtualcam/start', []);
    assert.equal(emu.getState().virtualCam, true);

    emu.handleOSC('/virtualcam/stop', []);
    assert.equal(emu.getState().virtualCam, false);
  });

  it('source visibility', () => {
    emu.handleOSC('/source/MyWebcam/visible', [{ type: 'i', value: 0 }]);
    const state = emu.getState();
    assert.equal(state.sources?.['mywebcam'], false);
  });
});

// =========================================================================
// VISCAEmulator
// =========================================================================

describe('VISCAEmulator', () => {
  let emu: VISCAEmulator;
  let feedback: FeedbackEvent[];

  beforeEach(() => {
    emu = new VISCAEmulator(
      { type: 'visca', prefix: '/cam1', host: '192.168.1.50', port: 5678 },
      stubHubContext(),
      false,
    );
    feedback = collectFeedback(emu);
    emu.connect();
  });

  it('preset recall updates state, no feedback emitted', () => {
    emu.handleOSC('/preset/recall/3', []);

    assert.equal(emu.getState().currentPreset, 3);
    assert.equal(feedback.length, 0);
  });

  it('preset store', () => {
    emu.handleOSC('/preset/store/5', []);
    assert.ok(emu.getState().storedPresets.includes(5));
  });

  it('home resets preset to 0', () => {
    emu.handleOSC('/preset/recall/10', []);
    emu.handleOSC('/home', []);
    assert.equal(emu.getState().currentPreset, 0);
  });

  it('pan/tilt/zoom speed', () => {
    emu.handleOSC('/pan/speed', [0.5]);
    assert.equal(emu.getState().panSpeed, 0.5);

    emu.handleOSC('/tilt/speed', [-0.3]);
    assert.equal(emu.getState().tiltSpeed, -0.3);

    emu.handleOSC('/zoom/speed', [0.8]);
    assert.equal(emu.getState().zoomSpeed, 0.8);
  });

  it('pantilt stop zeroes speeds', () => {
    emu.handleOSC('/pan/speed', [0.5]);
    emu.handleOSC('/tilt/speed', [0.5]);
    emu.handleOSC('/pantilt/stop', []);

    assert.equal(emu.getState().panSpeed, 0);
    assert.equal(emu.getState().tiltSpeed, 0);
  });

  it('pantilt speed sets both pan and tilt', () => {
    emu.handleOSC('/pantilt/speed', [0.4, -0.6]);

    assert.equal(emu.getState().panSpeed, 0.4);
    assert.equal(emu.getState().tiltSpeed, -0.6);
  });

  it('zoom direct', () => {
    emu.handleOSC('/zoom/direct', [0.75]);
    assert.equal(emu.getState().zoomPosition, 0.75);
  });

  it('power on/off', () => {
    emu.handleOSC('/power/off', []);
    assert.equal(emu.getState().power, false);

    emu.handleOSC('/power/on', []);
    assert.equal(emu.getState().power, true);
  });

  it('focus auto/manual', () => {
    emu.handleOSC('/focus/manual', []);
    assert.equal(emu.getState().focusMode, 'manual');

    emu.handleOSC('/focus/auto', []);
    assert.equal(emu.getState().focusMode, 'auto');
  });
});

// =========================================================================
// ChamSysEmulator
// =========================================================================

describe('ChamSysEmulator', () => {
  let emu: ChamSysEmulator;

  beforeEach(() => {
    emu = new ChamSysEmulator(
      { type: 'chamsys', prefix: '/lights', host: '192.168.1.30', port: 6553 },
      stubHubContext(),
      false,
    );
    emu.connect();
  });

  it('playback go activates', () => {
    emu.handleOSC('/pb/1/1', []);
    const state = emu.getState();
    assert.equal(state.playbacks['1/1']?.active, true);
  });

  it('playback level set', () => {
    emu.handleOSC('/pb/1/1/level', [{ type: 'f', value: 0.5 }]);
    const state = emu.getState();
    assert.equal(state.playbacks['1/1']?.level, 0.5);
  });

  it('execute updates lastExec', () => {
    emu.handleOSC('/exec/3', []);
    assert.equal(emu.getState().lastExec, 3);
  });

  it('release deactivates playback', () => {
    emu.handleOSC('/pb/2/1', []);
    assert.equal(emu.getState().playbacks['2/1']?.active, true);

    emu.handleOSC('/release/2', []);
    assert.equal(emu.getState().playbacks['2/1']?.active, false);
    assert.equal(emu.getState().lastRelease, 2);
  });
});

// =========================================================================
// TouchDesignerEmulator
// =========================================================================

describe('TouchDesignerEmulator', () => {
  let emu: TouchDesignerEmulator;

  beforeEach(() => {
    emu = new TouchDesignerEmulator(
      { type: 'touchdesigner', prefix: '/td', host: '127.0.0.1', port: 12000 },
      stubHubContext(),
      false,
    );
    emu.connect();
  });

  it('any OSC stores in parameters map', () => {
    emu.handleOSC('/render/start', [1]);
    emu.handleOSC('/param/opacity', [0.75]);

    const state = emu.getState();
    assert.equal(state.parameters['/render/start'], 1);
    assert.equal(state.parameters['/param/opacity'], 0.75);
    assert.equal(state.messageCount, 2);
  });

  it('creates log entry for each message', () => {
    emu.handleOSC('/cue/1', []);
    emu.handleOSC('/cue/2', []);

    const log = emu.getLog();
    // +1 for connect log entry
    assert.ok(log.length >= 2, `Expected at least 2 log entries (excluding connect), got ${log.length}`);
  });

  it('stores last message', () => {
    emu.handleOSC('/some/address', [42, 'hello']);
    const state = emu.getState();
    assert.deepEqual(state.lastMessage, { address: '/some/address', args: [42, 'hello'] });
  });
});

// =========================================================================
// Factory: createEmulator
// =========================================================================

describe('createEmulator factory', () => {
  const baseConfig = { host: '127.0.0.1', port: 1234, prefix: '/test' };
  const ctx = stubHubContext();

  it('creates AvantisEmulator for avantis type', () => {
    const emu = createEmulator({ ...baseConfig, type: 'avantis' }, ctx, false);
    assert.ok(emu instanceof AvantisEmulator);
    assert.equal(emu.name, 'avantis');
  });

  it('creates OBSEmulator for obs type', () => {
    const emu = createEmulator({ ...baseConfig, type: 'obs' }, ctx, false);
    assert.ok(emu instanceof OBSEmulator);
  });

  it('creates VISCAEmulator for visca type', () => {
    const emu = createEmulator({ ...baseConfig, type: 'visca' }, ctx, false);
    assert.ok(emu instanceof VISCAEmulator);
  });

  it('creates ChamSysEmulator for chamsys type', () => {
    const emu = createEmulator({ ...baseConfig, type: 'chamsys' }, ctx, false);
    assert.ok(emu instanceof ChamSysEmulator);
  });

  it('creates TouchDesignerEmulator for touchdesigner type', () => {
    const emu = createEmulator({ ...baseConfig, type: 'touchdesigner' }, ctx, false);
    assert.ok(emu instanceof TouchDesignerEmulator);
  });

  it('throws for unknown type', () => {
    assert.throws(
      () => createEmulator({ ...baseConfig, type: 'unknown' }, ctx, false),
      /No emulator for device type: unknown/,
    );
  });
});

// =========================================================================
// Integration: emulator works with ProductionHub.addDriver()
// =========================================================================

describe('Hub integration', () => {
  it('emulators can be registered with addDriver and route OSC', () => {
    // We test this without starting the full hub (no OSC server) by calling routeOSC directly
    const { ProductionHub } = require('../hub');
    const hub = new ProductionHub({
      osc: { listenAddress: '127.0.0.1', listenPort: 19999 },
      logging: { verbose: false },
    });

    const emu = new AvantisEmulator(
      { type: 'avantis', prefix: '/avantis', host: '127.0.0.1', port: 51325, emulate: true },
      hub.hubContext,
      false,
    );

    hub.addDriver(emu, { type: 'avantis', prefix: '/avantis', host: '127.0.0.1', port: 51325, emulate: true });

    // Simulate routing
    hub.routeOSC('/avantis/ch/1/mix/fader', [{ type: 'f', value: 0.65 }]);

    const state = emu.getState();
    assert.equal(state.strips['ch/1']?.fader, 0.65);
  });
});
