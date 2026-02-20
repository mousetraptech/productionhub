import { useState, useMemo } from 'react';
import { ActionCategory, GridSlot, DeckButton, InlineOSC } from '../../types';
import { DeckButton as DeckButtonComponent } from './DeckButton';
import { DeckButtonEditor } from './DeckButtonEditor';
import { ActionCommandRef } from './useDeckButtonState';

interface DeckGridProps {
  grid: GridSlot[];
  editing: boolean;
  categories: ActionCategory[];
  onFire: (button: DeckButton) => void;
  onRemove: (row: number, col: number) => void;
  onAssign: (row: number, col: number, actionId: string, osc?: InlineOSC, meta?: { label: string; icon: string; color: string }) => void;
  onUpdate: (row: number, col: number, updates: Partial<DeckButton>) => void;
  onRemoveAction: (row: number, col: number, actionIndex: number) => void;
  deviceStates?: any;
}

const ROWS = 4;
const COLS = 8;

export function DeckGrid({ grid, editing, categories, onFire, onRemove, onAssign, onUpdate, onRemoveAction, deviceStates }: DeckGridProps) {
  const [editingSlot, setEditingSlot] = useState<{ row: number; col: number } | null>(null);

  // Build actionId → commands lookup for live state matching on registry actions
  const actionCommands = useMemo(() => {
    const map = new Map<string, ActionCommandRef[]>();
    for (const cat of categories) {
      for (const item of cat.items) {
        if (item.commands?.length) {
          map.set(item.id, item.commands);
        }
      }
    }
    return map;
  }, [categories]);

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
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${COLS}, 1fr)`,
        gridTemplateRows: `repeat(${ROWS}, 1fr)`,
        gap: 8, padding: 16,
        position: 'absolute', inset: 0,
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
                  border: editing ? '2px dashed #334155' : '1px solid #1E293B',
                  borderRadius: 12, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  color: '#475569', fontSize: 24,
                  transition: 'border-color 0.15s',
                  minHeight: 0,
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
              style={{ display: 'flex', minHeight: 0 }}
            >
              <DeckButtonComponent
                button={button}
                editing={editing}
                onFire={onFire}
                onRemove={() => onRemove(row, col)}
                onClick={() => editing && setEditingSlot({ row, col })}
                deviceStates={deviceStates}
                actionCommands={actionCommands}
              />
            </div>
          );
        })}
      </div>
      {editingSlot && (() => {
        const btn = getButton(editingSlot.row, editingSlot.col);
        if (!btn) return null;
        return (
          <DeckButtonEditor
            button={btn}
            row={editingSlot.row}
            col={editingSlot.col}
            onUpdate={onUpdate}
            onRemoveAction={onRemoveAction}
            onClose={() => setEditingSlot(null)}
          />
        );
      })()}
    </>
  );
}
