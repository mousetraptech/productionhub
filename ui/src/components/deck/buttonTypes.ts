/**
 * Button Type System
 *
 * Semantic color types for deck buttons, matching the DMMS StreamDeck layout.
 * Each type maps to a bg/border/text color triple.
 */

export type ButtonType = 'show' | 'cue' | 'rec' | 'stream' | 'audio' | 'wall' | 'cam' | 'lx' | 'panic';

export interface ButtonTypeColors {
  bg: string;
  border: string;
  text: string;
  label: string;
}

export const BUTTON_TYPES: Record<ButtonType, ButtonTypeColors> = {
  show:   { bg: '#2a1f3d', border: '#6b4fa0', text: '#c4a3f5', label: 'Show' },
  cue:    { bg: '#1a2d20', border: '#3d7a4f', text: '#7dd99a', label: 'Cue' },
  rec:    { bg: '#2d1a1a', border: '#8b3030', text: '#f08080', label: 'Record' },
  stream: { bg: '#2d2010', border: '#8b6020', text: '#f0b060', label: 'Stream' },
  audio:  { bg: '#1a1f2d', border: '#304080', text: '#80a0f0', label: 'Audio' },
  wall:   { bg: '#2d1a28', border: '#803060', text: '#f080c0', label: 'Wall' },
  cam:    { bg: '#1a2a1a', border: '#406030', text: '#90d070', label: 'Camera' },
  lx:     { bg: '#2a2010', border: '#806020', text: '#e0b050', label: 'Lighting' },
  panic:  { bg: '#2d1010', border: '#a02020', text: '#ff6060', label: 'Panic' },
};

const DEFAULT_COLORS: ButtonTypeColors = {
  bg: '#1a1a1a', border: '#333', text: '#ccc', label: '',
};

/** Infer button type from OSC address patterns */
export function inferButtonType(label: string, oscAddress?: string): ButtonType | null {
  const lbl = label.toLowerCase();
  const addr = oscAddress?.toLowerCase() ?? '';

  if (lbl.includes('show') || addr === 'show-start' || addr === 'show-end') return 'show';
  if (lbl.includes('cue') || addr === 'go' || addr === 'standby' || addr === 'hub-back') return 'cue';
  if (lbl.includes('rec') || addr.includes('/recorder/')) return 'rec';
  if (lbl.includes('stream') || addr.includes('/obs/stream')) return 'stream';
  if (lbl.includes('mute') || lbl.includes('mics') || addr.includes('/avantis/')) return 'audio';
  if (lbl.includes('wall') || addr.includes('/td/')) return 'wall';
  if (lbl.includes('cam') || lbl.includes('obs') || lbl.includes('dual') || lbl.includes('wireless') || lbl.includes('booth') ||
      addr.includes('/cam') || addr.includes('/obs/') || addr.includes('/video/')) return 'cam';
  if (lbl.includes('lx') || lbl.includes('pre-') || lbl.includes('perf') || lbl.includes('black') ||
      addr.includes('/lights/')) return 'lx';
  if (lbl.includes('panic') || lbl.includes('qlab')) return 'panic';

  return null;
}

/** Get colors for a button, using buttonType, inference, or fallback */
export function getButtonColors(
  buttonType: ButtonType | undefined,
  label: string,
  oscAddress?: string,
  fallbackColor?: string,
): ButtonTypeColors {
  if (buttonType && BUTTON_TYPES[buttonType]) return BUTTON_TYPES[buttonType];

  const inferred = inferButtonType(label, oscAddress);
  if (inferred) return BUTTON_TYPES[inferred];

  if (fallbackColor) {
    return { bg: fallbackColor + '26', border: fallbackColor + '55', text: '#e8e8e8', label: '' };
  }

  return DEFAULT_COLORS;
}

export const EMPTY_COLORS = {
  bg: '#111',
  border: '#2a2a2a',
};

export const ROW_LABELS = [
  { num: 1, name: 'Show lifecycle\nRecord \u00b7 Stream' },
  { num: 2, name: 'Audio mutes\nBlended wall' },
  { num: 3, name: 'Cameras \u00b7 OBS\nVideo source' },
  { num: 4, name: 'Lighting\nPanic' },
];
