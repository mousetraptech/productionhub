import { describe, it } from 'node:test';
import assert from 'node:assert';
import { setTimeout as delay } from 'node:timers/promises';
import { fireDeckButton } from '../deck/fire';
import { DeckAction } from '../deck/types';

describe('fireDeckButton', () => {
  it('should fire all actions in parallel mode', async () => {
    const fired: string[] = [];
    const actions: DeckAction[] = [
      { actionId: 'house-full' },
      { actionId: 'pb1-go' },
    ];

    await fireDeckButton(actions, 'parallel', 0, (actionId, osc) => {
      fired.push(actionId);
    });

    assert.deepStrictEqual(fired, ['house-full', 'pb1-go']);
  });

  it('should fire actions in series with gap', async () => {
    const timestamps: number[] = [];
    const actions: DeckAction[] = [
      { actionId: 'a' },
      { actionId: 'b' },
      { actionId: 'c' },
    ];

    await fireDeckButton(actions, 'series', 100, (_actionId) => {
      timestamps.push(Date.now());
    });

    // b should fire ~100ms after a, c ~100ms after b
    assert.strictEqual(timestamps.length, 3);
    assert.ok(timestamps[1] - timestamps[0] >= 80, `Gap 1: ${timestamps[1] - timestamps[0]}ms`);
    assert.ok(timestamps[2] - timestamps[1] >= 80, `Gap 2: ${timestamps[2] - timestamps[1]}ms`);
  });

  it('should pass inline OSC to callback', async () => {
    const received: any[] = [];
    const actions: DeckAction[] = [
      { actionId: 'inline:test', osc: { address: '/test/addr', args: [1.0], label: 'Test' } },
    ];

    await fireDeckButton(actions, 'parallel', 0, (actionId, osc) => {
      received.push({ actionId, osc });
    });

    assert.strictEqual(received[0].osc.address, '/test/addr');
  });

  it('should resolve immediately for parallel mode', async () => {
    const start = Date.now();
    await fireDeckButton(
      [{ actionId: 'a' }, { actionId: 'b' }],
      'parallel', 500,
      () => {},
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, `Parallel should be instant, took ${elapsed}ms`);
  });
});
