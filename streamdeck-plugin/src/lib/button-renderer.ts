import { ButtonState } from './state-matcher';

interface DeckAction {
  actionId: string;
  osc?: { address: string; args: any[]; label: string };
}

interface DeckButton {
  id: string;
  label: string;
  icon: string;
  color: string;
  actions: DeckAction[];
  mode: 'parallel' | 'series';
  seriesGap: number;
}

const SIZE = 96;

/** Render a deck button as a 96x96 SVG string for Stream Deck setImage() */
export function renderButton(
  button: DeckButton | null,
  state: ButtonState,
  firing: boolean,
): string {
  if (!button) return renderEmpty();

  const bg = hexToRgb(button.color);
  const bgOpacity = firing ? 0.5 : 0.15;
  const borderColor = state.live
    ? '#EF4444'
    : state.active
      ? '#10B981'
      : hexWithAlpha(button.color, 0.3);
  const fillHeight = state.level !== null ? Math.round(state.level * SIZE) : 0;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect x="1" y="1" width="${SIZE - 2}" height="${SIZE - 2}" rx="8"
    fill="rgba(${bg.r},${bg.g},${bg.b},${bgOpacity})"
    stroke="${borderColor}" stroke-width="2"/>
  ${fillHeight > 0 ? `<rect x="2" y="${SIZE - fillHeight}" width="${SIZE - 4}" height="${fillHeight - 2}"
    rx="6" fill="rgba(${bg.r},${bg.g},${bg.b},0.6)"/>` : ''}
  <text x="${SIZE / 2}" y="42" text-anchor="middle" font-size="28"
    font-family="sans-serif">${escapeXml(button.icon)}</text>
  <text x="${SIZE / 2}" y="70" text-anchor="middle" font-size="11"
    font-family="sans-serif" fill="#E2E8F0">${escapeXml(truncate(button.label, 12))}</text>
  ${state.live ? `<circle cx="10" cy="10" r="4" fill="#EF4444"/>
  <text x="18" y="13" font-size="7" font-family="sans-serif" fill="#EF4444" font-weight="700">LIVE</text>` : ''}
  ${button.actions.length > 1 ? `<text x="${SIZE - 8}" y="${SIZE - 6}" text-anchor="end" font-size="9"
    font-family="sans-serif" fill="#94A3B8" font-weight="700">${button.actions.length}</text>` : ''}
</svg>`;
}

function renderEmpty(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect x="1" y="1" width="${SIZE - 2}" height="${SIZE - 2}" rx="8"
    fill="#1E293B" stroke="#334155" stroke-width="1"/>
</svg>`;
}

/** Render a "disconnected" state button */
export function renderDisconnected(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <rect x="1" y="1" width="${SIZE - 2}" height="${SIZE - 2}" rx="8"
    fill="#0F172A" stroke="#334155" stroke-width="1"/>
  <text x="${SIZE / 2}" y="40" text-anchor="middle" font-size="20"
    font-family="sans-serif" fill="#475569" font-weight="700">PH</text>
  <text x="${SIZE / 2}" y="60" text-anchor="middle" font-size="8"
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

function hexWithAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '\u2026' : s;
}
