import { useState } from 'react';
import type { ActionCategory, InlineOSC } from '../types';

// Build a lookup map from categories
export function buildActionLookup(categories: ActionCategory[]): Record<string, {
  label: string; desc: string; icon: string; color: string; category: string;
}> {
  const map: Record<string, any> = {};
  for (const cat of categories) {
    for (const item of cat.items) {
      map[item.id] = { ...item, icon: cat.icon, color: cat.color, category: cat.category };
    }
  }
  return map;
}

const INLINE_COLOR = '#64748B';
const INLINE_ICON = '⚡';

interface ActionChipProps {
  actionId: string;
  index: number;
  expanded: boolean;
  lookup: ReturnType<typeof buildActionLookup>;
  osc?: InlineOSC;
  onRemove: (index: number) => void;
}

export default function ActionChip({ actionId, index, expanded, lookup, osc, onRemove }: ActionChipProps) {
  const info = lookup[actionId];
  const [hovering, setHovering] = useState(false);

  // Inline OSC command — render with its own style
  if (osc) {
    const color = INLINE_COLOR;
    return (
      <div
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: expanded ? 8 : 6,
          background: color + (expanded ? '25' : '18'),
          border: `1px solid ${color}${expanded ? '55' : '33'}`,
          borderRadius: expanded ? 10 : 8,
          padding: expanded ? '8px 14px' : '5px 10px',
          fontSize: expanded ? 14 : 12.5,
          transition: 'all 0.25s ease',
        }}
      >
        <span style={{ fontSize: expanded ? 18 : 14, lineHeight: 1 }}>{INLINE_ICON}</span>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{
            color: '#E2E8F0', fontWeight: 600,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: expanded ? 13 : 11.5,
          }}>
            {osc.label}
          </span>
          {expanded && (
            <span style={{ color: '#475569', fontSize: 10, marginTop: 1, fontFamily: "'JetBrains Mono', monospace" }}>
              {osc.address} {osc.args.length > 0 ? osc.args.join(' ') : ''}
            </span>
          )}
        </div>
        <button
          onClick={() => onRemove(index)}
          style={{
            background: 'none',
            border: 'none',
            color: hovering ? '#EF4444' : '#475569',
            cursor: 'pointer',
            fontSize: expanded ? 13 : 11,
            padding: '0 2px',
            marginLeft: expanded ? 4 : 2,
            transition: 'color 0.15s',
          }}
        >
          ✕
        </button>
      </div>
    );
  }

  // Registry action — original rendering
  if (!info) return null;

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: expanded ? 8 : 6,
        background: info.color + (expanded ? '25' : '18'),
        border: `1px solid ${info.color}${expanded ? '55' : '33'}`,
        borderRadius: expanded ? 10 : 8,
        padding: expanded ? '8px 14px' : '5px 10px',
        fontSize: expanded ? 14 : 12.5,
        transition: 'all 0.25s ease',
      }}
    >
      <span style={{ fontSize: expanded ? 18 : 14, lineHeight: 1 }}>{info.icon}</span>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ color: '#E2E8F0', fontWeight: 600 }}>{info.label}</span>
        {expanded && <span style={{ color: '#64748B', fontSize: 11, marginTop: 1 }}>{info.desc}</span>}
      </div>
      <button
        onClick={() => onRemove(index)}
        style={{
          background: 'none',
          border: 'none',
          color: hovering ? '#EF4444' : '#475569',
          cursor: 'pointer',
          fontSize: expanded ? 13 : 11,
          padding: '0 2px',
          marginLeft: expanded ? 4 : 2,
          transition: 'color 0.15s',
        }}
      >
        ✕
      </button>
    </div>
  );
}
