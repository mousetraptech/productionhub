import { useState } from 'react';
import { useDeviceStates, type RecorderSource, type RecorderState } from '../hooks/useDeviceStates';
import { useProductionHub } from '../hooks/useProductionHub';

const pulseKeyframes = `
@keyframes recorder-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
`;

function vuDbToPercent(vuDb: number): number {
  const clamped = Math.max(-60, Math.min(0, vuDb));
  return ((clamped + 60) / 60) * 100;
}

function vuDbColor(vuDb: number): string {
  if (vuDb > -6) return '#EF4444';
  if (vuDb > -12) return '#F59E0B';
  return '#10B981';
}

function framesToTimecode(frames: number): string {
  const totalSeconds = Math.floor(frames / 60);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function StateBadge({ state }: { state: RecorderState['state'] }) {
  const config: Record<RecorderState['state'], { label: string; color: string }> = {
    stopped: { label: 'STOPPED', color: '#10B981' },
    recording: { label: 'RECORDING', color: '#EF4444' },
    archiving: { label: 'ARCHIVING', color: '#F59E0B' },
  };

  const { label, color } = config[state];
  const isRecording = state === 'recording';

  return (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 12,
      padding: '12px 24px',
      background: color,
      borderRadius: 8,
      animation: isRecording ? 'recorder-pulse 1.5s ease-in-out infinite' : 'none',
    }}>
      {isRecording && (
        <div style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: '#FFF',
          animation: 'recorder-pulse 1s ease-in-out infinite',
        }} />
      )}
      <span style={{
        fontSize: 18,
        fontWeight: 700,
        color: '#FFF',
        letterSpacing: 2,
      }}>
        {label}
      </span>
    </div>
  );
}

function SourceCard({ source }: { source: RecorderSource }) {
  const percent = vuDbToPercent(source.vuDb);
  const color = vuDbColor(source.vuDb);

  return (
    <div style={{
      padding: '16px 20px',
      background: '#1E293B',
      borderRadius: 8,
      marginBottom: 8,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 10,
      }}>
        <span style={{ fontSize: 16, fontWeight: 500, color: '#E2E8F0' }}>
          {source.name}
        </span>
        <div style={{ textAlign: 'right' }}>
          <span style={{
            fontSize: 20,
            fontWeight: 600,
            fontFamily: 'monospace',
            color: '#E2E8F0',
          }}>
            {framesToTimecode(source.frames)}
          </span>
          <div style={{
            fontSize: 11,
            fontFamily: 'monospace',
            color: '#64748B',
            marginTop: 2,
          }}>
            {source.frames.toLocaleString()} frames
          </div>
        </div>
      </div>

      <div style={{
        width: '100%',
        height: 16,
        background: '#0F172A',
        borderRadius: 8,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${percent}%`,
          height: '100%',
          background: color,
          borderRadius: 8,
          transition: 'width 0.1s ease-out, background 0.1s ease-out',
        }} />
      </div>
    </div>
  );
}

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

export function RecorderPage() {
  const { deviceStates, connected: dashConnected } = useDeviceStates();
  const { send, connected: hubConnected } = useProductionHub();
  const recorderState = deviceStates['ndi-recorder'];

  const currentState = recorderState?.state ?? 'stopped';
  const sources = recorderState?.sources ?? [];
  const archiveProgress = recorderState?.archiveProgress ?? 0;

  const [sessionName, setSessionName] = useState('');

  const handleStart = () => {
    const name = sessionName.trim() || todayString();
    send({ type: 'osc', address: '/recorder/start', args: [name] });
  };

  const handleStop = () => {
    if (window.confirm('Stop recording?')) {
      send({ type: 'osc', address: '/recorder/stop', args: [] });
    }
  };

  const connected = dashConnected && hubConnected;

  return (
    <div style={{
      height: '100vh',
      display: 'flex',
      flexDirection: 'column',
      background: '#020617',
      color: '#E2E8F0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      overflow: 'hidden',
    }}>
      <style>{pulseKeyframes}</style>

      {/* Zone 1 — Header */}
      <div style={{
        height: 80,
        padding: '0 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: '#0F172A',
        borderBottom: '1px solid #1E293B',
        flexShrink: 0,
      }}>
        <StateBadge state={currentState} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {currentState !== 'stopped' && (
            <span style={{
              fontSize: 14,
              color: '#94A3B8',
              fontFamily: 'monospace',
            }}>
              {sessionName.trim() || todayString()}
            </span>
          )}
          <div style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: connected ? '#10B981' : '#EF4444',
          }} />
        </div>
      </div>

      {/* Zone 2 — Sources */}
      <div style={{
        flex: 1,
        padding: '20px 24px',
        overflowY: 'auto',
      }}>
        {sources.length > 0 ? (
          sources.map((source) => (
            <SourceCard key={source.id} source={source} />
          ))
        ) : (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#64748B',
            fontSize: 16,
          }}>
            No sources configured — check agent connection
          </div>
        )}
      </div>

      {/* Zone 3 — Controls */}
      <div style={{
        height: 200,
        padding: '24px',
        background: '#0F172A',
        borderTop: '1px solid #1E293B',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        flexShrink: 0,
      }}>
        {currentState === 'stopped' && (
          <>
            <input
              type="text"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
              placeholder={todayString()}
              style={{
                flex: 1,
                maxWidth: 400,
                padding: '16px 20px',
                fontSize: 18,
                fontFamily: 'monospace',
                background: '#1E293B',
                border: '1px solid #334155',
                borderRadius: 8,
                color: '#E2E8F0',
                outline: 'none',
              }}
            />
            <button
              onClick={handleStart}
              style={{
                padding: '16px 48px',
                fontSize: 20,
                fontWeight: 700,
                color: '#FFF',
                background: '#10B981',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                letterSpacing: 2,
              }}
            >
              START
            </button>
          </>
        )}

        {currentState === 'recording' && (
          <>
            <span style={{
              flex: 1,
              maxWidth: 400,
              padding: '16px 20px',
              fontSize: 18,
              fontFamily: 'monospace',
              background: '#1E293B',
              borderRadius: 8,
              color: '#94A3B8',
            }}>
              {sessionName.trim() || todayString()}
            </span>
            <button
              onClick={handleStop}
              style={{
                padding: '16px 48px',
                fontSize: 20,
                fontWeight: 700,
                color: '#FFF',
                background: '#EF4444',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                letterSpacing: 2,
                animation: 'recorder-pulse 1.5s ease-in-out infinite',
              }}
            >
              STOP
            </button>
          </>
        )}

        {currentState === 'archiving' && (
          <div style={{ width: '100%', maxWidth: 600 }}>
            <div style={{
              fontSize: 14,
              fontWeight: 600,
              color: '#F59E0B',
              marginBottom: 12,
              textAlign: 'center',
            }}>
              Archiving to NAS...
            </div>
            <div style={{
              width: '100%',
              height: 24,
              background: '#1E293B',
              borderRadius: 12,
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${Math.max(0, Math.min(100, archiveProgress * 100))}%`,
                height: '100%',
                background: '#F59E0B',
                borderRadius: 12,
                transition: 'width 0.3s ease-out',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                {archiveProgress > 0.1 && (
                  <span style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: '#000',
                  }}>
                    {Math.round(archiveProgress * 100)}%
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
