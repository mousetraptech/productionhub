import { useState, useCallback } from 'react';
import { useDeck } from '../hooks/useDeck';
import { useDeviceStates } from '../hooks/useDeviceStates';
import { useAliases } from '../hooks/useAliases';
import { DeckToolbar } from '../components/deck/DeckToolbar';
import { DeckGrid } from '../components/deck/DeckGrid';
import ActionPalette from '../components/ActionPalette';
import CommandModal, { type CommandModalTarget } from '../components/CommandModal';
import type { InlineOSC, DeckButton } from '../types';

/** Auto-generate a toggle for mute commands so the button unmutes when pressed again. */
function buildAutoToggle(commandType: string, actionId: string, osc: InlineOSC): DeckButton['toggle'] | undefined {
  if (commandType !== 'mute') return undefined;
  const chLabel = osc.label.replace(/^Mute\s*/, '');
  return {
    activeLabel: `MUTED ${chLabel}`,
    activeIcon: '',
    activeColor: '#EF4444',
    activeActions: [{
      actionId: actionId.replace(':mute:', ':unmute:'),
      osc: { address: osc.address, args: [0], label: `Unmute ${chLabel}` },
    }],
  };
}

export function DeckPage() {
  const deck = useDeck();
  const { deviceStates } = useDeviceStates();
  const aliases = useAliases();
  const [modalTarget, setModalTarget] = useState<CommandModalTarget | null>(null);
  const [dropSlot, setDropSlot] = useState<{ row: number; col: number } | null>(null);

  const handleCommandDrop = useCallback((row: number, col: number, commandType: string) => {
    setDropSlot({ row, col });
    setModalTarget({ commandType, cueId: null });
  }, []);

  const handleModalSubmit = useCallback((target: CommandModalTarget, osc: InlineOSC) => {
    if (dropSlot) {
      if (osc.address === '__wait__') {
        const ms = osc.args[0] as number;
        deck.assignAction(dropSlot.row, dropSlot.col, 'wait', undefined, {
          label: osc.label,
          icon: '',
          color: '#64748B',
        }, undefined, ms);
      } else {
        const actionId = `inline:${target.commandType}:${Date.now()}`;
        const toggle = buildAutoToggle(target.commandType, actionId, osc);
        deck.assignAction(dropSlot.row, dropSlot.col, actionId, osc, {
          label: toggle ? osc.label.replace(/^Mute/, 'MUTE') : osc.label,
          icon: '',
          color: '#64748B',
        }, toggle);
      }
    }
    setModalTarget(null);
    setDropSlot(null);
  }, [dropSlot, deck.assignAction]);

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#0a0a0a', color: '#e8e8e8',
      fontFamily: "'IBM Plex Sans', sans-serif",
    }}>
      <DeckToolbar
        profiles={deck.profiles}
        currentProfile={deck.currentProfile}
        editing={deck.editing}
        connected={deck.connected}
        onLoadProfile={deck.loadProfile}
        onSaveProfile={deck.saveProfile}
        onDeleteProfile={deck.deleteProfile}
        onToggleEdit={deck.toggleEdit}
      />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {deck.editing && (
          <div style={{
            width: 270, borderRight: '1px solid #2a2a2a',
            overflowY: 'auto', background: '#111',
          }}>
            <ActionPalette categories={deck.categories} onNewShow={() => {}} aliases={aliases} />
          </div>
        )}
        <div style={{ flex: 1, position: 'relative' }}>
          <DeckGrid
            grid={deck.grid}
            editing={deck.editing}
            categories={deck.categories}
            onFire={deck.fireButton}
            onRemove={deck.removeButton}
            onAssign={deck.assignAction}
            onUpdate={deck.updateButton}
            onRemoveAction={deck.removeAction}
            onSwap={deck.swapButtons}
            onCommandDrop={handleCommandDrop}
            deviceStates={deviceStates}
            showActive={deck.showActive}
            currentPage={deck.currentPage}
            totalPages={deck.totalPages}
            pageNames={deck.pageNames}
            onPageNext={deck.pageNext}
            onPagePrev={deck.pagePrev}
          />
        </div>
      </div>
      {deck.totalPages > 1 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
          padding: '6px 16px', borderTop: '1px solid #2a2a2a', background: '#0d0d0d',
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 12,
        }}>
          <button onClick={deck.pagePrev} style={{
            background: 'none', border: '1px solid #333', borderRadius: 3,
            color: '#888', padding: '2px 10px', cursor: 'pointer',
          }}>{'\u25C0'}</button>
          {deck.pageNames.map((name, i) => (
            <span key={i}
              onClick={() => deck.setPage(i)}
              style={{
                color: i === deck.currentPage ? '#e8e8e8' : '#555',
                cursor: 'pointer',
                padding: '2px 8px',
                borderBottom: i === deck.currentPage ? '2px solid #58a6ff' : '2px solid transparent',
              }}>
              {name}
            </span>
          ))}
          <button onClick={deck.pageNext} style={{
            background: 'none', border: '1px solid #333', borderRadius: 3,
            color: '#888', padding: '2px 10px', cursor: 'pointer',
          }}>{'\u25B6'}</button>
          {deck.editing && (
            <button onClick={deck.addPage} style={{
              background: 'none', border: '1px dashed #444', borderRadius: 3,
              color: '#666', padding: '2px 10px', cursor: 'pointer', marginLeft: 8,
            }}>+ Page</button>
          )}
        </div>
      )}
      {modalTarget && (
        <CommandModal
          target={modalTarget}
          obsScenes={deviceStates?.obs?.scenes}
          onSubmit={handleModalSubmit}
          onCancel={() => { setModalTarget(null); setDropSlot(null); }}
        />
      )}
    </div>
  );
}
