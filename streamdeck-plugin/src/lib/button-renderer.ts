import { DeckButton } from './types';
import { ButtonState } from './state-matcher';

const SIZE = 144;

/**
 * Pre-composite a color with alpha onto a black background.
 * Stream Deck LCDs have black backgrounds, so rgba looks washed out.
 */
function compositeOnBlack(r: number, g: number, b: number, alpha: number): string {
  return `rgb(${Math.round(r * alpha)},${Math.round(g * alpha)},${Math.round(b * alpha)})`;
}

/** Render a deck button as a 144x144 SVG string for Stream Deck setImage() */
export function renderButton(
  button: DeckButton | null,
  state: ButtonState,
  firing: boolean,
  pulsePhase: boolean = false,
): string {
  if (!button) return renderEmpty();

  const isToggled = !!(button.toggle && state.active);
  const displayColor = isToggled ? button.toggle!.activeColor : button.color;
  const displayIcon = isToggled ? button.toggle!.activeIcon : button.icon;
  const displayLabel = isToggled ? button.toggle!.activeLabel : button.label;

  const shouldPulse = isToggled && !!button.toggle?.pulse && pulsePhase;
  const bg = hexToRgb(displayColor);
  const bgFill = firing
    ? compositeOnBlack(bg.r, bg.g, bg.b, 0.6)
    : isToggled
      ? compositeOnBlack(bg.r, bg.g, bg.b, shouldPulse ? 0.35 : 0.55)
      : state.active
        ? compositeOnBlack(bg.r, bg.g, bg.b, 0.55)
        : compositeOnBlack(bg.r, bg.g, bg.b, 0.3);
  const borderColor = state.live
    ? '#EF4444'
    : isToggled
      ? displayColor
      : state.active
        ? '#10B981'
        : compositeOnBlack(bg.r, bg.g, bg.b, 0.5);
  const fillHeight = state.level !== null ? Math.round(state.level * SIZE) : 0;
  const fillColor = compositeOnBlack(bg.r, bg.g, bg.b, 0.7);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="#000"/>
  <rect x="2" y="2" width="${SIZE - 4}" height="${SIZE - 4}" rx="12"
    fill="${bgFill}" stroke="${borderColor}" stroke-width="3"/>
  ${fillHeight > 0 ? `<rect x="4" y="${SIZE - 2 - fillHeight}" width="${SIZE - 8}" height="${fillHeight}"
    rx="10" fill="${fillColor}"/>` : ''}
  <text x="${SIZE / 2}" y="62" text-anchor="middle" font-size="42"
    font-family="sans-serif">${escapeXml(displayIcon)}</text>
  <text x="${SIZE / 2}" y="100" text-anchor="middle" font-size="16" font-weight="600"
    font-family="sans-serif" fill="#E2E8F0">${escapeXml(truncate(displayLabel, 12))}</text>
  ${state.live ? `<circle cx="16" cy="16" r="6" fill="#EF4444"/>
  <text x="28" y="20" font-size="10" font-family="sans-serif" fill="#EF4444" font-weight="700">LIVE</text>` : ''}
  ${isToggled && !state.live ? `<circle cx="16" cy="16" r="5" fill="${displayColor}"/>` : ''}
  ${button.actions.length > 1 ? `<text x="${SIZE - 12}" y="${SIZE - 8}" text-anchor="end" font-size="13"
    font-family="sans-serif" fill="#94A3B8" font-weight="700">${button.actions.length}</text>` : ''}
</svg>`;
}

function renderEmpty(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="#000"/>
  <rect x="2" y="2" width="${SIZE - 4}" height="${SIZE - 4}" rx="12"
    fill="#1E293B" stroke="#334155" stroke-width="1"/>
</svg>`;
}

/** Render a "disconnected" state button */
export function renderDisconnected(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect width="${SIZE}" height="${SIZE}" fill="#000"/>
  <rect x="2" y="2" width="${SIZE - 4}" height="${SIZE - 4}" rx="12"
    fill="#0F172A" stroke="#334155" stroke-width="1"/>
  <text x="${SIZE / 2}" y="60" text-anchor="middle" font-size="30"
    font-family="sans-serif" fill="#475569" font-weight="700">PH</text>
  <text x="${SIZE / 2}" y="88" text-anchor="middle" font-size="12"
    font-family="sans-serif" fill="#475569">offline</text>
</svg>`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '\u2026' : s;
}
