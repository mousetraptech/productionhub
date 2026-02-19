import { describe, it, expect, vi } from 'vitest';
import { executeTool, ToolDeps } from '../src/brain/tools';
import { ActionRegistry } from '../src/actions/registry';
import { CueEngine } from '../src/cue-engine/engine';

function makeDeps(overrides?: Partial<ToolDeps>): ToolDeps {
  const registry = new ActionRegistry('/dev/null');
  const cueEngine = new CueEngine(registry, () => {});

  return {
    actionRegistry: registry,
    cueEngine,
    routeOSC: vi.fn(),
    getDeviceStates: () => ({}),
    ...overrides,
  };
}

describe('brain tools', () => {
  describe('send_osc', () => {
    it('routes OSC command', () => {
      const routeOSC = vi.fn();
      const deps = makeDeps({ routeOSC });
      const result = executeTool('send_osc', { address: '/avantis/ch/5/mix/fader', args: [0.8] }, deps);
      expect(result.success).toBe(true);
      expect(routeOSC).toHaveBeenCalledWith('/avantis/ch/5/mix/fader', [0.8]);
    });

    it('defaults args to empty array', () => {
      const routeOSC = vi.fn();
      const deps = makeDeps({ routeOSC });
      executeTool('send_osc', { address: '/lights/pb/1/1' }, deps);
      expect(routeOSC).toHaveBeenCalledWith('/lights/pb/1/1', []);
    });
  });

  describe('fire_cue', () => {
    it('fires next cue on "go"', () => {
      const deps = makeDeps();
      const goSpy = vi.spyOn(deps.cueEngine, 'go');
      const result = executeTool('fire_cue', { command: 'go' }, deps);
      expect(result.success).toBe(true);
      expect(goSpy).toHaveBeenCalled();
    });

    it('returns to standby', () => {
      const deps = makeDeps();
      const standbySpy = vi.spyOn(deps.cueEngine, 'standby');
      const result = executeTool('fire_cue', { command: 'standby' }, deps);
      expect(result.success).toBe(true);
      expect(standbySpy).toHaveBeenCalled();
    });
  });

  describe('get_device_state', () => {
    it('returns specific device state', () => {
      const deps = makeDeps({
        getDeviceStates: () => ({ obs: { streaming: true, recording: false } }),
      });
      const result = executeTool('get_device_state', { device: 'obs' }, deps);
      expect(result.success).toBe(true);
      expect(result.detail).toContain('streaming');
    });

    it('returns all device states', () => {
      const deps = makeDeps({
        getDeviceStates: () => ({ obs: { streaming: true }, avantis: { currentScene: 1 } }),
      });
      const result = executeTool('get_device_state', { device: 'all' }, deps);
      expect(result.success).toBe(true);
      expect(result.detail).toContain('obs');
      expect(result.detail).toContain('avantis');
    });
  });

  describe('get_show_state', () => {
    it('returns current show state', () => {
      const deps = makeDeps();
      const result = executeTool('get_show_state', {}, deps);
      expect(result.success).toBe(true);
      expect(result.detail).toContain('cues');
    });
  });

  describe('recall_scene', () => {
    it('sends scene recall OSC', () => {
      const routeOSC = vi.fn();
      const deps = makeDeps({ routeOSC });
      const result = executeTool('recall_scene', { scene_number: 3 }, deps);
      expect(result.success).toBe(true);
      expect(routeOSC).toHaveBeenCalledWith('/avantis/scene/recall', [3]);
    });
  });

  describe('camera_preset', () => {
    it('sends preset recall for correct camera', () => {
      const routeOSC = vi.fn();
      const deps = makeDeps({ routeOSC });
      const result = executeTool('camera_preset', { camera: 'cam2', preset: 4 }, deps);
      expect(result.success).toBe(true);
      expect(routeOSC).toHaveBeenCalledWith('/cam2/preset/recall/4', []);
    });
  });

  describe('unknown tool', () => {
    it('returns failure', () => {
      const deps = makeDeps();
      const result = executeTool('nonexistent', {}, deps);
      expect(result.success).toBe(false);
    });
  });
});
