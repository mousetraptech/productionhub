import { useRef } from 'react';
import type { ShowState, ActionCategory, ClientMessage } from '../types';
import { buildActionLookup } from './ActionChip';
import CueRow from './CueRow';

interface CueStackProps {
  show: ShowState;
  categories: ActionCategory[];
  send: (msg: ClientMessage) => void;
}

export default function CueStack({ show, categories, send }: CueStackProps) {
  const cueListRef = useRef<HTMLDivElement>(null);
  const lookup = buildActionLookup(categories);

  const addCue = () => {
    send({ type: 'add-cue' });
    setTimeout(() => {
      if (cueListRef.current) cueListRef.current.scrollTop = cueListRef.current.scrollHeight;
    }, 50);
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 24px', borderBottom: '1px solid #1E293B',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: show.activeCueIndex !== null ? '#3B82F6' : '#10B981',
            boxShadow: show.activeCueIndex !== null ? '0 0 10px #3B82F688' : '0 0 8px #10B98166',
            transition: 'all 0.3s',
          }} />
          <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: '0.03em', color: '#94A3B8' }}>
            PRODUCTION HUB
          </span>
          <span style={{ color: '#1E293B' }}>&mdash;</span>
          <span style={{ color: '#64748B', fontSize: 13, fontWeight: 500 }}>{show.name || "Tonight's Show"}</span>
        </div>
        <button
          onClick={addCue}
          style={{
            background: '#1E293B', border: '1px solid #334155',
            color: '#94A3B8', padding: '6px 14px', borderRadius: 8,
            cursor: 'pointer', fontSize: 12.5, fontWeight: 600, transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#334155'; e.currentTarget.style.color = '#E2E8F0'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#1E293B'; e.currentTarget.style.color = '#94A3B8'; }}
        >
          + Add Cue
        </button>
      </div>

      {/* Cue List */}
      <div ref={cueListRef} style={{
        flex: 1, overflow: 'auto', padding: '14px 24px',
        display: 'flex', flexDirection: 'column', gap: 6,
      }}>
        {show.cues.length === 0 && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 8, color: '#1E293B',
          }}>
            <div style={{ fontSize: 36 }}>📄</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#334155' }}>Empty show</div>
            <div style={{ fontSize: 12.5, color: '#1E293B' }}>Drag actions here or add a cue</div>
          </div>
        )}

        {show.cues.map((cue, i) => (
          <CueRow
            key={cue.id}
            cue={cue}
            index={i}
            total={show.cues.length}
            isActive={show.activeCueIndex === i}
            isFired={show.activeCueIndex !== null && i < show.activeCueIndex}
            lookup={lookup}
            onRemoveAction={(cueId, actionIndex) => send({ type: 'remove-action-from-cue', cueId, actionIndex })}
            onRemoveCue={(cueId) => send({ type: 'remove-cue', cueId })}
            onRenameCue={(cueId, name) => send({ type: 'rename-cue', cueId, name })}
            onMoveCue={(cueId, direction) => send({ type: 'move-cue', cueId, direction })}
            onDrop={(cueId, actionId) => send({ type: 'add-action-to-cue', cueId, actionId })}
          />
        ))}

        {/* Drop zone for new cue at bottom */}
        {show.cues.length > 0 && (
          <div
            onDragOver={(e) => {
              e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
              e.currentTarget.style.borderColor = '#3B82F6';
              e.currentTarget.style.background = '#0F172A';
              e.currentTarget.style.color = '#3B82F6';
            }}
            onDragLeave={(e) => {
              e.currentTarget.style.borderColor = '#1E293B';
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#1E293B';
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.currentTarget.style.borderColor = '#1E293B';
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = '#1E293B';
              const itemId = e.dataTransfer.getData('text/plain');
              if (itemId && lookup[itemId]) {
                const info = lookup[itemId];
                send({
                  type: 'add-cue',
                  cue: { name: info.label, actions: [{ actionId: itemId }] },
                });
              }
            }}
            style={{
              border: '1.5px dashed #1E293B', borderRadius: 12,
              padding: 16, textAlign: 'center',
              color: '#1E293B', fontSize: 12.5,
              transition: 'all 0.2s', fontStyle: 'italic',
            }}
          >
            drop to create new cue
          </div>
        )}
      </div>
    </div>
  );
}
