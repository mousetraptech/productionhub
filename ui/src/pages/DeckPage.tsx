import { useState, useCallback } from 'react';
import { useDeck } from '../hooks/useDeck';
import { useDeviceStates } from '../hooks/useDeviceStates';
import { DeckToolbar } from '../components/deck/DeckToolbar';
import { DeckGrid } from '../components/deck/DeckGrid';
import ActionPalette from '../components/ActionPalette';
import CommandModal, { type CommandModalTarget } from '../components/CommandModal';
import type { InlineOSC, DeckButton } from '../types';

/** Auto-generate a toggle for mute commands so the button unmutes when pressed again. */
function buildAutoToggle(commandType: string, actionId: string, osc: InlineOSC): DeckButton['toggle'] | undefined {
  if (commandType !== 'mute') return undefined;
  // Mute OSC: /avantis/{strip}/mix/mute with args [1]
  // Extract channel label from the osc label (e.g., "Mute Ch 5" → "Ch 5")
  const chLabel = osc.label.replace(/^Mute\s*/, '');
  return {
    activeLabel: `MUTED ${chLabel}`,
    activeIcon: '🔇',
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
  const [modalTarget, setModalTarget] = useState<CommandModalTarget | null>(null);
  const [dropSlot, setDropSlot] = useState<{ row: number; col: number } | null>(null);

  const handleCommandDrop = useCallback((row: number, col: number, commandType: string) => {
    setDropSlot({ row, col });
    setModalTarget({ commandType, cueId: null });
  }, []);

  const handleModalSubmit = useCallback((target: CommandModalTarget, osc: InlineOSC) => {
    if (dropSlot) {
      const actionId = `inline:${target.commandType}:${Date.now()}`;
      const toggle = buildAutoToggle(target.commandType, actionId, osc);
      deck.assignAction(dropSlot.row, dropSlot.col, actionId, osc, {
        label: toggle ? osc.label.replace(/^Mute/, 'MUTE') : osc.label,
        icon: '',
        color: '#64748B',
      }, toggle);
    }
    setModalTarget(null);
    setDropSlot(null);
  }, [dropSlot, deck.assignAction]);

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#0F172A', color: '#E2E8F0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <DeckToolbar
        profiles={deck.profiles}
        currentProfile={deck.currentProfile}
        editing={deck.editing}
        onLoadProfile={deck.loadProfile}
        onSaveProfile={deck.saveProfile}
        onDeleteProfile={deck.deleteProfile}
        onToggleEdit={deck.toggleEdit}
      />
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {deck.editing && (
          <div style={{ width: 270, borderRight: '1px solid #334155', overflowY: 'auto' }}>
            <ActionPalette categories={deck.categories} onNewShow={() => {}} />
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
            onCommandDrop={handleCommandDrop}
            deviceStates={deviceStates}
          />
        </div>
      </div>
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
