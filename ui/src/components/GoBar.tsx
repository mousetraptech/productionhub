import type { ShowState, ClientMessage } from '../types';

interface GoBarProps {
  show: ShowState;
  send: (msg: ClientMessage) => void;
}

export default function GoBar({ show, send }: GoBarProps) {
  const { cues, activeCueIndex } = show;
  const isShowDone = activeCueIndex !== null && activeCueIndex >= cues.length - 1;

  const nextCueName = activeCueIndex === null
    ? cues[0]?.name || '\u2014'
    : activeCueIndex < cues.length - 1
    ? cues[activeCueIndex + 1]?.name
    : null;

  return (
    <div style={{
      borderTop: '1px solid #1E293B',
      padding: '14px 24px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: '#0F172A',
    }}>
      {/* Status */}
      <div style={{ fontSize: 13, color: '#475569', minWidth: 0, flex: 1 }}>
        {activeCueIndex !== null ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace",
              color: '#3B82F6', fontWeight: 700, fontSize: 12,
            }}>
              Q{activeCueIndex + 1}
            </span>
            <span style={{ color: '#94A3B8', fontWeight: 600, fontSize: 13 }}>
              {cues[activeCueIndex]?.name || 'Untitled'}
            </span>
            {isShowDone && (
              <span style={{
                background: '#10B98120', border: '1px solid #10B98144',
                borderRadius: 6, padding: '2px 8px', fontSize: 11,
                color: '#10B981', fontWeight: 700, letterSpacing: '0.06em',
              }}>
                SHOW COMPLETE
              </span>
            )}
          </div>
        ) : (
          <span style={{ fontStyle: 'italic', color: '#334155' }}>
            Ready &mdash; {cues.length} cue{cues.length !== 1 ? 's' : ''} loaded
          </span>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexShrink: 0 }}>
        {activeCueIndex !== null && (
          <button
            onClick={() => send({ type: 'standby' })}
            style={{
              background: '#1E293B', border: '1px solid #334155',
              color: '#94A3B8', padding: '10px 18px', borderRadius: 8,
              cursor: 'pointer', fontSize: 13, fontWeight: 600,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#334155'; }}
            onMouseLeave={e => { e.currentTarget.style.background = '#1E293B'; }}
          >
            Rewind
          </button>
        )}
        <button
          onClick={() => send({ type: 'go' })}
          disabled={cues.length === 0 || isShowDone}
          style={{
            background: isShowDone ? '#1E293B' : '#3B82F6',
            border: 'none',
            color: isShowDone ? '#475569' : '#fff',
            padding: '12px 24px',
            borderRadius: 10,
            cursor: isShowDone ? 'default' : 'pointer',
            fontSize: 14,
            fontWeight: 700,
            fontFamily: "'JetBrains Mono', monospace",
            letterSpacing: '0.08em',
            boxShadow: isShowDone ? 'none' : '0 0 24px #3B82F644, 0 4px 12px #00000044',
            transition: 'all 0.2s',
            display: 'flex', alignItems: 'center', gap: 10,
            minWidth: 180, justifyContent: 'center',
          }}
        >
          <span style={{ letterSpacing: '0.15em' }}>GO</span>
          {!isShowDone && nextCueName && (
            <>
              <span style={{
                width: 1, height: 18,
                background: isShowDone ? '#334155' : '#ffffff33',
              }} />
              <span style={{
                fontSize: 12, fontWeight: 600, opacity: 0.85,
                fontFamily: "'DM Sans', sans-serif", letterSpacing: '0.01em',
                maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {nextCueName}
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
