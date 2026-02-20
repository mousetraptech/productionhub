import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { DeckPersistence } from '../deck/persistence';

const TEST_DIR = path.join(__dirname, '../../.test-decks');

describe('DeckPersistence', () => {
  let persistence: DeckPersistence;

  beforeEach(() => {
    persistence = new DeckPersistence(TEST_DIR);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should list empty when no profiles exist', () => {
    assert.deepStrictEqual(persistence.list(), []);
  });

  it('should save and load a profile', () => {
    const profile = {
      name: 'Test Deck',
      grid: [{
        row: 0, col: 0,
        button: {
          id: 'btn-1', label: 'House Full', icon: '🏠', color: '#F59E0B',
          actions: [{ actionId: 'house-full' }],
          mode: 'parallel' as const, seriesGap: 1000,
        },
      }],
    };

    persistence.save('Test Deck', profile);
    const loaded = persistence.load('test_deck');
    assert.ok(loaded);
    assert.strictEqual(loaded!.name, 'Test Deck');
    assert.strictEqual(loaded!.grid.length, 1);
    assert.strictEqual(loaded!.grid[0].button.label, 'House Full');
    assert.strictEqual(loaded!.grid[0].button.mode, 'parallel');
  });

  it('should list saved profiles', () => {
    persistence.save('Deck A', { name: 'Deck A', grid: [] });
    persistence.save('Deck B', { name: 'Deck B', grid: [] });
    const list = persistence.list();
    assert.strictEqual(list.length, 2);
    assert.ok(list.includes('deck_a'));
    assert.ok(list.includes('deck_b'));
  });

  it('should delete a profile', () => {
    persistence.save('ToDelete', { name: 'ToDelete', grid: [] });
    assert.strictEqual(persistence.list().length, 1);
    persistence.delete('todelete');
    assert.strictEqual(persistence.list().length, 0);
  });

  it('should return null for missing profile', () => {
    assert.strictEqual(persistence.load('nonexistent'), null);
  });

  it('should sanitize file names', () => {
    persistence.save('My Deck!@#$', { name: 'My Deck!@#$', grid: [] });
    const list = persistence.list();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0], 'my_deck____');
  });
});
