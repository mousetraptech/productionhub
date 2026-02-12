import { useState } from 'react';
import type { ActionCategory } from '../types';
import DragTile from './DragTile';

interface ActionPaletteProps {
  categories: ActionCategory[];
  onNewShow: () => void;
}

export default function ActionPalette({ categories, onNewShow }: ActionPaletteProps) {
  const [expandedCats, setExpandedCats] = useState<string[]>(
    categories.map(c => c.category)
  );

  // Keep expanded list in sync when categories arrive
  if (categories.length > 0 && expandedCats.length === 0) {
    setExpandedCats(categories.map(c => c.category));
  }

  const toggleCat = (cat: string) =>
    setExpandedCats(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );

  return (
    <div style={{
      width: 270, minWidth: 270,
      borderRight: '1px solid #1E293B',
      display: 'flex', flexDirection: 'column',
      background: '#020617',
    }}>
      <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #1E293B' }}>
        <div style={{
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.12em', color: '#475569',
        }}>
          Actions
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '6px 10px' }}>
        {categories.map(cat => {
          const expanded = expandedCats.includes(cat.category);
          return (
            <div key={cat.category} style={{ marginBottom: 2 }}>
              <button
                onClick={() => toggleCat(cat.category)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '9px 8px',
                  background: 'none', border: 'none',
                  color: '#94A3B8', cursor: 'pointer',
                  fontSize: 12.5, fontWeight: 600, textAlign: 'left', borderRadius: 6,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#0F172A')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                <span style={{ fontSize: 15 }}>{cat.icon}</span>
                <span style={{ flex: 1 }}>{cat.category}</span>
                <span style={{
                  fontSize: 9, transition: 'transform 0.2s',
                  transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
                }}>▼</span>
              </button>
              {expanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '3px 0 6px' }}>
                  {cat.items.map(item => (
                    <DragTile key={item.id} item={item} color={cat.color} icon={cat.icon} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ padding: '12px 14px', borderTop: '1px solid #1E293B' }}>
        <button
          onClick={onNewShow}
          style={{
            width: '100%', padding: '9px 0',
            background: '#0F172A', border: '1px solid #1E293B',
            borderRadius: 8, color: '#64748B', cursor: 'pointer',
            fontSize: 12.5, fontWeight: 600, transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#1E293B'; e.currentTarget.style.color = '#94A3B8'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#0F172A'; e.currentTarget.style.color = '#64748B'; }}
        >
          New Show
        </button>
      </div>
    </div>
  );
}
