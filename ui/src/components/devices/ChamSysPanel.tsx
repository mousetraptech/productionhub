import { ChamSysState, ChamSysPlayback } from '../../hooks/useDeviceStates';

interface ChamSysPanelProps {
  state: ChamSysState | null;
}

function PlaybackButton({
  pbKey,
  playback
}: {
  pbKey: string;
  playback: ChamSysPlayback;
}) {
  const levelHeight = playback.level * 100;

  return (
    <div style={{
      width: 48,
      height: 64,
      background: '#1E293B',
      borderRadius: 6,
      position: 'relative',
      overflow: 'hidden',
      border: playback.active ? '2px solid #10B981' : '2px solid transparent',
    }}>
      {/* Level fill */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: `${levelHeight}%`,
        background: playback.active
          ? 'linear-gradient(to top, #10B981, #34D399)'
          : 'linear-gradient(to top, #334155, #475569)',
        transition: 'height 0.1s, background 0.2s',
      }} />

      {/* Label */}
      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}>
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          color: '#E2E8F0',
        }}>
          {pbKey}
        </span>
        <span style={{
          fontSize: 8,
          color: '#94A3B8',
          fontFamily: 'monospace',
        }}>
          {Math.round(playback.level * 100)}%
        </span>
      </div>

      {/* Active indicator */}
      {playback.active && (
        <div style={{
          position: 'absolute',
          top: 4,
          right: 4,
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: '#10B981',
          boxShadow: '0 0 6px #10B981',
        }} />
      )}
    </div>
  );
}

export default function ChamSysPanel({ state }: ChamSysPanelProps) {
  const playbacks = state?.playbacks ?? {};
  const playbackEntries = Object.entries(playbacks);

  // Group playbacks by X value (row)
  const groupedPlaybacks: Record<string, [string, ChamSysPlayback][]> = {};
  for (const [key, pb] of playbackEntries) {
    const [x] = key.split('/');
    if (!groupedPlaybacks[x]) {
      groupedPlaybacks[x] = [];
    }
    groupedPlaybacks[x].push([key, pb]);
  }

  const rows = Object.entries(groupedPlaybacks).sort(
    ([a], [b]) => parseInt(a) - parseInt(b)
  );

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Last action indicators */}
      <div style={{
        display: 'flex',
        gap: 16,
        marginBottom: 16,
        padding: '10px 14px',
        background: '#1E293B',
        borderRadius: 6,
      }}>
        <div>
          <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>
            Last Exec
          </div>
          <div style={{
            fontSize: 14,
            fontWeight: 600,
            color: state?.lastExec ? '#10B981' : '#475569',
            fontFamily: 'monospace',
          }}>
            {state?.lastExec || '-'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>
            Last Release
          </div>
          <div style={{
            fontSize: 14,
            fontWeight: 600,
            color: state?.lastRelease ? '#F59E0B' : '#475569',
            fontFamily: 'monospace',
          }}>
            {state?.lastRelease || '-'}
          </div>
        </div>
      </div>

      {/* Playback grid */}
      {rows.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map(([x, pbs]) => (
            <div key={x}>
              <div style={{
                fontSize: 10,
                color: '#64748B',
                marginBottom: 4,
              }}>
                Row {x}
              </div>
              <div style={{
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
              }}>
                {pbs
                  .sort(([a], [b]) => {
                    const aY = parseInt(a.split('/')[1]);
                    const bY = parseInt(b.split('/')[1]);
                    return aY - bY;
                  })
                  .map(([key, pb]) => (
                    <PlaybackButton key={key} pbKey={key} playback={pb} />
                  ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{
          padding: 20,
          textAlign: 'center',
          color: '#64748B',
          fontSize: 12,
        }}>
          No playbacks active
        </div>
      )}
    </div>
  );
}
