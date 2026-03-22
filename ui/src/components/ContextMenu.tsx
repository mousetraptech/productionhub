import { useEffect, useRef } from 'react';

const FONT_MONO = "'IBM Plex Mono', monospace";

export interface MenuItem {
  label: string;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  onClick: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Adjust position if menu would overflow viewport
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      el.style.left = `${x - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      el.style.top = `${y - rect.height}px`;
    }
  }, [x, y]);

  useEffect(() => {
    const handler = () => onClose();
    // Delay adding listener so the opening click doesn't immediately close
    const id = setTimeout(() => {
      window.addEventListener('mousedown', handler);
      window.addEventListener('contextmenu', handler);
    }, 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener('mousedown', handler);
      window.removeEventListener('contextmenu', handler);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed', left: x, top: y, zIndex: 2000,
        background: '#1c1c1c', border: '1px solid #3a3a3a',
        borderRadius: 6, padding: '4px 0',
        boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
        minWidth: 180,
      }}
      onMouseDown={e => e.stopPropagation()}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return <div key={i} style={{ height: 1, background: '#2a2a2a', margin: '4px 8px' }} />;
        }
        return (
          <div
            key={i}
            onClick={(e) => {
              e.stopPropagation();
              if (!item.disabled) {
                item.onClick();
                onClose();
              }
            }}
            style={{
              padding: '6px 14px',
              fontFamily: FONT_MONO, fontSize: 12,
              color: item.disabled ? '#444' : item.danger ? '#ef4444' : '#ccc',
              cursor: item.disabled ? 'default' : 'pointer',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => {
              if (!item.disabled) (e.currentTarget as HTMLElement).style.background = '#2a2a2a';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLElement).style.background = '';
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span style={{ fontSize: 10, color: '#555', marginLeft: 20 }}>{item.shortcut}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
