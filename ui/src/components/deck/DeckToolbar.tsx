import { useState } from 'react';

interface DeckToolbarProps {
  profiles: string[];
  currentProfile: string | null;
  editing: boolean;
  connected: boolean;
  onLoadProfile: (name: string) => void;
  onSaveProfile: (name: string) => void;
  onDeleteProfile: (name: string) => void;
  onToggleEdit: () => void;
}

const FONT_MONO = "'IBM Plex Mono', monospace";

const hdrBtn: React.CSSProperties = {
  fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.1em',
  textTransform: 'uppercase', background: 'transparent',
  border: '1px solid #333', color: '#888', padding: '5px 12px',
  cursor: 'pointer', borderRadius: 2, transition: 'all 0.15s',
  whiteSpace: 'nowrap',
};

export function DeckToolbar({
  profiles, currentProfile, editing, connected,
  onLoadProfile, onSaveProfile, onDeleteProfile, onToggleEdit,
}: DeckToolbarProps) {
  const [newName, setNewName] = useState('');

  const handleSave = () => {
    const name = newName.trim() || currentProfile;
    if (name) {
      onSaveProfile(name);
      setNewName('');
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '10px 16px',
      background: '#141414', borderBottom: '1px solid #2a2a2a',
      flexWrap: 'wrap',
    }}>
      {/* Title */}
      <span style={{
        fontFamily: FONT_MONO, fontSize: 13, fontWeight: 600,
        letterSpacing: '0.15em', textTransform: 'uppercase',
        color: '#c8a96e',
      }}>
        StreamDeck
      </span>
      <span style={{
        fontFamily: FONT_MONO, fontSize: 11, color: '#555',
        letterSpacing: '0.1em',
      }}>
        Production Hub
      </span>

      {/* Connection dot */}
      <span style={{
        fontFamily: FONT_MONO, fontSize: 9, color: '#555',
        letterSpacing: '0.08em', display: 'flex', alignItems: 'center', gap: 4,
      }}>
        MOD
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: connected ? '#40a040' : '#a02020',
          display: 'inline-block',
          transition: 'background 0.3s',
        }} />
      </span>

      {/* Profile select */}
      <select
        value={currentProfile ?? ''}
        onChange={(e) => e.target.value && onLoadProfile(e.target.value)}
        style={{
          fontFamily: FONT_MONO, fontSize: 10,
          background: '#1c1c1c', border: '1px solid #333',
          color: '#e8e8e8', padding: '5px 8px', borderRadius: 2,
          outline: 'none', minWidth: 120,
        }}
      >
        <option value="">-- profiles --</option>
        {profiles.map(p => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>

      {editing && (
        <>
          <input
            type="text"
            placeholder={currentProfile ?? 'Profile name...'}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{
              fontFamily: FONT_MONO, fontSize: 10,
              background: '#1c1c1c', border: '1px solid #333',
              color: '#e8e8e8', padding: '5px 8px', borderRadius: 2,
              width: 140, outline: 'none',
            }}
          />
          <button onClick={handleSave} style={{ ...hdrBtn, borderColor: '#8b6f3e', color: '#c8a96e' }}>
            Save
          </button>
          {currentProfile && (
            <button
              onClick={() => onDeleteProfile(currentProfile)}
              style={{ ...hdrBtn, borderColor: '#8b3030', color: '#f08080' }}
            >
              Delete
            </button>
          )}
        </>
      )}

      <div style={{ flex: 1 }} />

      <button
        onClick={() => {
          if (editing && currentProfile) {
            onSaveProfile(currentProfile);
          }
          onToggleEdit();
        }}
        style={{
          ...hdrBtn,
          ...(editing
            ? { borderColor: '#8b3030', color: '#f08080', background: '#2d1a1a' }
            : {}),
        }}
      >
        {editing ? 'Done' : 'Edit'}
      </button>
    </div>
  );
}
