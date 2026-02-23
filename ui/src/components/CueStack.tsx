import { useRef, useState } from 'react';
import type { ShowState, ActionCategory, ClientMessage, InlineOSC } from '../types';
import { buildActionLookup } from './ActionChip';
import CueRow from './CueRow';

interface CueStackProps {
  show: ShowState;
  categories: ActionCategory[];
  send: (msg: ClientMessage) => void;
  onCommandDrop?: (commandType: string, cueId: string | null) => void;
  onEditAction?: (cueId: string, actionIndex: number, osc: InlineOSC) => void;
}

export default function CueStack({ show, categories, send, onCommandDrop, onEditAction }: CueStackProps) {
  const cueListRef = useRef<HTMLDivElement>(null);
  const lookup = buildActionLookup(categories);
  const [dragOver, setDragOver] = useState(false);

  const addCue = () => {
    send({ type: 'add-cue' });
    setTimeout(() => {
      if (cueListRef.current) cueListRef.current.scrollTop = cueListRef.current.scrollHeight;
    }, 50);
  };

  // Single drop handler on the entire cue list container
  const onListDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    // Check for command type (new CommandTile drag)
    const cmdType = e.dataTransfer.getData('application/x-command-type');
    if (cmdType) {
      onCommandDrop?.(cmdType, null);
      return;
    }

    // Check for inline OSC (legacy drag)
    const jsonData = e.dataTransfer.getData('application/json');
    if (jsonData) {
      try {
        const { actionId, osc } = JSON.parse(jsonData) as { actionId: string; osc: InlineOSC };
        send({
          type: 'add-cue',
          cue: { name: osc.label, actions: [{ actionId, osc }] },
        });
        return;
      } catch { /* fall through to text/plain */ }
    }

    // Registry action (DragTile drag)
    const itemId = e.dataTransfer.getData('text/plain');
    if (!itemId) return;
    const info = lookup[itemId];
    send({
      type: 'add-cue',
      cue: { name: info?.label ?? itemId, actions: [{ actionId: itemId }] },
    });
  };

  const onListDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  };

  const onListDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    // Only count as leave if we actually left the container
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOver(false);
    }
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
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

      {/* Cue List — entire area is a drop target */}
      <div
        ref={cueListRef}
        onDragOver={onListDragOver}
        onDragLeave={onListDragLeave}
        onDrop={onListDrop}
        style={{
          flex: 1, overflow: 'auto', padding: '14px 24px',
          display: 'flex', flexDirection: 'column', gap: 6,
          border: dragOver ? '2px dashed #3B82F6' : '2px dashed transparent',
          background: dragOver ? '#0F172A' : 'transparent',
          transition: 'border-color 0.15s, background 0.15s',
        }}
      >
        {show.cues.length === 0 && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 8, color: dragOver ? '#3B82F6' : '#1E293B',
            transition: 'color 0.15s',
            pointerEvents: 'none',
          }}>
            <div style={{ fontSize: 36 }}>📄</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: dragOver ? '#60A5FA' : '#334155' }}>
              {dragOver ? 'Drop to create cue' : 'Empty show'}
            </div>
            <div style={{ fontSize: 12.5, color: dragOver ? '#3B82F6' : '#1E293B' }}>
              {dragOver ? '' : 'Drag actions here or add a cue'}
            </div>
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
            onDrop={(cueId, actionId, osc, delay) => send({ type: 'add-action-to-cue', cueId, actionId, osc, delay })}
            onCommandTypeDrop={onCommandDrop ? (cueId: string, cmdType: string) => onCommandDrop(cmdType, cueId) : undefined}
            onEditAction={onEditAction}
          />
        ))}

        {/* Bottom hint when cues exist */}
        {show.cues.length > 0 && dragOver && (
          <div style={{
            border: '1.5px dashed #3B82F6', borderRadius: 12,
            padding: 16, textAlign: 'center',
            color: '#3B82F6', fontSize: 12.5,
            fontStyle: 'italic',
            pointerEvents: 'none',
          }}>
            drop to create new cue
          </div>
        )}
      </div>
    </div>
  );
}
