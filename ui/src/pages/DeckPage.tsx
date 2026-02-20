import { useDeck } from '../hooks/useDeck';
import { DeckToolbar } from '../components/deck/DeckToolbar';
import { DeckGrid } from '../components/deck/DeckGrid';
import ActionPalette from '../components/ActionPalette';

export function DeckPage() {
  const deck = useDeck();

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
        <DeckGrid
          grid={deck.grid}
          editing={deck.editing}
          categories={deck.categories}
          onFire={deck.fireButton}
          onRemove={deck.removeButton}
          onAssign={deck.assignAction}
        />
      </div>
    </div>
  );
}
