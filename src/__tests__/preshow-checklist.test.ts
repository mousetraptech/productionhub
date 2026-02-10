import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { PreshowChecklist } from '../preshow-checklist';

describe('PreshowChecklist', () => {
  describe('constructor and getState', () => {
    it('should initialize all items as unchecked', () => {
      const cl = new PreshowChecklist(['A', 'B', 'C']);
      const state = cl.getState();
      assert.equal(state.total, 3);
      assert.equal(state.checked, 0);
      assert.equal(state.allDone, false);
      for (const item of state.items) {
        assert.equal(item.checked, false);
      }
    });

    it('should assign sequential IDs', () => {
      const cl = new PreshowChecklist(['X', 'Y']);
      const state = cl.getState();
      assert.equal(state.items[0].id, 0);
      assert.equal(state.items[1].id, 1);
    });

    it('should preserve labels', () => {
      const cl = new PreshowChecklist(['Soundcheck', 'Camera check']);
      const state = cl.getState();
      assert.equal(state.items[0].label, 'Soundcheck');
      assert.equal(state.items[1].label, 'Camera check');
    });

    it('should handle empty label array', () => {
      const cl = new PreshowChecklist([]);
      const state = cl.getState();
      assert.equal(state.total, 0);
      assert.equal(state.checked, 0);
      assert.equal(state.allDone, false);
      assert.deepEqual(state.items, []);
    });
  });

  describe('toggle', () => {
    it('should check an unchecked item', () => {
      const cl = new PreshowChecklist(['A', 'B']);
      assert.equal(cl.toggle(0), true);
      const state = cl.getState();
      assert.equal(state.items[0].checked, true);
      assert.equal(state.items[1].checked, false);
      assert.equal(state.checked, 1);
    });

    it('should uncheck a checked item', () => {
      const cl = new PreshowChecklist(['A']);
      cl.toggle(0);
      cl.toggle(0);
      assert.equal(cl.getState().items[0].checked, false);
    });

    it('should return false for invalid ID', () => {
      const cl = new PreshowChecklist(['A']);
      assert.equal(cl.toggle(99), false);
      assert.equal(cl.toggle(-1), false);
    });
  });

  describe('reset', () => {
    it('should uncheck all items', () => {
      const cl = new PreshowChecklist(['A', 'B', 'C']);
      cl.toggle(0);
      cl.toggle(1);
      cl.toggle(2);
      assert.equal(cl.getState().checked, 3);

      cl.reset();
      const state = cl.getState();
      assert.equal(state.checked, 0);
      assert.equal(state.allDone, false);
      for (const item of state.items) {
        assert.equal(item.checked, false);
      }
    });

    it('should be safe to call on empty checklist', () => {
      const cl = new PreshowChecklist([]);
      cl.reset();
      assert.equal(cl.getState().total, 0);
    });
  });

  describe('allDone', () => {
    it('should report allDone when all items are checked', () => {
      const cl = new PreshowChecklist(['A', 'B']);
      cl.toggle(0);
      cl.toggle(1);
      assert.equal(cl.getState().allDone, true);
    });

    it('should report not allDone when some items unchecked', () => {
      const cl = new PreshowChecklist(['A', 'B']);
      cl.toggle(0);
      assert.equal(cl.getState().allDone, false);
    });
  });

  describe('state isolation', () => {
    it('should return a copy — mutating returned items does not affect internal state', () => {
      const cl = new PreshowChecklist(['A']);
      const state = cl.getState();
      state.items[0].checked = true;
      assert.equal(cl.getState().items[0].checked, false);
    });
  });
});
