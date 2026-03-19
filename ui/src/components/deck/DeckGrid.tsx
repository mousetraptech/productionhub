import { useState, useMemo, useRef } from 'react';
import { ActionCategory, GridSlot, DeckButton, InlineOSC } from '../../types';
import { DeckButton as DeckButtonComponent } from './DeckButton';
import { DeckButtonEditor } from './DeckButtonEditor';
import { ActionCommandRef } from './useDeckButtonState';
import { ROW_LABELS, EMPTY_COLORS } from './buttonTypes';

interface DeckGridProps {
  grid: GridSlot[];
  editing: boolean;
  categories: ActionCategory[];
  onFire: (button: DeckButton) => void;
  onRemove: (row: number, col: number) => void;
  onAssign: (row: number, col: number, actionId: string, osc?: InlineOSC, meta?: { label: string; icon: string; color: string }, toggle?: DeckButton['toggle']) => void;
  onUpdate: (row: number, col: number, updates: Partial<DeckButton>) => void;
  onRemoveAction: (row: number, col: number, actionIndex: number) => void;
  onSwap?: (fromRow: number, fromCol: number, toRow: number, toCol: number) => void;
  onCommandDrop?: (row: number, col: number, commandType: string) => void;
  deviceStates?: any;
  showActive?: boolean;
}

const ROWS = 4;
const COLS = 8;
const FONT_MONO = "'IBM Plex Mono', monospace";
const FONT_SANS = "'IBM Plex Sans', sans-serif";

export function DeckGrid({ grid, editing, categories, onFire, onRemove, onAssign, onUpdate, onRemoveAction, onSwap, onCommandDrop, deviceStates, showActive }: DeckGridProps) {
  const [editingSlot, setEditingSlot] = useState<{ row: number; col: number } | null>(null);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);
  const dragSrcRef = useRef<{ row: number; col: number } | null>(null);

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

  // --- Drag handlers ---

  const handleDragStart = (e: React.DragEvent, row: number, col: number) => {
    if (!editing) return;
    const button = getButton(row, col);
    if (button) {
      dragSrcRef.current = { row, col };
      e.dataTransfer.setData('application/x-deck-swap', JSON.stringify({ row, col }));
      e.dataTransfer.effectAllowed = 'move';
      (e.currentTarget as HTMLElement).style.opacity = '0.4';
      (e.currentTarget as HTMLElement).style.transform = 'scale(0.95)';
    }
  };

  const handleDragEnd = (e: React.DragEvent) => {
    dragSrcRef.current = null;
    setDragOverCell(null);
    (e.currentTarget as HTMLElement).style.opacity = '';
    (e.currentTarget as HTMLElement).style.transform = '';
  };

  const handleDragOver = (e: React.DragEvent, row: number, col: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverCell(`${row}-${col}`);
  };

  const handleDragLeave = () => {
    setDragOverCell(null);
  };

  const handleDrop = (e: React.DragEvent, row: number, col: number) => {
    e.preventDefault();
    setDragOverCell(null);
    if (!editing) return;

    // Try deck swap first
    const swapData = e.dataTransfer.getData('application/x-deck-swap');
    if (swapData && onSwap) {
      const src = JSON.parse(swapData);
      if (src.row !== row || src.col !== col) {
        onSwap(src.row, src.col, row, col);
      }
      return;
    }

    // Try command type (CommandTile drag)
    const cmdType = e.dataTransfer.getData('application/x-command-type');
    if (cmdType) {
      onCommandDrop?.(row, col, cmdType);
      return;
    }

    // Try application/json (inline OSC)
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
      // Auto-configure show-toggle as a toggle button
      const toggle = actionId === 'show-toggle'
        ? {
            activeLabel: 'End Show',
            activeIcon: '🔴',
            activeColor: '#DC2626',
            activeActions: [{ actionId: 'show-toggle' }],
            pulse: true,
          }
        : undefined;
      onAssign(row, col, actionId, undefined, meta, toggle);
    }
  };

  return (
    <>
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 4,
        padding: 16,
        position: 'absolute', inset: 0,
        overflow: 'auto',
      }}>
        {Array.from({ length: ROWS }, (_, ri) => {
          const rowLabel = ROW_LABELS[ri];
          return (
            <div key={ri} style={{ display: 'flex', gap: 4, flex: 1, minHeight: 70 }}>
              {/* Row label */}
              <div style={{
                width: 130, flexShrink: 0,
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
                padding: '0 12px 0 0',
                borderRight: '1px solid #2a2a2a',
                marginRight: 4,
              }}>
                <div style={{
                  fontFamily: FONT_MONO, fontSize: 10, color: '#555',
                  letterSpacing: '0.1em', marginBottom: 2,
                }}>
                  ROW {rowLabel?.num ?? ri + 1}
                </div>
                <div style={{
                  fontFamily: FONT_SANS, fontSize: 11, color: '#888',
                  lineHeight: 1.3, whiteSpace: 'pre-line',
                }}>
                  {rowLabel?.name ?? ''}
                </div>
              </div>

              {/* Button grid for this row */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${COLS}, 1fr)`,
                gap: 4, flex: 1,
              }}>
                {Array.from({ length: COLS }, (_, ci) => {
                  const button = getButton(ri, ci);
                  const cellKey = `${ri}-${ci}`;
                  const isOver = dragOverCell === cellKey;

                  if (!button) {
                    return (
                      <div
                        key={cellKey}
                        draggable={false}
                        onDragOver={(e) => handleDragOver(e, ri, ci)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, ri, ci)}
                        style={{
                          background: isOver ? '#1a1508' : EMPTY_COLORS.bg,
                          border: `1px ${editing ? 'dashed' : 'solid'} ${isOver ? '#c8a96e' : EMPTY_COLORS.border}`,
                          borderRadius: 3,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          minHeight: 62,
                          transition: 'border-color 0.15s, background 0.15s',
                        }}
                      >
                        {editing && (
                          <span style={{
                            fontSize: 16, opacity: 0.2, color: '#555',
                            fontFamily: FONT_MONO, pointerEvents: 'none',
                          }}>+</span>
                        )}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={cellKey}
                      draggable={editing}
                      onDragStart={(e) => handleDragStart(e, ri, ci)}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => handleDragOver(e, ri, ci)}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => handleDrop(e, ri, ci)}
                      style={{
                        display: 'flex', minHeight: 62,
                        cursor: editing ? 'grab' : undefined,
                        boxShadow: isOver ? '0 0 0 2px #c8a96e' : 'none',
                        transform: isOver ? 'scale(1.05)' : 'none',
                        transition: 'transform 0.1s, box-shadow 0.1s',
                        borderRadius: 3,
                      }}
                    >
                      <DeckButtonComponent
                        button={button}
                        editing={editing}
                        onFire={onFire}
                        onRemove={() => onRemove(ri, ci)}
                        onClick={() => editing && setEditingSlot({ row: ri, col: ci })}
                        deviceStates={deviceStates}
                        actionCommands={actionCommands}
                        showActive={showActive}
                      />
                    </div>
                  );
                })}
              </div>
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
