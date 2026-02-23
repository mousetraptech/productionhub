import { useState } from 'react';

export interface CommandTileDef {
  type: string;
  label: string;
  icon: string;
  color: string;
  category: string;
}

interface CommandTileProps {
  def: CommandTileDef;
}

export default function CommandTile({ def }: CommandTileProps) {
  const [hovering, setHovering] = useState(false);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-command-type', def.type);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        padding: '9px 12px',
        background: hovering ? def.color + '28' : def.color + '12',
        border: `1.5px solid ${hovering ? def.color + '77' : def.color + '33'}`,
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
      <span style={{ fontSize: 16, lineHeight: 1 }}>{def.icon}</span>
      <span style={{ fontWeight: 600, color: '#E2E8F0', fontSize: 13, lineHeight: 1.2 }}>
        {def.label}
      </span>
    </div>
  );
}
