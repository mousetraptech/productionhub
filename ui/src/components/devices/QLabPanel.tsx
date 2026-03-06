import { useState } from 'react';
import { QLabState } from '../../hooks/useDeviceStates';

interface QLabPanelProps {
  prefix: string;
  state: QLabState | undefined;
  onFireCue: (prefix: string, cueNumber: string) => void;
}

export default function QLabPanel({ prefix, state, onFireCue }: QLabPanelProps) {
  const [selectedCue, setSelectedCue] = useState('');

  const cues = state?.cues ?? [];
  const playhead = state?.playhead ?? '';
  const runningCues = state?.runningCues ?? [];
  const connected = state?.connected ?? false;

  const handleGo = () => {
    if (selectedCue) {
      onFireCue(prefix, selectedCue);
    }
  };

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Connection + playhead */}
      <div style={{
        display: 'flex',
        gap: 12,
        marginBottom: 12,
      }}>
        <div style={{
          flex: 1,
          padding: '10px 14px',
          background: '#1E293B',
          borderRadius: 6,
        }}>
          <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>
            Playhead
          </div>
          <div style={{
            fontSize: 13,
            color: playhead ? '#E2E8F0' : '#475569',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}>
            {playhead || '(none)'}
          </div>
        </div>
        <div style={{
          padding: '10px 14px',
          background: '#1E293B',
          borderRadius: 6,
          minWidth: 60,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>
            Running
          </div>
          <div style={{
            fontSize: 13,
            color: runningCues.length > 0 ? '#10B981' : '#475569',
            fontWeight: 600,
            fontFamily: 'monospace',
          }}>
            {runningCues.length}
          </div>
        </div>
      </div>

      {/* Running cues list */}
      {runningCues.length > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          marginBottom: 12,
        }}>
          {runningCues.map((name, i) => (
            <span key={i} style={{
              fontSize: 11,
              padding: '3px 8px',
              background: 'rgba(16, 185, 129, 0.15)',
              color: '#10B981',
              borderRadius: 4,
              fontWeight: 500,
            }}>
              {name}
            </span>
          ))}
        </div>
      )}

      {/* Cue picker + GO */}
      {connected && cues.length > 0 && (
        <div style={{
          display: 'flex',
          gap: 8,
          alignItems: 'stretch',
        }}>
          <select
            value={selectedCue}
            onChange={(e) => setSelectedCue(e.target.value)}
            style={{
              flex: 1,
              background: '#020617',
              border: '1px solid #334155',
              borderRadius: 6,
              color: '#E2E8F0',
              padding: '8px 10px',
              fontSize: 12,
              outline: 'none',
              cursor: 'pointer',
              minWidth: 0,
            }}
          >
            <option value="">Jump to cue...</option>
            {cues.filter(c => c.number).map((cue) => (
              <option key={cue.uniqueID || cue.number} value={cue.number}>
                {cue.number}{cue.name ? ` — ${cue.name}` : ''}{cue.type ? ` (${cue.type})` : ''}
              </option>
            ))}
          </select>
          <button
            onClick={handleGo}
            disabled={!selectedCue}
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              background: selectedCue ? '#6366F1' : '#1E293B',
              color: selectedCue ? '#fff' : '#475569',
              cursor: selectedCue ? 'pointer' : 'default',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.05em',
              transition: 'all 0.15s',
            }}
          >
            GO
          </button>
        </div>
      )}

      {/* No cues message */}
      {connected && cues.length === 0 && (
        <div style={{
          fontSize: 11,
          color: '#475569',
          textAlign: 'center',
          padding: '8px 0',
        }}>
          No cues in workspace
        </div>
      )}

      {!connected && (
        <div style={{
          fontSize: 11,
          color: '#475569',
          textAlign: 'center',
          padding: '8px 0',
        }}>
          Not connected
        </div>
      )}
    </div>
  );
}
