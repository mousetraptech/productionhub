import { useState } from 'react';
import type { ActionItem } from '../types';

interface DragTileProps {
  item: ActionItem;
  color: string;
  icon: string;
}

export default function DragTile({ item, color, icon }: DragTileProps) {
  const [hovering, setHovering] = useState(false);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', item.id);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        padding: '9px 12px',
        background: hovering ? color + '28' : color + '12',
        border: `1.5px solid ${hovering ? color + '77' : color + '33'}`,
        borderRadius: 10,
        cursor: 'grab',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        transition: 'all 0.15s ease',
        userSelect: 'none',
        transform: hovering ? 'translateY(-1px)' : 'none',
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1 }}>{icon}</span>
      <div>
        <div style={{ fontWeight: 600, color: '#E2E8F0', fontSize: 13, lineHeight: 1.2 }}>{item.label}</div>
        <div style={{ fontSize: 10.5, color: '#64748B', marginTop: 1 }}>{item.desc}</div>
      </div>
    </div>
  );
}
