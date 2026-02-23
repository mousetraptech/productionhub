import { DeckButton, DeviceStates } from './types';

export interface ActionCommandRef {
  device: string;
  prefix?: string;
  address: string;
}

export interface ButtonState {
  level: number | null;
  active: boolean;
  live: boolean;
}

// Map OSC address prefix to Avantis driver StripType key
const oscToStripKey: Record<string, string> = {
  ch: 'input', mix: 'mix', fxsend: 'fxsend', fxrtn: 'fxreturn',
  dca: 'dca', grp: 'group', mtx: 'matrix', main: 'main',
};

export function getDeckButtonState(
  button: DeckButton,
  deviceStates: DeviceStates,
  actionCommands?: Map<string, ActionCommandRef[]>,
): ButtonState {
  const state: ButtonState = { level: null, active: false, live: false };
  if (!button.actions.length) return state;

  const firstAction = button.actions[0];

  // Resolve address and device type: inline OSC or registry action lookup
  let address = firstAction.osc?.address ?? '';
  let deviceType = '';
  if (!address && firstAction.actionId && actionCommands) {
    const cmds = actionCommands.get(firstAction.actionId);
    if (cmds?.length) {
      const cmd = cmds[0];
      deviceType = cmd.device;
      address = cmd.address;  // bare address without routing prefix
    }
  }

  // Determine device type from address prefix if not from registry
  if (!deviceType && address) {
    if (address.startsWith('/avantis/')) deviceType = 'avantis';
    else if (address.startsWith('/lights/') || address.match(/^\/pb\//)) deviceType = 'chamsys';
    else if (address.startsWith('/obs/')) deviceType = 'obs';
    else if (address.match(/^\/cam\d+\//)) deviceType = 'visca';
    else if (address.startsWith('/recorder/')) deviceType = 'ndi-recorder';
  }

  // --- ChamSys ---
  if (deviceType === 'chamsys' && deviceStates.chamsys?.playbacks) {
    // Playback level: /pb/{N}
    const pbLevelMatch = address.match(/\/pb\/(\d+)$/);
    if (pbLevelMatch) {
      const pb = deviceStates.chamsys.playbacks[pbLevelMatch[1]];
      if (pb) {
        state.level = pb.level ?? null;
        state.active = pb.active ?? false;
      }
      return state;
    }
    // Playback go: /pb/{N}/go or /pb/{N}/1
    const pbGoMatch = address.match(/\/pb\/(\d+)\/(?:go|1)$/);
    if (pbGoMatch) {
      const pb = deviceStates.chamsys.playbacks[pbGoMatch[1]];
      if (pb) state.active = pb.active ?? false;
      return state;
    }
  }

  // --- VISCA Camera ---
  if (deviceType === 'visca' && deviceStates.visca) {
    const presetMatch = address.match(/\/preset\/recall\/(\d+)$/);
    if (presetMatch) {
      state.active = deviceStates.visca.currentPreset === parseInt(presetMatch[1]);
      return state;
    }
  }

  // --- OBS ---
  if (deviceType === 'obs' && deviceStates.obs) {
    const sceneMatch = address.match(/\/scene\/([^/]+)$/);
    if (sceneMatch) {
      state.live = deviceStates.obs.currentScene === sceneMatch[1];
      return state;
    }
    const previewMatch = address.match(/\/scene\/preview\/([^/]+)$/);
    if (previewMatch) {
      state.active = deviceStates.obs.previewScene === previewMatch[1];
      return state;
    }
  }

  // --- NDI Recorder ---
  if (deviceType === 'ndi-recorder') {
    const recState = (deviceStates as any)['ndi-recorder'];
    if (recState) {
      state.active = recState.state === 'recording';
    }
    return state;
  }

  // --- Avantis ---
  if (deviceType === 'avantis' && deviceStates.avantis?.strips) {
    // Fader: /ch/{N}/mix/fader, /dca/{N}/fader, /grp/{N}/mix/fader, etc.
    const faderMatch = address.match(/\/(ch|dca|grp|mix|mtx|fxsend|fxrtn|main)\/(?:(\d+)\/)?(?:mix\/)?fader$/);
    if (faderMatch) {
      const oscPrefix = faderMatch[1];
      const driverKey = oscToStripKey[oscPrefix] ?? oscPrefix;
      const stripKey = faderMatch[2] ? `${driverKey}/${faderMatch[2]}` : driverKey;
      const strip = deviceStates.avantis.strips[stripKey];
      if (strip) state.level = strip.fader ?? null;
      return state;
    }
    // Mute: /ch/{N}/mix/mute, /dca/{N}/mute
    const muteMatch = address.match(/\/(ch|dca|grp|mix|mtx)\/(\d+)\/(?:mix\/)?mute$/);
    if (muteMatch) {
      const driverKey = oscToStripKey[muteMatch[1]] ?? muteMatch[1];
      const stripKey = `${driverKey}/${muteMatch[2]}`;
      const strip = deviceStates.avantis.strips[stripKey];
      if (strip) state.active = strip.mute === true;
      return state;
    }
  }

  // Fallback for inline OSC with full routing prefix (backward compat)
  if (!deviceType && address) {
    // ChamSys with /lights/ prefix
    const pbMatch = address.match(/\/lights\/pb\/(\d+)$/);
    if (pbMatch && deviceStates.chamsys?.playbacks) {
      const pb = deviceStates.chamsys.playbacks[pbMatch[1]];
      if (pb) { state.level = pb.level ?? null; state.active = pb.active ?? false; }
      return state;
    }
    // Camera with /cam{N}/ prefix
    const camMatch = address.match(/\/cam(\d+)\/preset\/recall\/(\d+)$/);
    if (camMatch && deviceStates.visca) {
      state.active = deviceStates.visca.currentPreset === parseInt(camMatch[2]);
      return state;
    }
    // OBS with /obs/ prefix
    const obsMatch = address.match(/\/obs\/scene\/([^/]+)$/);
    if (obsMatch && deviceStates.obs) {
      state.live = deviceStates.obs.currentScene === obsMatch[1];
      return state;
    }
    // Recorder with /recorder/ prefix
    if (address.startsWith('/recorder/')) {
      const recState = (deviceStates as any)['ndi-recorder'];
      if (recState) {
        state.active = recState.state === 'recording';
      }
      return state;
    }
    // Avantis with /avantis/ prefix
    const avMatch = address.match(/\/avantis\/(ch|dca|grp|mix|mtx|fxsend|fxrtn|main)\/(?:(\d+)\/)?(?:mix\/)?fader$/);
    if (avMatch && deviceStates.avantis?.strips) {
      const driverKey = oscToStripKey[avMatch[1]] ?? avMatch[1];
      const stripKey = avMatch[2] ? `${driverKey}/${avMatch[2]}` : driverKey;
      const strip = deviceStates.avantis.strips[stripKey];
      if (strip) state.level = strip.fader ?? null;
      return state;
    }
    // Avantis mute with /avantis/ prefix
    const avMuteMatch = address.match(/\/avantis\/(ch|dca|grp|mix|mtx)\/(\d+)\/(?:mix\/)?mute$/);
    if (avMuteMatch && deviceStates.avantis?.strips) {
      const driverKey = oscToStripKey[avMuteMatch[1]] ?? avMuteMatch[1];
      const stripKey = `${driverKey}/${avMuteMatch[2]}`;
      const strip = deviceStates.avantis.strips[stripKey];
      if (strip) state.active = strip.mute === true;
      return state;
    }
  }

  return state;
}
