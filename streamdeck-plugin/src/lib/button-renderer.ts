import { DeckButton } from './types';
import { ButtonState } from './state-matcher';

const SIZE = 144;
// Icons are drawn in 48x48 space. Scale 1.8x and center in 144px button, above label.
// Center point: (72, 46). Offset: 72 - 24*1.8 = 28.8, 46 - 24*1.8 = 2.8
const ICON_SCALE = 1.8;
const FONT = '-apple-system, SF Pro, Helvetica, sans-serif';

// ---------------------------------------------------------------------------
// SVG Icon paths — drawn in a 48x48 coordinate space
// ---------------------------------------------------------------------------

const ICON_PATHS: Record<string, string> = {
  mic: `
    <rect x="16" y="2" width="16" height="28" rx="8" fill="currentColor"/>
    <path d="M10 24v2c0 8 6 14 14 14s14-6 14-14v-2" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="24" y1="40" x2="24" y2="46" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="16" y1="46" x2="32" y2="46" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>`,

  micMuted: `
    <rect x="16" y="2" width="16" height="28" rx="8" fill="currentColor"/>
    <path d="M10 24v2c0 8 6 14 14 14s14-6 14-14v-2" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="24" y1="40" x2="24" y2="46" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="16" y1="46" x2="32" y2="46" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="6" y1="6" x2="42" y2="42" stroke="#EF4444" stroke-width="4" stroke-linecap="round"/>`,

  record: `<circle cx="24" cy="24" r="16" fill="currentColor"/>`,

  stop: `<rect x="6" y="6" width="36" height="36" rx="4" fill="currentColor"/>`,

  play: `<polygon points="10,4 42,24 10,44" fill="currentColor"/>`,

  camera: `
    <rect x="2" y="10" width="32" height="28" rx="4" fill="currentColor"/>
    <polygon points="36,16 46,10 46,38 36,32" fill="currentColor"/>`,

  obs: `
    <rect x="2" y="4" width="44" height="32" rx="4" fill="none" stroke="currentColor" stroke-width="3.5"/>
    <polygon points="17,12 33,20 17,28" fill="currentColor"/>
    <line x1="14" y1="42" x2="34" y2="42" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>`,

  speaker: `
    <polygon points="4,16 4,32 12,32 22,42 22,6 12,16" fill="currentColor"/>
    <path d="M28 14c4 3 6 7 6 10s-2 7-6 10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <path d="M34 8c6 5 9 11 9 16s-3 11-9 16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`,

  light: `
    <path d="M16 30c-2-2-4-6-4-10 0-8 6-14 12-14s12 6 12 14c0 4-2 8-4 10" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
    <line x1="24" y1="0" x2="24" y2="3" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <line x1="8" y1="6" x2="10" y2="8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <line x1="40" y1="6" x2="38" y2="8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <line x1="4" y1="20" x2="7" y2="20" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <line x1="44" y1="20" x2="41" y2="20" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <rect x="17" y="34" width="14" height="8" rx="3" fill="currentColor"/>
    <line x1="19" y1="46" x2="29" y2="46" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>`,

  laptop: `
    <rect x="6" y="6" width="36" height="24" rx="3" fill="none" stroke="currentColor" stroke-width="3.5"/>
    <path d="M2 34h44v4c0 2-2 4-4 4H6c-2 0-4-2-4-4z" fill="currentColor"/>`,

  wireless: `
    <circle cx="24" cy="38" r="4" fill="currentColor"/>
    <path d="M12 28c3-4 7-6 12-6s9 2 12 6" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M4 20c6-6 12-10 20-10s14 4 20 10" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>`,

  folder: `<path d="M4 10c0-3 2-5 5-5h10l6 7h14c3 0 5 2 5 5v22c0 3-2 5-5 5H9c-3 0-5-2-5-5z" fill="currentColor"/>`,

  back: `<polyline points="28,8 12,24 28,40" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,

  panic: `
    <path d="M24 2L46 42H2z" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linejoin="round"/>
    <line x1="24" y1="16" x2="24" y2="28" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
    <circle cx="24" cy="35" r="2.5" fill="currentColor"/>`,

  power: `
    <line x1="24" y1="8" x2="24" y2="20" stroke="currentColor" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M14 13C9 17 6 23 7 29c2 8 10 15 17 15s15-7 17-15c1-6-2-12-7-16" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`,

  scene: `
    <rect x="2" y="14" width="44" height="30" rx="3" fill="currentColor"/>
    <path d="M6 14L14 4h8l-8 10z M20 14l8-10h8l-8 10z M34 14l8-10h4l-4 10z" fill="currentColor" opacity="0.6"/>`,

  fader: `
    <rect x="21" y="2" width="6" height="44" rx="3" fill="currentColor" opacity="0.3"/>
    <rect x="14" y="16" width="20" height="12" rx="3" fill="currentColor"/>`,

  dca: `
    <rect x="5" y="2" width="4" height="44" rx="2" fill="currentColor" opacity="0.25"/>
    <rect x="17" y="2" width="4" height="44" rx="2" fill="currentColor" opacity="0.25"/>
    <rect x="29" y="2" width="4" height="44" rx="2" fill="currentColor" opacity="0.25"/>
    <rect x="41" y="2" width="4" height="44" rx="2" fill="currentColor" opacity="0.25"/>
    <rect x="1" y="12" width="12" height="8" rx="2" fill="currentColor"/>
    <rect x="13" y="24" width="12" height="8" rx="2" fill="currentColor"/>
    <rect x="25" y="8" width="12" height="8" rx="2" fill="currentColor"/>
    <rect x="37" y="28" width="12" height="8" rx="2" fill="currentColor"/>`,

  transition: `
    <rect x="2" y="6" width="20" height="20" rx="3" fill="currentColor" opacity="0.4"/>
    <rect x="18" y="14" width="20" height="20" rx="3" fill="currentColor"/>
    <polygon points="42,22 48,28 42,34" fill="currentColor"/>`,
};

// ---------------------------------------------------------------------------
// Icon inference — map action/label/address to an icon key
// ---------------------------------------------------------------------------

function inferIcon(label: string, oscAddress?: string, isToggled?: boolean): string | null {
  const lbl = label.toLowerCase();
  const addr = oscAddress?.toLowerCase() ?? '';

  // Mute states
  if (isToggled && (lbl.includes('mute') || addr.includes('/mute'))) return 'micMuted';
  if (lbl.includes('mute') || addr.includes('/mute')) return 'mic';

  // Show lifecycle
  if (lbl.includes('start show') || lbl.includes('end show') || lbl === 'show-toggle') return 'power';
  if (lbl === 'rec' || lbl.includes('record') || addr.includes('/recorder/start')) return 'record';
  if (lbl === 'stop' || addr.includes('/recorder/stop')) return 'stop';

  // SFX / QLab
  if (lbl.includes('sfx') && lbl.includes('go')) return 'play';
  if (lbl.includes('sfx') || addr.includes('/sfx/')) return 'speaker';
  if (lbl.includes('qlab') || addr.includes('/show/go')) return 'scene';

  // Cameras
  if (lbl.includes('cam') || addr.includes('/cam')) return 'camera';

  // OBS
  if (lbl.includes('cut') || lbl.includes('transition') || addr.includes('/transition')) return 'transition';
  if (lbl.includes('obs') || lbl.includes('pvw') || lbl.includes('house') || lbl.includes('center') ||
      lbl.includes('booth') || addr.includes('/obs/')) return 'obs';

  // Video source
  if (lbl.includes('guest') || lbl.includes('laptop') || addr.includes('/video/input/1')) return 'laptop';
  if (lbl.includes('wireless') || addr.includes('/video/input/3')) return 'wireless';

  // Audio
  if (lbl.includes('rf') || (addr.includes('/avantis/ch/') && addr.includes('/mute'))) return 'mic';
  if (lbl.includes('dca') || addr.includes('/dca/')) return 'dca';
  if (lbl.includes('fader') || (addr.includes('/avantis/ch/') && addr.includes('/fader'))) return 'fader';
  if (lbl.includes('scene') || addr.includes('/scene/recall')) return 'scene';

  // Lighting
  if (lbl.includes('lx') || lbl.includes('light') || lbl.includes('house') ||
      lbl.includes('blackout') || lbl.includes('pre-') || lbl.includes('perf') ||
      addr.includes('/lights/')) return 'light';

  // Panic
  if (lbl.includes('panic')) return 'panic';

  // Folders
  if (lbl.includes('back') || lbl.includes('\u25C0')) return 'back';

  return null;
}

// ---------------------------------------------------------------------------
// Color palette — matches the preview page
// ---------------------------------------------------------------------------

interface ColorPair { bg: string; text: string }

const COLOR_MAP: Record<string, ColorPair> = {
  show:    { bg: '#6b4fa0', text: '#c4a3f5' },
  rec:     { bg: '#DC2626', text: '#FCA5A5' },
  audio:   { bg: '#2563EB', text: '#93C5FD' },
  mute:    { bg: '#DC2626', text: '#FCA5A5' },
  cam:     { bg: '#0D9488', text: '#5EEAD4' },
  obs:     { bg: '#7C3AED', text: '#C4B5FD' },
  lx:      { bg: '#D97706', text: '#FCD34D' },
  sfx:     { bg: '#6366F1', text: '#A5B4FC' },
  video:   { bg: '#7C3AED', text: '#C4B5FD' },
  panic:   { bg: '#DC2626', text: '#FF6B6B' },
  folder:  { bg: '#4F46E5', text: '#A5B4FC' },
  nav:     { bg: '#334155', text: '#94A3B8' },
  go:      { bg: '#16A34A', text: '#86EFAC' },
};

function inferColorCategory(label: string, oscAddress?: string, isToggled?: boolean): string {
  const lbl = label.toLowerCase();
  const addr = oscAddress?.toLowerCase() ?? '';

  if (isToggled && (lbl.includes('mute') || addr.includes('/mute'))) return 'mute';
  if (lbl.includes('start show') || lbl.includes('end show') || lbl === 'show-toggle') return 'show';
  if (lbl === 'rec' || lbl.includes('record') || addr.includes('/recorder/')) return 'rec';
  if (lbl === 'stop' || addr.includes('/stop')) return 'rec';
  if (lbl.includes('sfx') && lbl.includes('go')) return 'go';
  if (lbl.includes('sfx') || addr.includes('/sfx/')) return 'sfx';
  if (lbl.includes('cam') || addr.includes('/cam')) return 'cam';
  if (lbl.includes('obs') || lbl.includes('pvw') || lbl.includes('house') || lbl.includes('center') ||
      lbl.includes('cut') || lbl.includes('transition') || addr.includes('/obs/')) return 'obs';
  if (lbl.includes('guest') || lbl.includes('wireless') || addr.includes('/video/')) return 'video';
  if (lbl.includes('mute') || lbl.includes('rf') || lbl.includes('dca') || lbl.includes('fader') ||
      lbl.includes('scene') || addr.includes('/avantis/')) return 'audio';
  if (lbl.includes('lx') || lbl.includes('light') || lbl.includes('blackout') ||
      lbl.includes('pre-') || lbl.includes('perf') || addr.includes('/lights/')) return 'lx';
  if (lbl.includes('panic')) return 'panic';
  if (lbl.includes('back') || lbl.includes('\u25C0')) return 'nav';

  return '';
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function compositeOnBlack(r: number, g: number, b: number, alpha: number): string {
  return `rgb(${Math.round(r * alpha)},${Math.round(g * alpha)},${Math.round(b * alpha)})`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0,
  };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '\u2026' : s;
}

/** Render a deck button as a 144x144 SVG string for Stream Deck setImage() */
export function renderButton(
  button: DeckButton | null,
  state: ButtonState,
  firing: boolean,
  pulsePhase: boolean = false,
): string {
  if (!button) return renderEmpty();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  ${renderButtonFull(button, state, firing, SIZE, SIZE, pulsePhase)}
</svg>`;
}

/** Render button content at an arbitrary width/height (for span composites) */
function renderButtonFull(
  button: DeckButton,
  state: ButtonState,
  firing: boolean,
  w: number,
  h: number,
  pulsePhase: boolean = false,
): string {
  const isToggled = !!(button.toggle && state.active);
  const displayLabel = isToggled ? button.toggle!.activeLabel : button.label;

  // Resolve icon and color category
  const firstOsc = button.actions[0]?.osc?.address;
  // Explicit button.icon takes priority if it matches a known icon key
  const explicitIcon = button.icon && ICON_PATHS[button.icon] ? button.icon : null;
  const iconKey = button.group ? 'folder'
    : explicitIcon
    ?? inferIcon(displayLabel, firstOsc, isToggled)
    ?? inferIcon(button.label, firstOsc, false);
  // Vivid buttons skip category inference and use button.color directly
  const colorCat = button.vivid ? '' : (button.group ? 'folder'
    : inferColorCategory(displayLabel, firstOsc, isToggled)
    || inferColorCategory(button.label, firstOsc, false));

  // Use inferred color palette or fall back to button.color
  const palette = COLOR_MAP[colorCat];
  const bgHex = palette?.bg ?? button.color ?? '#475569';
  const textColor = palette?.text ?? '#E2E8F0';
  const bg = hexToRgb(bgHex);

  const shouldPulse = isToggled && !!button.toggle?.pulse && pulsePhase;
  // Vivid buttons render at near-full intensity always; firing flashes brighter still
  const bgFill = button.vivid
    ? compositeOnBlack(bg.r, bg.g, bg.b, firing ? 1.0 : 0.85)
    : firing
      ? compositeOnBlack(bg.r, bg.g, bg.b, 0.6)
      : isToggled
        ? compositeOnBlack(bg.r, bg.g, bg.b, shouldPulse ? 0.35 : 0.55)
        : state.active
          ? compositeOnBlack(bg.r, bg.g, bg.b, 0.55)
          : compositeOnBlack(bg.r, bg.g, bg.b, 0.2);

  const borderColor = state.live
    ? '#EF4444'
    : isToggled
      ? bgHex
      : state.active
        ? '#10B981'
        : compositeOnBlack(bg.r, bg.g, bg.b, 0.4);

  // Fill bar for fader levels
  const fillHeight = state.level !== null ? Math.round(state.level * h) : 0;
  const fillColor = compositeOnBlack(bg.r, bg.g, bg.b, 0.7);

  // Icon SVG — scale relative to composite size
  const iconScale = Math.min(w, h) / SIZE * ICON_SCALE;
  const iconTx = `translate(${w / 2 - 24 * iconScale},${h * 0.32 - 24 * iconScale}) scale(${iconScale})`;
  const iconPath = iconKey ? ICON_PATHS[iconKey] : null;
  const iconSvg = iconPath
    ? `<g transform="${iconTx}">${iconPath.replace(/currentColor/g, textColor)}</g>`
    : '';

  // Label sizing — scale for larger composites
  const maxLabelLen = w > SIZE ? 20 : 14;
  const labelText = truncate(displayLabel, maxLabelLen);
  const baseFontSize = labelText.length > 10 ? 13 : labelText.length > 7 ? 15 : 17;
  const labelSize = Math.round(baseFontSize * (Math.min(w, h) / SIZE));
  const labelY = Math.round(h * 0.8);

  // Group badge (item count)
  const groupBadge = button.group
    ? `<circle cx="${w - 18}" cy="18" r="11" fill="${bgHex}"/>
       <text x="${w - 18}" y="23" text-anchor="middle" font-size="13" font-weight="700" font-family="${FONT}" fill="#fff">${button.group.length}</text>`
    : '';

  return `
  <rect width="${w}" height="${h}" fill="#000"/>
  <rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="12"
    fill="${bgFill}" stroke="${borderColor}" stroke-width="2.5"/>
  ${fillHeight > 0 ? `<rect x="5" y="${h - 3 - fillHeight}" width="${w - 10}" height="${fillHeight}"
    rx="10" fill="${fillColor}"/>` : ''}
  ${iconSvg}
  <text x="${w / 2}" y="${labelY}" text-anchor="middle" font-size="${labelSize}" font-weight="600"
    font-family="${FONT}" fill="${textColor}">${escapeXml(labelText)}</text>
  ${state.live ? `<circle cx="16" cy="16" r="6" fill="#EF4444"/>
  <text x="28" y="20" font-size="10" font-family="${FONT}" fill="#EF4444" font-weight="700">LIVE</text>` : ''}
  ${state.active && !state.live && !isToggled ? `<circle cx="16" cy="16" r="5" fill="#10B981"/>` : ''}
  ${isToggled && !state.live ? `<circle cx="16" cy="16" r="5" fill="${bgHex}"/>` : ''}
  ${groupBadge}
  ${button.actions.length > 1 && !button.group ? `<text x="${w - 10}" y="${h - 8}" text-anchor="end" font-size="12"
    font-family="${FONT}" fill="${textColor}" opacity="0.5" font-weight="700">${button.actions.length}</text>` : ''}`;
}

/**
 * Render a single tile of a spanned button.
 * Renders the full composite at (cols*SIZE x rows*SIZE), then uses a viewBox
 * to extract the tile at (tileCol, tileRow).
 */
export function renderSpanTile(
  button: DeckButton,
  state: ButtonState,
  firing: boolean,
  tileRow: number,
  tileCol: number,
  spanCols: number,
  spanRows: number,
  pulsePhase: boolean = false,
): string {
  const fullW = SIZE * spanCols;
  const fullH = SIZE * spanRows;
  const inner = renderButtonFull(button, state, firing, fullW, fullH, pulsePhase);
  const dx = -tileCol * SIZE;
  const dy = -tileRow * SIZE;
  // Use a translate transform instead of a non-zero viewBox origin —
  // some SVG renderers (including Stream Deck's) don't handle viewBox
  // origins correctly and clip content to the natural pixel area.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <g transform="translate(${dx}, ${dy})">
    ${inner}
  </g>
</svg>`;
}

function renderEmpty(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="#000"/>
  <rect x="3" y="3" width="${SIZE - 6}" height="${SIZE - 6}" rx="12"
    fill="#1E293B" stroke="#334155" stroke-width="1"/>
</svg>`;
}

/** Render a "disconnected" state button */
export function renderDisconnected(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="#000"/>
  <rect x="3" y="3" width="${SIZE - 6}" height="${SIZE - 6}" rx="12"
    fill="#0F172A" stroke="#334155" stroke-width="1"/>
  <text x="${SIZE / 2}" y="60" text-anchor="middle" font-size="30"
    font-family="${FONT}" fill="#475569" font-weight="700">PH</text>
  <text x="${SIZE / 2}" y="88" text-anchor="middle" font-size="12"
    font-family="${FONT}" fill="#475569">offline</text>
</svg>`;
}
