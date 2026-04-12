import { useState, useMemo, useRef, useCallback } from 'react';
import { ActionCategory, GridSlot, DeckButton, InlineOSC } from '../../types';
import { DeckButton as DeckButtonComponent } from './DeckButton';
import { DeckButtonEditor } from './DeckButtonEditor';
import { ActionCommandRef } from './useDeckButtonState';
import { ROW_LABELS, EMPTY_COLORS } from './buttonTypes';
import ContextMenu, { MenuItem } from '../ContextMenu';

interface DeckGridProps {
  grid: GridSlot[];
  editing: boolean;
  categories: ActionCategory[];
  onFire: (button: DeckButton) => void;
  onRemove: (row: number, col: number) => void;
  onAssign: (row: number, col: number, actionId: string, osc?: InlineOSC, meta?: { label: string; icon: string; color: string }, toggle?: DeckButton['toggle']) => void;
  onUpdate: (row: number, col: number, updates: Partial<DeckButton>) => void;
  onRemoveAction: (row: number, col: number, actionIndex: number) => void;
  onReorderAction?: (row: number, col: number, fromIndex: number, toIndex: number) => void;
  onSwap?: (fromRow: number, fromCol: number, toRow: number, toCol: number) => void;
  onCommandDrop?: (row: number, col: number, commandType: string) => void;
  deviceStates?: any;
  showActive?: boolean;
  inGroup?: boolean;
  onGroupEnter?: (buttonId: string) => void;
  onGroupBack?: () => void;
  onCreateGroup?: (row: number, col: number, name: string) => void;
}

const ROWS = 4;
const COLS = 8;
const FONT_MONO = "'IBM Plex Mono', monospace";
const FONT_SANS = "'IBM Plex Sans', sans-serif";

export function DeckGrid({ grid, editing, categories, onFire, onRemove, onAssign, onUpdate, onRemoveAction, onReorderAction, onSwap, onCommandDrop, deviceStates, showActive, inGroup = false, onGroupEnter, onGroupBack, onCreateGroup }: DeckGridProps) {
  const [editingSlot, setEditingSlot] = useState<{ row: number; col: number } | null>(null);
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);
  const dragSrcRef = useRef<{ row: number; col: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: number; col: number } | null>(null);
  const [clipboard, setClipboard] = useState<DeckButton | null>(null);

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

  /** Check if a cell is occluded by a spanned button at a different position */
  const getOwnerSlot = (row: number, col: number): GridSlot | null => {
    for (const s of grid) {
      if (!s.button.span) continue;
      const { cols, rows } = s.button.span;
      if (cols <= 1 && rows <= 1) continue;
      if (row >= s.row && row < s.row + rows && col >= s.col && col < s.col + cols) {
        if (row === s.row && col === s.col) return null; // anchor cell, not occluded
        return s;
      }
    }
    return null;
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
    // Internal swap uses 'move'; palette/command drags use 'copy'
    e.dataTransfer.dropEffect = dragSrcRef.current ? 'move' : 'copy';
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

  // --- Context menu ---

  const handleContextMenu = useCallback((e: React.MouseEvent, row: number, col: number) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, row, col });
  }, []);

  const getContextMenuItems = useCallback((): MenuItem[] => {
    if (!contextMenu) return [];
    const { row, col } = contextMenu;
    const button = getButton(row, col);
    const items: MenuItem[] = [];

    if (button?.group) {
      if (editing) {
        items.push({
          label: '\uD83D\uDDD1 Delete Group',
          danger: true,
          onClick: () => {
            const count = button.group?.length ?? 0;
            const msg = count > 0
              ? `Delete group "${button.label}" and ${count} button${count === 1 ? '' : 's'} inside?`
              : `Delete group "${button.label}"?`;
            if (confirm(msg)) onRemove(row, col);
          },
        });
      } else {
        items.push({ label: 'No actions', disabled: true, onClick: () => {} });
      }
      return items;
    }

    if (button) {
      items.push({
        label: 'Copy Button',
        shortcut: '\u2318C',
        onClick: () => setClipboard({ ...button }),
      });
      items.push({
        label: 'Create Webhook',
        onClick: () => {
          const name = button.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
          const host = `${window.location.hostname}:8081`;
          fetch(`http://${host}/api/v1/webhooks`).then(r => r.json()).then(existing => {
            const webhooks = { ...existing };
            webhooks[name] = { mode: button.mode, seriesGap: button.seriesGap, actions: button.actions };
            return fetch(`http://${host}/api/v1/webhooks`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(webhooks),
            });
          }).then(() => {
            console.log(`Webhook "${name}" created from button "${button.label}"`);
          });
        },
      });
      items.push({
        label: 'Duplicate',
        onClick: () => {
          // Find first empty cell
          for (let r = 0; r < ROWS; r++) {
            for (let c = 0; c < COLS; c++) {
              if (!getButton(r, c) && (r !== row || c !== col)) {
                const dup = { ...button, id: `btn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` };
                onAssign(r, c, dup.actions[0]?.actionId ?? '', dup.actions[0]?.osc, {
                  label: dup.label, icon: dup.icon, color: dup.color,
                }, dup.toggle);
                // Copy remaining actions
                for (let a = 1; a < dup.actions.length; a++) {
                  onAssign(r, c, dup.actions[a].actionId, dup.actions[a].osc);
                }
                return;
              }
            }
          }
        },
      });
      if (editing) {
        items.push({ label: '', separator: true, onClick: () => {} });
        items.push({
          label: 'Edit',
          onClick: () => setEditingSlot({ row, col }),
        });
        items.push({
          label: 'Remove',
          danger: true,
          onClick: () => onRemove(row, col),
        });
      }
    }

    if (clipboard && editing) {
      if (items.length > 0) {
        items.push({ label: '', separator: true, onClick: () => {} });
      }
      items.push({
        label: `Paste "${clipboard.label}"`,
        shortcut: '\u2318V',
        onClick: () => {
          const pasted = { ...clipboard, id: `btn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` };
          // Remove existing button first if occupied
          if (getButton(row, col)) onRemove(row, col);
          onAssign(row, col, pasted.actions[0]?.actionId ?? '', pasted.actions[0]?.osc, {
            label: pasted.label, icon: pasted.icon, color: pasted.color,
          }, pasted.toggle);
          for (let a = 1; a < pasted.actions.length; a++) {
            onAssign(row, col, pasted.actions[a].actionId, pasted.actions[a].osc);
          }
        },
      });
    }

    if (editing && !button && onCreateGroup) {
      if (items.length > 0) {
        items.push({ label: '', separator: true, onClick: () => {} });
      }
      items.push({
        label: '\uD83D\uDCC1 Create Group',
        onClick: () => {
          const name = prompt('Group name:');
          if (name) onCreateGroup(row, col, name);
        },
      });
    }

    if (!button && !clipboard && !editing) {
      items.push({ label: 'No actions', disabled: true, onClick: () => {} });
    }

    return items;
  }, [contextMenu, clipboard, editing, grid, onAssign, onRemove]);

  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: `130px repeat(${COLS}, 1fr)`,
        gridTemplateRows: `repeat(${ROWS}, 1fr)`,
        gap: 4,
        padding: 16,
        position: 'absolute', inset: 0,
        overflow: 'auto',
      }}>
        {Array.from({ length: ROWS }, (_, ri) => {
          const rowLabel = ROW_LABELS[ri];
          const cells: React.ReactNode[] = [];

          {/* Row label — spans 1 col in the label column */}
          cells.push(
            <div key={`label-${ri}`} style={{
              gridColumn: 1, gridRow: ri + 1,
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
          );

          for (let ci = 0; ci < COLS; ci++) {
            const cellKey = `${ri}-${ci}`;
            const isOver = dragOverCell === cellKey;
            // gridColumn is offset by 1 because col 1 is the label
            const gc = ci + 2;
            const gr = ri + 1;

            {/* Skip cells occluded by a spanned button */}
            const owner = getOwnerSlot(ri, ci);
            if (owner) continue;

            {/* Auto-injected back button at (3, 0) when inside a group */}
            if (inGroup && ri === 3 && ci === 0) {
              cells.push(
                <div key={cellKey}
                  onPointerDown={() => onGroupBack?.()}
                  style={{
                    gridColumn: gc, gridRow: gr,
                    background: '#1a1a2a', border: '1px solid #404060',
                    borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    minHeight: 62, cursor: 'pointer', flexDirection: 'column', gap: 2,
                  }}>
                  <span style={{ fontSize: 14, color: '#8888cc' }}>{'\u25C0'}</span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 9, color: '#8888cc' }}>Back</span>
                </div>
              );
              continue;
            }

            const button = getButton(ri, ci);
            const spanCols = button?.span?.cols ?? 1;
            const spanRows = button?.span?.rows ?? 1;
            const hasSpan = spanCols > 1 || spanRows > 1;

            {/* Group folder button */}
            if (button?.group) {
              cells.push(
                <div key={cellKey}
                  onPointerDown={() => onGroupEnter?.(button.id)}
                  onContextMenu={(e) => handleContextMenu(e, ri, ci)}
                  style={{
                    gridColumn: hasSpan ? `${gc} / span ${spanCols}` : gc,
                    gridRow: hasSpan ? `${gr} / span ${spanRows}` : gr,
                    background: (button.color ?? '#3B82F6') + '26',
                    border: `1px solid ${button.color ?? '#3B82F6'}55`,
                    borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    minHeight: 62, cursor: 'pointer', flexDirection: 'column', gap: 2,
                    position: 'relative',
                  }}>
                  <span style={{ fontSize: 14 }}>{button.icon || '\uD83D\uDCC1'}</span>
                  <span style={{ fontFamily: FONT_MONO, fontSize: 10, color: '#e8e8e8', textAlign: 'center' }}>
                    {button.label}
                  </span>
                  <span style={{
                    position: 'absolute', top: 3, right: 5,
                    fontSize: 8, color: '#666', fontFamily: FONT_MONO,
                  }}>{button.group.length}</span>
                </div>
              );
              continue;
            }

            if (!button) {
              cells.push(
                <div
                  key={cellKey}
                  draggable={false}
                  onContextMenu={(e) => handleContextMenu(e, ri, ci)}
                  onDragOver={(e) => handleDragOver(e, ri, ci)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, ri, ci)}
                  style={{
                    gridColumn: gc, gridRow: gr,
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
              continue;
            }

            cells.push(
              <div
                key={cellKey}
                draggable={editing && !hasSpan}
                onContextMenu={(e) => handleContextMenu(e, ri, ci)}
                onDragStart={(e) => !hasSpan && handleDragStart(e, ri, ci)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOver(e, ri, ci)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, ri, ci)}
                style={{
                  gridColumn: hasSpan ? `${gc} / span ${spanCols}` : gc,
                  gridRow: hasSpan ? `${gr} / span ${spanRows}` : gr,
                  display: 'flex', minHeight: 62,
                  cursor: editing && !hasSpan ? 'grab' : undefined,
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
          }

          return cells;
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
            onReorderAction={onReorderAction}
            onClose={() => setEditingSlot(null)}
          />
        );
      })()}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={getContextMenuItems()}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>
  );
}
