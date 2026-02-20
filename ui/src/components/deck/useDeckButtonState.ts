import { DeckButton as DeckButtonType } from '../../types';

interface DeviceStates {
  avantis: any;
  obs: any;
  chamsys: any;
  visca: any;
  touchdesigner: any;
}

export interface ButtonState {
  level: number | null;
  active: boolean;
  live: boolean;
}

export function getDeckButtonState(button: DeckButtonType, deviceStates: DeviceStates): ButtonState {
  const state: ButtonState = { level: null, active: false, live: false };
  if (!button.actions.length) return state;

  const firstAction = button.actions[0];
  const address = firstAction.osc?.address ?? '';

  // ChamSys playback level: /lights/pb/{N} or /pb/{N}
  const pbLevelMatch = address.match(/\/(?:lights\/)?pb\/(\d+)$/);
  if (pbLevelMatch && deviceStates.chamsys?.playbacks) {
    const pb = deviceStates.chamsys.playbacks[pbLevelMatch[1]];
    if (pb) {
      state.level = pb.level ?? null;
      state.active = pb.active ?? false;
    }
    return state;
  }

  // ChamSys playback go: /lights/pb/{N}/go or /pb/{N}/1
  const pbGoMatch = address.match(/\/(?:lights\/)?pb\/(\d+)\/(?:go|1)$/);
  if (pbGoMatch && deviceStates.chamsys?.playbacks) {
    const pb = deviceStates.chamsys.playbacks[pbGoMatch[1]];
    if (pb) state.active = pb.active ?? false;
    return state;
  }

  // Camera preset: /cam{N}/preset/recall/{P}
  const camMatch = address.match(/\/cam(\d+)\/preset\/recall\/(\d+)$/);
  if (camMatch && deviceStates.visca) {
    state.active = deviceStates.visca.currentPreset === parseInt(camMatch[2]);
    return state;
  }

  // OBS scene: /obs/scene/{name}
  const obsSceneMatch = address.match(/\/obs\/scene\/([^/]+)$/);
  if (obsSceneMatch && deviceStates.obs) {
    state.live = deviceStates.obs.currentScene === obsSceneMatch[1];
    return state;
  }

  // OBS preview: /obs/scene/preview/{name}
  const obsPreviewMatch = address.match(/\/obs\/scene\/preview\/([^/]+)$/);
  if (obsPreviewMatch && deviceStates.obs) {
    state.active = deviceStates.obs.previewScene === obsPreviewMatch[1];
    return state;
  }

  return state;
}
