import { RecorderState, RecorderSource } from '../../hooks/useDeviceStates';

interface RecorderPanelProps {
  state: RecorderState | null;
}

const pulseKeyframes = `
@keyframes recorder-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
`;

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
      gap: 8,
      padding: '8px 16px',
      background: color,
      borderRadius: 6,
      animation: isRecording ? 'recorder-pulse 1.5s ease-in-out infinite' : 'none',
    }}>
      <span style={{
        fontSize: 13,
        fontWeight: 700,
        color: '#FFF',
        letterSpacing: 1,
      }}>
        {label}
      </span>
    </div>
  );
}

function vuDbToPercent(vuDb: number): number {
  // Map -60..0 to 0..100
  const clamped = Math.max(-60, Math.min(0, vuDb));
  return ((clamped + 60) / 60) * 100;
}

function vuDbColor(vuDb: number): string {
  if (vuDb > -6) return '#EF4444';   // red
  if (vuDb > -12) return '#F59E0B';  // yellow
  return '#10B981';                    // green
}

function SourceRow({ source }: { source: RecorderSource }) {
  const percent = vuDbToPercent(source.vuDb);
  const color = vuDbColor(source.vuDb);

  return (
    <div style={{
      padding: '8px 12px',
      background: '#1E293B',
      borderRadius: 6,
      marginBottom: 6,
    }}>
      {/* Name and frame count */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
      }}>
        <span style={{
          fontSize: 12,
          fontWeight: 500,
          color: '#E2E8F0',
        }}>
          {source.name}
        </span>
        <span style={{
          fontSize: 11,
          fontFamily: 'monospace',
          color: '#94A3B8',
        }}>
          {source.frames.toLocaleString()} frames
        </span>
      </div>

      {/* VU meter bar */}
      <div style={{
        width: '100%',
        height: 6,
        background: '#0F172A',
        borderRadius: 3,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${percent}%`,
          height: '100%',
          background: color,
          borderRadius: 3,
          transition: 'width 0.1s ease-out, background 0.1s ease-out',
        }} />
      </div>
    </div>
  );
}

function ArchiveProgress({ progress }: { progress: number }) {
  const clamped = Math.max(0, Math.min(100, progress));

  return (
    <div style={{
      padding: '10px 14px',
      background: '#1E293B',
      borderRadius: 6,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
      }}>
        <span style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#94A3B8',
        }}>
          Archive Progress
        </span>
        <span style={{
          fontSize: 12,
          fontWeight: 600,
          fontFamily: 'monospace',
          color: '#F59E0B',
        }}>
          {Math.round(clamped)}%
        </span>
      </div>
      <div style={{
        width: '100%',
        height: 8,
        background: '#0F172A',
        borderRadius: 4,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${clamped}%`,
          height: '100%',
          background: '#F59E0B',
          borderRadius: 4,
          transition: 'width 0.3s ease-out',
        }} />
      </div>
    </div>
  );
}

export default function RecorderPanel({ state }: RecorderPanelProps) {
  const sources = state?.sources ?? [];
  const currentState = state?.state ?? 'stopped';

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Inject pulse animation keyframes */}
      <style>{pulseKeyframes}</style>

      {/* State indicator */}
      <div style={{ marginBottom: 16 }}>
        <StateBadge state={currentState} />
      </div>

      {/* Sources */}
      {sources.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#94A3B8',
            marginBottom: 8,
          }}>
            Sources
          </div>
          {sources.map((source) => (
            <SourceRow key={source.id} source={source} />
          ))}
        </div>
      )}

      {/* Archive progress — only when archiving */}
      {currentState === 'archiving' && (
        <ArchiveProgress progress={state?.archiveProgress ?? 0} />
      )}
    </div>
  );
}
