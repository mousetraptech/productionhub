import { ActionCategory, GridSlot, DeckButton, InlineOSC } from '../../types';

interface DeckGridProps {
  grid: GridSlot[];
  editing: boolean;
  categories: ActionCategory[];
  onFire: (button: DeckButton) => void;
  onRemove: (row: number, col: number) => void;
  onAssign: (row: number, col: number, actionId: string, osc?: InlineOSC, meta?: { label: string; icon: string; color: string }) => void;
}

const ROWS = 4;
const COLS = 8;

export function DeckGrid({ grid, editing, categories, onFire, onRemove, onAssign }: DeckGridProps) {
  const getButton = (row: number, col: number): DeckButton | null => {
    const slot = grid.find(s => s.row === row && s.col === col);
    return slot?.button ?? null;
  };

  const handleDrop = (e: React.DragEvent, row: number, col: number) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).style.borderColor = '';
    if (!editing) return;

    // Try application/json first (inline OSC from CommandBuilder)
    const jsonData = e.dataTransfer.getData('application/json');
    if (jsonData) {
      try {
        const { actionId, osc } = JSON.parse(jsonData);
        onAssign(row, col, actionId, osc, { label: osc?.label ?? actionId, icon: '', color: '#64748B' });
        return;
      } catch {}
    }

    // Fall back to text/plain (registry action ID)
    const actionId = e.dataTransfer.getData('text/plain');
    if (actionId) {
      let meta = { label: actionId, icon: '', color: '#3B82F6' };
      for (const cat of categories) {
        const item = cat.items.find(i => i.id === actionId);
        if (item) {
          meta = { label: item.label, icon: cat.icon, color: cat.color };
          break;
        }
      }
      onAssign(row, col, actionId, undefined, meta);
    }
  };

  const dragHandlers = (row: number, col: number) => editing ? {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
    onDragEnter: (e: React.DragEvent) => { e.preventDefault(); (e.currentTarget as HTMLElement).style.borderColor = '#3B82F6'; },
    onDragLeave: (e: React.DragEvent) => { (e.currentTarget as HTMLElement).style.borderColor = ''; },
    onDrop: (e: React.DragEvent) => handleDrop(e, row, col),
  } : {};

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${COLS}, 1fr)`,
      gridTemplateRows: `repeat(${ROWS}, 1fr)`,
      gap: 8, padding: 16, flex: 1,
    }}>
      {Array.from({ length: ROWS * COLS }, (_, i) => {
        const row = Math.floor(i / COLS);
        const col = i % COLS;
        const button = getButton(row, col);

        if (!button) {
          return (
            <div
              key={`${row}-${col}`}
              {...dragHandlers(row, col)}
              style={{
                border: editing ? '2px dashed #334155' : '2px solid transparent',
                borderRadius: 12, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                color: '#475569', fontSize: 24,
                aspectRatio: '1',
                transition: 'border-color 0.15s',
              }}
            >
              {editing ? '+' : ''}
            </div>
          );
        }

        return (
          <div
            key={`${row}-${col}`}
            {...dragHandlers(row, col)}
            onPointerDown={() => !editing && onFire(button)}
            style={{
              background: button.color + '26',
              border: `2px solid ${button.color}55`,
              borderRadius: 12,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              cursor: editing ? 'default' : 'pointer',
              userSelect: 'none',
              position: 'relative',
              aspectRatio: '1',
              transition: 'transform 0.1s, box-shadow 0.1s',
            }}
          >
            <span style={{ fontSize: 24 }}>{button.icon}</span>
            <span style={{
              fontSize: 11, color: '#E2E8F0', marginTop: 4,
              textAlign: 'center', padding: '0 4px',
              overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', maxWidth: '100%',
            }}>
              {button.label}
            </span>
            {button.actions.length > 1 && (
              <span style={{
                position: 'absolute', top: 4, right: 6,
                fontSize: 9, color: '#94A3B8', fontWeight: 700,
              }}>
                {button.actions.length}
              </span>
            )}
            {editing && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(row, col); }}
                style={{
                  position: 'absolute', top: -6, right: -6,
                  background: '#EF4444', color: '#FFF', border: 'none',
                  borderRadius: '50%', width: 20, height: 20,
                  fontSize: 12, cursor: 'pointer', lineHeight: '20px',
                  padding: 0,
                }}
              >
                x
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
