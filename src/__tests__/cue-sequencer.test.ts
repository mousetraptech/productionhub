import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { setTimeout as delay } from 'node:timers/promises';
import { CueSequencer } from '../cue-sequencer/engine';
import { CueList, CueSequencerState } from '../cue-sequencer/types';
import { parseCueListYaml, parseCueList } from '../cue-sequencer/loader';

// --- Test helpers ---

interface OscCall {
  address: string;
  args: any[];
}

function createTestSequencer(verbose = false) {
  const calls: OscCall[] = [];
  const router = (address: string, args: any[]) => {
    calls.push({ address, args });
  };
  const seq = new CueSequencer(router, verbose);
  return { seq, calls };
}

function simpleCueList(): CueList {
  return {
    name: 'Test Show',
    cues: [
      {
        id: 'cue1',
        name: 'First Cue',
        actions: [
          { address: '/avantis/dca/1/fader', args: [0.75] },
          { address: '/lights/pb/1/1', args: [] },
        ],
      },
      {
        id: 'cue2',
        name: 'Second Cue',
        actions: [
          { address: '/avantis/dca/1/fader', args: [0.0] },
        ],
      },
      {
        id: 'cue3',
        name: 'Third Cue',
        actions: [
          { address: '/obs/scene', args: ['close-up'] },
        ],
      },
    ],
  };
}

// --- Tests ---

describe('CueSequencer', () => {
  describe('Initial state', () => {
    it('should start with no cue list loaded', () => {
      const { seq } = createTestSequencer();
      const state = seq.getState();
      assert.strictEqual(state.loaded, false);
      assert.strictEqual(state.cueListName, '');
      assert.strictEqual(state.cueCount, 0);
      assert.strictEqual(state.playheadIndex, -1);
      assert.strictEqual(state.activeCueId, null);
      assert.strictEqual(state.isRunning, false);
    });

    it('should return null for getCueList when nothing loaded', () => {
      const { seq } = createTestSequencer();
      assert.strictEqual(seq.getCueList(), null);
    });
  });

  describe('Loading cue lists', () => {
    it('should load a cue list and update state', () => {
      const { seq } = createTestSequencer();
      seq.loadCueList(simpleCueList());

      const state = seq.getState();
      assert.strictEqual(state.loaded, true);
      assert.strictEqual(state.cueListName, 'Test Show');
      assert.strictEqual(state.cueCount, 3);
      assert.strictEqual(state.playheadIndex, -1);
      assert.strictEqual(state.isRunning, false);
    });

    it('should return the loaded cue list', () => {
      const { seq } = createTestSequencer();
      const list = simpleCueList();
      seq.loadCueList(list);
      assert.deepStrictEqual(seq.getCueList(), list);
    });

    it('should emit state event on load', () => {
      const { seq } = createTestSequencer();
      const states: CueSequencerState[] = [];
      seq.on('state', (s: CueSequencerState) => states.push(s));

      seq.loadCueList(simpleCueList());
      // stop() emits one state, then loadCueList emits another
      assert.ok(states.length >= 1);
      // The final state should show loaded = true
      assert.strictEqual(states[states.length - 1].loaded, true);
    });

    it('should stop and reset playhead when loading new cue list', () => {
      const { seq } = createTestSequencer();
      seq.loadCueList(simpleCueList());
      seq.go(); // advance playhead

      seq.loadCueList({
        name: 'New Show',
        cues: [{ id: 'x', name: 'X', actions: [{ address: '/test', args: [] }] }],
      });

      const state = seq.getState();
      assert.strictEqual(state.cueListName, 'New Show');
      assert.strictEqual(state.cueCount, 1);
      assert.strictEqual(state.playheadIndex, -1);
    });
  });

  describe('GO — sequential cue execution', () => {
    it('should fire the first cue on go()', () => {
      const { seq, calls } = createTestSequencer();
      seq.loadCueList(simpleCueList());

      seq.go();

      assert.strictEqual(seq.getState().playheadIndex, 0);
      assert.strictEqual(seq.getState().activeCueId, 'cue1');
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[0].address, '/avantis/dca/1/fader');
      assert.strictEqual(calls[1].address, '/lights/pb/1/1');
    });

    it('should convert numeric args to OSC format', () => {
      const { seq, calls } = createTestSequencer();
      seq.loadCueList(simpleCueList());

      seq.go();

      // Float arg
      assert.deepStrictEqual(calls[0].args, [{ type: 'f', value: 0.75 }]);
      // Empty args
      assert.deepStrictEqual(calls[1].args, []);
    });

    it('should convert integer args to OSC format', () => {
      const { seq, calls } = createTestSequencer();
      seq.loadCueList({
        name: 'Int Test',
        cues: [{
          id: 'c1',
          name: 'Cue',
          actions: [{ address: '/test', args: [42] }],
        }],
      });

      seq.go();
      assert.deepStrictEqual(calls[0].args, [{ type: 'i', value: 42 }]);
    });

    it('should convert string args to OSC format', () => {
      const { seq, calls } = createTestSequencer();
      seq.loadCueList(simpleCueList());

      seq.go();
      seq.go();
      seq.go();

      // Third cue has string arg
      const obsCalls = calls.filter(c => c.address === '/obs/scene');
      assert.strictEqual(obsCalls.length, 1);
      assert.deepStrictEqual(obsCalls[0].args, [{ type: 's', value: 'close-up' }]);
    });

    it('should advance through cues sequentially', () => {
      const { seq } = createTestSequencer();
      seq.loadCueList(simpleCueList());

      seq.go();
      assert.strictEqual(seq.getState().playheadIndex, 0);
      assert.strictEqual(seq.getState().activeCueId, 'cue1');

      seq.go();
      assert.strictEqual(seq.getState().playheadIndex, 1);
      assert.strictEqual(seq.getState().activeCueId, 'cue2');

      seq.go();
      assert.strictEqual(seq.getState().playheadIndex, 2);
      assert.strictEqual(seq.getState().activeCueId, 'cue3');
    });

    it('should not advance past end of cue list', () => {
      const { seq, calls } = createTestSequencer();
      seq.loadCueList(simpleCueList());

      seq.go(); // cue1
      seq.go(); // cue2
      seq.go(); // cue3
      const callCount = calls.length;

      seq.go(); // should do nothing
      assert.strictEqual(seq.getState().playheadIndex, 2);
      assert.strictEqual(calls.length, callCount);
    });

    it('should do nothing when no cue list is loaded', () => {
      const { seq, calls } = createTestSequencer();
      seq.go();
      assert.strictEqual(calls.length, 0);
      assert.strictEqual(seq.getState().playheadIndex, -1);
    });

    it('should emit cue-fired event', () => {
      const { seq } = createTestSequencer();
      seq.loadCueList(simpleCueList());
      const fired: Array<{ index: number; cueId: string }> = [];
      seq.on('cue-fired', (index: number, cue: any) => {
        fired.push({ index, cueId: cue.id });
      });

      seq.go();
      assert.strictEqual(fired.length, 1);
      assert.deepStrictEqual(fired[0], { index: 0, cueId: 'cue1' });
    });

    it('should emit state event on go', () => {
      const { seq } = createTestSequencer();
      seq.loadCueList(simpleCueList());
      const states: CueSequencerState[] = [];
      // Skip the load event
      seq.on('state', (s: CueSequencerState) => states.push(s));

      seq.go();
      // go emits: fireCueAtIndex emits state, then stop() in fireCueAtIndex emits state
      assert.ok(states.length >= 1);
      // Last state should show playhead at 0, running
      const lastRunning = states.find(s => s.isRunning);
      assert.ok(lastRunning);
      assert.strictEqual(lastRunning!.playheadIndex, 0);
    });
  });

  describe('GO by cue ID', () => {
    it('should fire a specific cue by ID', () => {
      const { seq, calls } = createTestSequencer();
      seq.loadCueList(simpleCueList());

      seq.goCue('cue2');

      assert.strictEqual(seq.getState().playheadIndex, 1);
      assert.strictEqual(seq.getState().activeCueId, 'cue2');
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].address, '/avantis/dca/1/fader');
    });

    it('should allow jumping to any cue', () => {
      const { seq } = createTestSequencer();
      seq.loadCueList(simpleCueList());

      seq.goCue('cue3');
      assert.strictEqual(seq.getState().playheadIndex, 2);

      seq.goCue('cue1');
      assert.strictEqual(seq.getState().playheadIndex, 0);
    });

    it('should do nothing for unknown cue ID', () => {
      const { seq, calls } = createTestSequencer();
      seq.loadCueList(simpleCueList());

      seq.goCue('nonexistent');
      assert.strictEqual(calls.length, 0);
      assert.strictEqual(seq.getState().playheadIndex, -1);
    });

    it('should do nothing when no cue list is loaded', () => {
      const { seq, calls } = createTestSequencer();
      seq.goCue('cue1');
      assert.strictEqual(calls.length, 0);
    });
  });

  describe('STOP', () => {
    it('should cancel running state', () => {
      const { seq } = createTestSequencer();
      seq.loadCueList(simpleCueList());

      seq.go();
      assert.strictEqual(seq.getState().isRunning, true);

      seq.stop();
      assert.strictEqual(seq.getState().isRunning, false);
    });

    it('should not change playhead position', () => {
      const { seq } = createTestSequencer();
      seq.loadCueList(simpleCueList());

      seq.go();
      seq.stop();
      assert.strictEqual(seq.getState().playheadIndex, 0);
    });

    it('should cancel pending delayed actions', async () => {
      const { seq, calls } = createTestSequencer();
      seq.loadCueList({
        name: 'Delayed',
        cues: [{
          id: 'delayed',
          name: 'Delayed Cue',
          actions: [
            { address: '/immediate', args: [] },
            { address: '/delayed', args: [], delayMs: 200 },
          ],
        }],
      });

      seq.go();
      assert.strictEqual(calls.length, 1); // only immediate action fired
      assert.strictEqual(calls[0].address, '/immediate');

      seq.stop();
      await delay(300);

      // Delayed action should not have fired
      assert.strictEqual(calls.length, 1);
    });

    it('should emit state event on stop', () => {
      const { seq } = createTestSequencer();
      seq.loadCueList(simpleCueList());
      seq.go();

      const states: CueSequencerState[] = [];
      seq.on('state', (s: CueSequencerState) => states.push(s));

      seq.stop();
      assert.ok(states.length >= 1);
      assert.strictEqual(states[states.length - 1].isRunning, false);
    });
  });

  describe('BACK', () => {
    it('should move playhead back by one', () => {
      const { seq } = createTestSequencer();
      seq.loadCueList(simpleCueList());

      seq.go(); // playhead = 0
      seq.go(); // playhead = 1

      seq.back();
      assert.strictEqual(seq.getState().playheadIndex, 0);
    });

    it('should move playhead to -1 from position 0', () => {
      const { seq } = createTestSequencer();
      seq.loadCueList(simpleCueList());

      seq.go(); // playhead = 0
      seq.back();
      assert.strictEqual(seq.getState().playheadIndex, -1);
    });

    it('should not move below -1', () => {
      const { seq } = createTestSequencer();
      seq.loadCueList(simpleCueList());

      seq.back();
      assert.strictEqual(seq.getState().playheadIndex, -1);

      seq.back();
      assert.strictEqual(seq.getState().playheadIndex, -1);
    });

    it('should not fire any actions', () => {
      const { seq, calls } = createTestSequencer();
      seq.loadCueList(simpleCueList());

      seq.go();
      const callsBefore = calls.length;
      seq.back();

      assert.strictEqual(calls.length, callsBefore);
    });

    it('should emit state event on back', () => {
      const { seq } = createTestSequencer();
      seq.loadCueList(simpleCueList());
      seq.go();

      const states: CueSequencerState[] = [];
      seq.on('state', (s: CueSequencerState) => states.push(s));

      seq.back();
      assert.ok(states.length >= 1);
    });
  });

  describe('Pre-wait delay', () => {
    it('should delay cue execution by preWaitMs', async () => {
      const { seq, calls } = createTestSequencer();
      seq.loadCueList({
        name: 'PreWait Test',
        cues: [{
          id: 'pw',
          name: 'Pre-Wait Cue',
          preWaitMs: 100,
          actions: [{ address: '/test', args: [1] }],
        }],
      });

      seq.go();
      // Actions should not have fired yet
      assert.strictEqual(calls.length, 0);

      await delay(150);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].address, '/test');

      seq.shutdown();
    });

    it('should cancel pre-wait on stop', async () => {
      const { seq, calls } = createTestSequencer();
      seq.loadCueList({
        name: 'Cancel PreWait',
        cues: [{
          id: 'cpw',
          name: 'Cancelled Pre-Wait',
          preWaitMs: 200,
          actions: [{ address: '/test', args: [] }],
        }],
      });

      seq.go();
      seq.stop();

      await delay(300);
      assert.strictEqual(calls.length, 0);
    });
  });

  describe('Action delay within a cue', () => {
    it('should fire actions with delayMs after the specified offset', async () => {
      const { seq, calls } = createTestSequencer();
      seq.loadCueList({
        name: 'Action Delay',
        cues: [{
          id: 'ad',
          name: 'Action Delay Cue',
          actions: [
            { address: '/first', args: [] },
            { address: '/delayed', args: [], delayMs: 100 },
          ],
        }],
      });

      seq.go();
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].address, '/first');

      await delay(150);
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[1].address, '/delayed');

      seq.shutdown();
    });
  });

  describe('Post-wait delay', () => {
    it('should delay cue-complete by postWaitMs', async () => {
      const { seq } = createTestSequencer();
      const completions: number[] = [];
      seq.on('cue-complete', (index: number) => completions.push(index));

      seq.loadCueList({
        name: 'PostWait',
        cues: [{
          id: 'pw',
          name: 'Post-Wait Cue',
          postWaitMs: 100,
          actions: [{ address: '/test', args: [] }],
        }],
      });

      seq.go();

      // Should not have completed immediately
      assert.strictEqual(completions.length, 0);

      await delay(150);
      assert.strictEqual(completions.length, 1);

      seq.shutdown();
    });
  });

  describe('Auto-follow', () => {
    it('should automatically fire next cue when autoFollow is true', async () => {
      const { seq, calls } = createTestSequencer();
      seq.loadCueList({
        name: 'Auto-Follow',
        cues: [
          {
            id: 'af1',
            name: 'Auto 1',
            autoFollow: true,
            actions: [{ address: '/first', args: [] }],
          },
          {
            id: 'af2',
            name: 'Auto 2',
            actions: [{ address: '/second', args: [] }],
          },
        ],
      });

      seq.go();

      // Wait for auto-follow chain to complete (completion delay is 0ms post-wait)
      await delay(50);

      assert.strictEqual(seq.getState().playheadIndex, 1);
      const addresses = calls.map(c => c.address);
      assert.ok(addresses.includes('/first'));
      assert.ok(addresses.includes('/second'));

      seq.shutdown();
    });

    it('should chain multiple auto-follow cues', async () => {
      const { seq, calls } = createTestSequencer();
      seq.loadCueList({
        name: 'Chain',
        cues: [
          {
            id: 'c1',
            name: 'Chain 1',
            autoFollow: true,
            actions: [{ address: '/a', args: [] }],
          },
          {
            id: 'c2',
            name: 'Chain 2',
            autoFollow: true,
            actions: [{ address: '/b', args: [] }],
          },
          {
            id: 'c3',
            name: 'Chain 3',
            actions: [{ address: '/c', args: [] }],
          },
        ],
      });

      seq.go();
      await delay(100);

      assert.strictEqual(seq.getState().playheadIndex, 2);
      const addresses = calls.map(c => c.address);
      assert.ok(addresses.includes('/a'));
      assert.ok(addresses.includes('/b'));
      assert.ok(addresses.includes('/c'));

      seq.shutdown();
    });

    it('should not auto-follow past end of cue list', async () => {
      const { seq } = createTestSequencer();
      seq.loadCueList({
        name: 'End',
        cues: [{
          id: 'last',
          name: 'Last Cue',
          autoFollow: true,
          actions: [{ address: '/last', args: [] }],
        }],
      });

      seq.go();
      await delay(50);

      assert.strictEqual(seq.getState().playheadIndex, 0);

      seq.shutdown();
    });
  });

  describe('Shutdown', () => {
    it('should clear cue list and reset state', () => {
      const { seq } = createTestSequencer();
      seq.loadCueList(simpleCueList());
      seq.go();

      seq.shutdown();

      assert.strictEqual(seq.getState().loaded, false);
      assert.strictEqual(seq.getState().playheadIndex, -1);
      assert.strictEqual(seq.getCueList(), null);
    });

    it('should cancel pending timers', async () => {
      const { seq, calls } = createTestSequencer();
      seq.loadCueList({
        name: 'Timer Cleanup',
        cues: [{
          id: 'tc',
          name: 'Timer Cleanup',
          actions: [{ address: '/delayed', args: [], delayMs: 200 }],
        }],
      });

      seq.go();
      seq.shutdown();

      await delay(300);
      assert.strictEqual(calls.length, 0);
    });
  });
});

describe('Cue List YAML Loader', () => {
  describe('parseCueListYaml', () => {
    it('should parse valid YAML cue list', () => {
      const yaml = `
cuelist:
  name: "Sunday Concert"
  cues:
    - id: preshow
      name: "Pre-Show Look"
      actions:
        - address: /lights/pb/1/1
        - address: /avantis/dca/1/fader
          args: [0.0]
    - id: song1
      name: "Song 1"
      actions:
        - address: /avantis/dca/1/fader
          args: [0.85]
      autoFollow: true
`;
      const list = parseCueListYaml(yaml);
      assert.strictEqual(list.name, 'Sunday Concert');
      assert.strictEqual(list.cues.length, 2);
      assert.strictEqual(list.cues[0].id, 'preshow');
      assert.strictEqual(list.cues[0].actions.length, 2);
      assert.deepStrictEqual(list.cues[0].actions[0].args, []);
      assert.deepStrictEqual(list.cues[0].actions[1].args, [0.0]);
      assert.strictEqual(list.cues[1].autoFollow, true);
    });

    it('should throw if YAML lacks cuelist section', () => {
      assert.throws(() => {
        parseCueListYaml('name: "test"');
      }, /must contain a "cuelist" section/);
    });

    it('should throw if cuelist lacks name', () => {
      assert.throws(() => {
        parseCueListYaml('cuelist:\n  cues: []');
      }, /missing "name"/);
    });

    it('should throw if cuelist lacks cues array', () => {
      assert.throws(() => {
        parseCueListYaml('cuelist:\n  name: test');
      }, /missing "cues" array/);
    });

    it('should throw if action lacks address', () => {
      assert.throws(() => {
        parseCueListYaml(`
cuelist:
  name: test
  cues:
    - id: c1
      name: Cue 1
      actions:
        - args: [1]
`);
      }, /missing "address"/);
    });

    it('should throw if cue lacks actions array', () => {
      assert.throws(() => {
        parseCueListYaml(`
cuelist:
  name: test
  cues:
    - id: c1
      name: Cue 1
`);
      }, /missing "actions" array/);
    });
  });

  describe('parseCueList', () => {
    it('should generate default id and name for cues', () => {
      const list = parseCueList({
        name: 'Defaults',
        cues: [
          { actions: [{ address: '/test' }] },
          { actions: [{ address: '/test2' }] },
        ],
      });

      assert.strictEqual(list.cues[0].id, 'cue-0');
      assert.strictEqual(list.cues[0].name, 'Cue 1');
      assert.strictEqual(list.cues[1].id, 'cue-1');
      assert.strictEqual(list.cues[1].name, 'Cue 2');
    });

    it('should parse pre/post wait and delay values', () => {
      const list = parseCueList({
        name: 'Waits',
        cues: [{
          id: 'w1',
          name: 'Wait Cue',
          preWaitMs: 500,
          postWaitMs: 1000,
          actions: [{
            address: '/test',
            args: [1],
            delayMs: 250,
          }],
        }],
      });

      assert.strictEqual(list.cues[0].preWaitMs, 500);
      assert.strictEqual(list.cues[0].postWaitMs, 1000);
      assert.strictEqual(list.cues[0].actions[0].delayMs, 250);
    });
  });
});
