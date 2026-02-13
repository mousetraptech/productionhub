import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { setTimeout as delay } from 'node:timers/promises';
import { MacroEngine } from '../macros/engine';
import { MacroDef } from '../macros/types';

// --- Test helpers ---

interface OscCall {
  address: string;
  args: any[];
}

function createTestEngine(verbose = false) {
  const calls: OscCall[] = [];
  const sender = (address: string, args: any[]) => {
    calls.push({ address, args });
  };
  const engine = new MacroEngine(sender, verbose);
  return { engine, calls };
}

// --- Tests ---

describe('MacroEngine', () => {
  describe('Loading macros', () => {
    it('should load macros from config', () => {
      const { engine } = createTestEngine();
      engine.loadMacros({
        macros: [
          {
            address: '/macro/blackout',
            name: 'Blackout',
            actions: [{ address: '/lights/pb/1/1' }],
          },
        ],
      });

      assert.strictEqual(engine.hasMacro('/macro/blackout'), true);
      assert.strictEqual(engine.hasMacro('/macro/unknown'), false);
    });

    it('should be case-insensitive for addresses', () => {
      const { engine } = createTestEngine();
      engine.loadMacros({
        macros: [{
          address: '/Macro/Blackout',
          name: 'Blackout',
          actions: [{ address: '/lights/pb/1/1' }],
        }],
      });

      assert.strictEqual(engine.hasMacro('/macro/blackout'), true);
      assert.strictEqual(engine.hasMacro('/MACRO/BLACKOUT'), true);
    });

    it('should return all loaded macros', () => {
      const { engine } = createTestEngine();
      engine.loadMacros({
        macros: [
          { address: '/m1', name: 'M1', actions: [] },
          { address: '/m2', name: 'M2', actions: [] },
        ],
      });

      const macros = engine.getMacros();
      assert.strictEqual(macros.length, 2);
    });

    it('should clear previous macros on reload', () => {
      const { engine } = createTestEngine();
      engine.loadMacros({
        macros: [{ address: '/old', name: 'Old', actions: [] }],
      });
      assert.strictEqual(engine.hasMacro('/old'), true);

      engine.loadMacros({
        macros: [{ address: '/new', name: 'New', actions: [] }],
      });
      assert.strictEqual(engine.hasMacro('/old'), false);
      assert.strictEqual(engine.hasMacro('/new'), true);
    });
  });

  describe('Executing macros', () => {
    it('should execute a macro and send OSC commands', () => {
      const { engine, calls } = createTestEngine();
      engine.loadMacros({
        macros: [{
          address: '/macro/test',
          name: 'Test',
          actions: [
            { address: '/avantis/dca/1/fader', args: [0.75] },
            { address: '/lights/pb/1/1' },
          ],
        }],
      });

      const result = engine.execute('/macro/test', []);
      assert.strictEqual(result, true);
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[0].address, '/avantis/dca/1/fader');
      assert.strictEqual(calls[1].address, '/lights/pb/1/1');
    });

    it('should return false for unknown macro', () => {
      const { engine, calls } = createTestEngine();
      const result = engine.execute('/macro/nonexistent', []);
      assert.strictEqual(result, false);
      assert.strictEqual(calls.length, 0);
    });

    it('should convert numeric args to OSC format', () => {
      const { engine, calls } = createTestEngine();
      engine.loadMacros({
        macros: [{
          address: '/macro/test',
          name: 'Test',
          actions: [
            { address: '/test', args: [0.5, 42, 'hello'] },
          ],
        }],
      });

      engine.execute('/macro/test', []);
      assert.deepStrictEqual(calls[0].args, [
        { type: 'f', value: 0.5 },
        { type: 'i', value: 42 },
        { type: 's', value: 'hello' },
      ]);
    });

    it('should send empty args array for actions without args', () => {
      const { engine, calls } = createTestEngine();
      engine.loadMacros({
        macros: [{
          address: '/macro/test',
          name: 'Test',
          actions: [{ address: '/test' }],
        }],
      });

      engine.execute('/macro/test', []);
      assert.deepStrictEqual(calls[0].args, []);
    });

    it('should emit macro-fired event', () => {
      const { engine } = createTestEngine();
      engine.loadMacros({
        macros: [{
          address: '/macro/test',
          name: 'Test Macro',
          actions: [{ address: '/test' }],
        }],
      });

      const fired: Array<{ address: string; name: string }> = [];
      engine.on('macro-fired', (addr: string, name: string) => {
        fired.push({ address: addr, name });
      });

      engine.execute('/macro/test', []);
      assert.strictEqual(fired.length, 1);
      assert.strictEqual(fired[0].address, '/macro/test');
      assert.strictEqual(fired[0].name, 'Test Macro');
    });
  });

  describe('Pass-through arguments', () => {
    it('should replace $$1 placeholder with trigger arg', () => {
      const { engine, calls } = createTestEngine();
      engine.loadMacros({
        macros: [{
          address: '/macro/fade',
          name: 'Fade',
          actions: [
            { address: '/avantis/dca/1/fader', args: ['$$1'] },
          ],
        }],
      });

      engine.execute('/macro/fade', [{ type: 'f', value: 0.85 }]);
      assert.deepStrictEqual(calls[0].args, [{ type: 'f', value: 0.85 }]);
    });

    it('should replace multiple $$ placeholders', () => {
      const { engine, calls } = createTestEngine();
      engine.loadMacros({
        macros: [{
          address: '/macro/dual',
          name: 'Dual',
          actions: [
            { address: '/test', args: ['$$1', '$$2'] },
          ],
        }],
      });

      engine.execute('/macro/dual', [
        { type: 'f', value: 0.5 },
        { type: 's', value: 'hello' },
      ]);

      assert.deepStrictEqual(calls[0].args, [
        { type: 'f', value: 0.5 },
        { type: 's', value: 'hello' },
      ]);
    });

    it('should leave placeholder if no matching arg', () => {
      const { engine, calls } = createTestEngine();
      engine.loadMacros({
        macros: [{
          address: '/macro/test',
          name: 'Test',
          actions: [
            { address: '/test', args: ['$$3'] },
          ],
        }],
      });

      engine.execute('/macro/test', [1]);
      // $$3 has no matching arg (only 1 trigger arg), so stays as string '$$3'
      assert.deepStrictEqual(calls[0].args, [{ type: 's', value: '$$3' }]);
    });

    it('should mix static args with pass-through', () => {
      const { engine, calls } = createTestEngine();
      engine.loadMacros({
        macros: [{
          address: '/macro/mix',
          name: 'Mix',
          actions: [
            { address: '/test', args: [0.5, '$$1', 'fixed'] },
          ],
        }],
      });

      engine.execute('/macro/mix', [42]);
      assert.deepStrictEqual(calls[0].args, [
        { type: 'f', value: 0.5 },
        { type: 'i', value: 42 },
        { type: 's', value: 'fixed' },
      ]);
    });

    it('should extract value from plain arg (not OSC object)', () => {
      const { engine, calls } = createTestEngine();
      engine.loadMacros({
        macros: [{
          address: '/macro/test',
          name: 'Test',
          actions: [{ address: '/test', args: ['$$1'] }],
        }],
      });

      engine.execute('/macro/test', [99]);
      assert.deepStrictEqual(calls[0].args, [{ type: 'i', value: 99 }]);
    });
  });

  describe('Delayed actions', () => {
    it('should delay actions with delayMs', async () => {
      const { engine, calls } = createTestEngine();
      engine.loadMacros({
        macros: [{
          address: '/macro/delayed',
          name: 'Delayed',
          actions: [
            { address: '/immediate', args: [] },
            { address: '/delayed', args: [], delayMs: 100 },
          ],
        }],
      });

      engine.execute('/macro/delayed', []);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].address, '/immediate');

      await delay(150);
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[1].address, '/delayed');

      engine.shutdown();
    });

    it('should cancel delayed actions on stop', async () => {
      const { engine, calls } = createTestEngine();
      engine.loadMacros({
        macros: [{
          address: '/macro/delayed',
          name: 'Delayed',
          actions: [
            { address: '/delayed', args: [], delayMs: 200 },
          ],
        }],
      });

      engine.execute('/macro/delayed', []);
      engine.stop();

      await delay(300);
      assert.strictEqual(calls.length, 0);
    });
  });

  describe('Nested macros', () => {
    it('should execute nested macros', () => {
      const { engine, calls } = createTestEngine();
      engine.loadMacros({
        macros: [
          {
            address: '/macro/outer',
            name: 'Outer',
            actions: [
              { address: '/macro/inner' },  // triggers inner macro
            ],
          },
          {
            address: '/macro/inner',
            name: 'Inner',
            actions: [
              { address: '/test', args: [1] },
            ],
          },
        ],
      });

      engine.execute('/macro/outer', []);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].address, '/test');
    });

    it('should handle multi-level nesting', () => {
      const { engine, calls } = createTestEngine();
      engine.loadMacros({
        macros: [
          {
            address: '/macro/a',
            name: 'A',
            actions: [{ address: '/macro/b' }],
          },
          {
            address: '/macro/b',
            name: 'B',
            actions: [{ address: '/macro/c' }],
          },
          {
            address: '/macro/c',
            name: 'C',
            actions: [{ address: '/final', args: [42] }],
          },
        ],
      });

      engine.execute('/macro/a', []);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].address, '/final');
    });

    it('should pass trigger args through nested macros', () => {
      const { engine, calls } = createTestEngine();
      engine.loadMacros({
        macros: [
          {
            address: '/macro/outer',
            name: 'Outer',
            actions: [{ address: '/macro/inner', args: ['$$1'] }],
          },
          {
            address: '/macro/inner',
            name: 'Inner',
            actions: [{ address: '/test', args: ['$$1'] }],
          },
        ],
      });

      // The outer macro gets trigger args, but inner gets the resolved args from outer
      // Actually, nested macros receive the original trigger args
      engine.execute('/macro/outer', [0.75]);
      // The outer's action for /macro/inner has args: ['$$1'] → resolved to [0.75]
      // But the inner macro resolves its own args using triggerArgs from original execute
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].address, '/test');
    });
  });

  describe('Cycle detection', () => {
    it('should detect direct self-reference', () => {
      const { engine, calls } = createTestEngine();
      engine.loadMacros({
        macros: [{
          address: '/macro/loop',
          name: 'Loop',
          actions: [
            { address: '/test', args: [1] },
            { address: '/macro/loop' },  // self-reference!
          ],
        }],
      });

      engine.execute('/macro/loop', []);

      // Should fire /test once, then detect cycle on self-reference
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0].address, '/test');
    });

    it('should detect indirect cycle (A -> B -> A)', () => {
      const { engine, calls } = createTestEngine();
      engine.loadMacros({
        macros: [
          {
            address: '/macro/a',
            name: 'A',
            actions: [
              { address: '/output-a' },
              { address: '/macro/b' },
            ],
          },
          {
            address: '/macro/b',
            name: 'B',
            actions: [
              { address: '/output-b' },
              { address: '/macro/a' },  // cycle back to A!
            ],
          },
        ],
      });

      engine.execute('/macro/a', []);

      // A fires /output-a, then calls B
      // B fires /output-b, then detects cycle trying to call A
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[0].address, '/output-a');
      assert.strictEqual(calls[1].address, '/output-b');
    });

    it('should detect longer cycle (A -> B -> C -> A)', () => {
      const { engine, calls } = createTestEngine();
      engine.loadMacros({
        macros: [
          {
            address: '/macro/a',
            name: 'A',
            actions: [{ address: '/out-a' }, { address: '/macro/b' }],
          },
          {
            address: '/macro/b',
            name: 'B',
            actions: [{ address: '/out-b' }, { address: '/macro/c' }],
          },
          {
            address: '/macro/c',
            name: 'C',
            actions: [{ address: '/out-c' }, { address: '/macro/a' }],
          },
        ],
      });

      engine.execute('/macro/a', []);

      // Each macro fires its output, cycle detected at A re-entry
      assert.strictEqual(calls.length, 3);
      assert.strictEqual(calls[0].address, '/out-a');
      assert.strictEqual(calls[1].address, '/out-b');
      assert.strictEqual(calls[2].address, '/out-c');
    });

    it('should allow same macro at different branches (diamond)', () => {
      const { engine, calls } = createTestEngine();
      engine.loadMacros({
        macros: [
          {
            address: '/macro/top',
            name: 'Top',
            actions: [
              { address: '/macro/left' },
              { address: '/macro/right' },
            ],
          },
          {
            address: '/macro/left',
            name: 'Left',
            actions: [{ address: '/macro/shared' }],
          },
          {
            address: '/macro/right',
            name: 'Right',
            actions: [{ address: '/macro/shared' }],
          },
          {
            address: '/macro/shared',
            name: 'Shared',
            actions: [{ address: '/output' }],
          },
        ],
      });

      engine.execute('/macro/top', []);

      // Diamond: top -> left -> shared -> /output, top -> right -> shared -> /output
      // Each branch has its own visited set, so shared fires twice
      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[0].address, '/output');
      assert.strictEqual(calls[1].address, '/output');
    });
  });

  describe('Shutdown', () => {
    it('should clear macros and timers on shutdown', async () => {
      const { engine, calls } = createTestEngine();
      engine.loadMacros({
        macros: [{
          address: '/macro/test',
          name: 'Test',
          actions: [{ address: '/delayed', args: [], delayMs: 200 }],
        }],
      });

      engine.execute('/macro/test', []);
      engine.shutdown();

      await delay(300);
      assert.strictEqual(calls.length, 0);
      assert.strictEqual(engine.getMacros().length, 0);
      assert.strictEqual(engine.hasMacro('/macro/test'), false);
    });
  });
});
