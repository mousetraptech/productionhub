import { useState } from 'react';

interface DeckToolbarProps {
  profiles: string[];
  currentProfile: string | null;
  editing: boolean;
  onLoadProfile: (name: string) => void;
  onSaveProfile: (name: string) => void;
  onDeleteProfile: (name: string) => void;
  onToggleEdit: () => void;
}

export function DeckToolbar({
  profiles, currentProfile, editing,
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
      padding: '8px 16px',
      background: '#1E293B', borderBottom: '1px solid #334155',
      height: 48, boxSizing: 'border-box',
    }}>
      <select
        value={currentProfile ?? ''}
        onChange={(e) => e.target.value && onLoadProfile(e.target.value)}
        style={{
          background: '#0F172A', color: '#E2E8F0', border: '1px solid #475569',
          borderRadius: 6, padding: '4px 8px', fontSize: 14,
        }}
      >
        <option value="">Select profile...</option>
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
              background: '#0F172A', color: '#E2E8F0', border: '1px solid #475569',
              borderRadius: 6, padding: '4px 8px', fontSize: 14, width: 160,
            }}
          />
          <button onClick={handleSave} style={toolbarBtn('#3B82F6')}>Save</button>
          {currentProfile && (
            <button onClick={() => onDeleteProfile(currentProfile)} style={toolbarBtn('#EF4444')}>Delete</button>
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
        style={toolbarBtn(editing ? '#10B981' : '#475569')}
      >
        {editing ? 'Done' : 'Edit'}
      </button>
    </div>
  );
}

function toolbarBtn(color: string): React.CSSProperties {
  return {
    background: color, color: '#FFF', border: 'none',
    borderRadius: 6, padding: '6px 14px', fontSize: 13,
    cursor: 'pointer', fontWeight: 600,
  };
}
