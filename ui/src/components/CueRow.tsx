import { useState, useEffect, useRef } from 'react';
import type { Cue, InlineOSC } from '../types';
import ActionChip, { buildActionLookup } from './ActionChip';
import type { ActionCategory } from '../types';

interface CueRowProps {
  cue: Cue;
  index: number;
  total: number;
  isActive: boolean;
  isFired: boolean;
  lookup: ReturnType<typeof buildActionLookup>;
  onRemoveAction: (cueId: string, actionIndex: number) => void;
  onRemoveCue: (cueId: string) => void;
  onRenameCue: (cueId: string, name: string) => void;
  onMoveCue: (cueId: string, direction: -1 | 1) => void;
  onDrop: (cueId: string, actionId: string, osc?: InlineOSC, delay?: number) => void;
  onCommandTypeDrop?: (cueId: string, commandType: string) => void;
  onEditAction?: (cueId: string, actionIndex: number, osc: InlineOSC) => void;
}

export default function CueRow({
  cue, index, total, isActive, isFired,
  lookup, onRemoveAction, onRemoveCue, onRenameCue, onMoveCue, onDrop, onCommandTypeDrop, onEditAction,
}: CueRowProps) {
  const [isOver, setIsOver] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nameVal, setNameVal] = useState(cue.name);
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setNameVal(cue.name); }, [cue.name]);

  useEffect(() => {
    if (isActive && rowRef.current) {
      rowRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isActive]);

  const fired = isFired && !isActive;

  return (
    <div
      ref={rowRef}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setIsOver(true); }}
      onDragLeave={() => setIsOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsOver(false);
        // Check for command type (CommandTile drag)
        const cmdType = e.dataTransfer.getData('application/x-command-type');
        if (cmdType) {
          onCommandTypeDrop?.(cue.id, cmdType);
          return;
        }
        // Check for inline OSC (legacy drag)
        const jsonData = e.dataTransfer.getData('application/json');
        if (jsonData) {
          try {
            const { actionId, osc, delay } = JSON.parse(jsonData);
            onDrop(cue.id, actionId, osc, delay);
            return;
          } catch { /* fall through */ }
        }
        const itemId = e.dataTransfer.getData('text/plain');
        if (itemId) onDrop(cue.id, itemId);
      }}
      style={{
        background: isActive ? '#0C1A2E' : isOver ? '#0E1E38' : fired ? '#0A0F1A' : '#0F172A',
        border: isActive
          ? '1.5px solid #1D4ED8'
          : isOver
          ? '1.5px dashed #3B82F6'
          : '1.5px solid #1E293B',
        borderRadius: 12,
        padding: isActive ? '18px 18px' : '12px 16px',
        transition: 'all 0.3s ease',
        opacity: fired ? 0.45 : 1,
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      {/* Active glow */}
      {isActive && (
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
          background: '#3B82F6',
          borderRadius: '2px 0 0 2px',
          boxShadow: '0 0 20px #3B82F644',
        }} />
      )}

      {/* Active pulse ring */}
      {isActive && (
        <div style={{
          position: 'absolute', top: 10, left: 48, width: 10, height: 10,
          borderRadius: '50%', background: '#3B82F6',
          animation: 'pulse 2s ease-in-out infinite',
        }} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: (cue.actions.length > 0 || isActive) ? 10 : 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: isActive ? 8 : 0 }}>
          <span style={{
            fontFamily: "'JetBrains Mono', 'SF Mono', monospace",
            fontSize: isActive ? 14 : 12,
            color: isActive ? '#3B82F6' : fired ? '#1E293B' : '#475569',
            fontWeight: 700,
            minWidth: 32,
            transition: 'all 0.3s',
          }}>
            {fired ? '\u2713' : `Q${index + 1}`}
          </span>
          {editing ? (
            <input
              autoFocus
              value={nameVal}
              onChange={(e) => setNameVal(e.target.value)}
              onBlur={() => { setEditing(false); onRenameCue(cue.id, nameVal); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { setEditing(false); onRenameCue(cue.id, nameVal); }
                if (e.key === 'Escape') { setEditing(false); setNameVal(cue.name); }
              }}
              style={{
                background: '#1E293B', border: '1px solid #3B82F6', borderRadius: 6,
                color: '#E2E8F0', padding: '4px 8px', fontSize: isActive ? 16 : 14,
                fontWeight: 600, outline: 'none', width: 240,
              }}
            />
          ) : (
            <span
              onClick={() => setEditing(true)}
              style={{
                color: cue.actions.length === 0 ? '#475569' : isActive ? '#F1F5F9' : '#E2E8F0',
                fontWeight: isActive ? 700 : 600,
                fontSize: isActive ? 16 : 14,
                cursor: 'pointer',
                fontStyle: cue.actions.length === 0 ? 'italic' : 'normal',
                transition: 'all 0.3s',
              }}
            >
              {cue.name || 'Untitled Cue'}
            </span>
          )}
          {isActive && (
            <span style={{
              background: '#3B82F620', border: '1px solid #3B82F644',
              borderRadius: 6, padding: '2px 10px', fontSize: 11,
              color: '#60A5FA', fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase',
            }}>
              LIVE
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button onClick={() => onMoveCue(cue.id, -1)} disabled={index === 0}
            style={{ background: 'none', border: 'none', color: index === 0 ? '#0F172A' : '#475569', cursor: index === 0 ? 'default' : 'pointer', fontSize: 14, padding: '2px 5px', borderRadius: 4 }}>▲</button>
          <button onClick={() => onMoveCue(cue.id, 1)} disabled={index === total - 1}
            style={{ background: 'none', border: 'none', color: index === total - 1 ? '#0F172A' : '#475569', cursor: index === total - 1 ? 'default' : 'pointer', fontSize: 14, padding: '2px 5px', borderRadius: 4 }}>▼</button>
          <button onClick={() => onRemoveCue(cue.id)}
            style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 13, padding: '2px 7px', borderRadius: 4, transition: 'color 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
            onMouseLeave={e => (e.currentTarget.style.color = '#475569')}>✕</button>
        </div>
      </div>

      {cue.actions.length === 0 && !isOver && (
        <div style={{ color: '#1E293B', fontSize: 13, textAlign: 'center', padding: '6px 0', fontStyle: 'italic' }}>
          drag actions here
        </div>
      )}

      {cue.actions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: isActive ? 8 : 5, marginLeft: 42, transition: 'all 0.3s' }}>
          {cue.actions.map((cueAction, ai) => (
            <ActionChip
              key={`${cueAction.actionId}-${ai}`}
              actionId={cueAction.actionId}
              index={ai}
              expanded={isActive}
              lookup={lookup}
              osc={cueAction.osc}
              onRemove={(idx) => onRemoveAction(cue.id, idx)}
              onEdit={onEditAction ? (idx, o) => onEditAction(cue.id, idx, o) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
