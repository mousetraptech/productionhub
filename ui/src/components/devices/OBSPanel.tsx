import { OBSState } from '../../hooks/useDeviceStates';

interface OBSPanelProps {
  state: OBSState | null;
}

function StatusBadge({
  label,
  active,
  activeColor = '#10B981',
  inactiveColor = '#334155'
}: {
  label: string;
  active: boolean;
  activeColor?: string;
  inactiveColor?: string;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '8px 12px',
      background: '#1E293B',
      borderRadius: 6,
    }}>
      <div style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: active ? activeColor : inactiveColor,
        boxShadow: active ? `0 0 8px ${activeColor}` : 'none',
      }} />
      <span style={{
        fontSize: 12,
        fontWeight: 500,
        color: active ? '#E2E8F0' : '#64748B',
      }}>
        {label}
      </span>
    </div>
  );
}

function SceneDisplay({
  label,
  scene,
  isProgram
}: {
  label: string;
  scene: string;
  isProgram: boolean;
}) {
  return (
    <div style={{
      padding: '12px 16px',
      background: isProgram ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
      border: `2px solid ${isProgram ? '#EF4444' : '#10B981'}`,
      borderRadius: 8,
      flex: 1,
    }}>
      <div style={{
        fontSize: 10,
        color: isProgram ? '#EF4444' : '#10B981',
        fontWeight: 600,
        marginBottom: 4,
        textTransform: 'uppercase',
        letterSpacing: 1,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 14,
        fontWeight: 600,
        color: '#E2E8F0',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {scene || '(none)'}
      </div>
    </div>
  );
}

function SourceItem({
  name,
  visible
}: {
  name: string;
  visible: boolean;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '6px 10px',
      background: '#1E293B',
      borderRadius: 4,
    }}>
      <div style={{
        width: 14,
        height: 14,
        borderRadius: 3,
        background: visible ? '#3B82F6' : '#334155',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        color: '#FFF',
      }}>
        {visible ? '\u2713' : ''}
      </div>
      <span style={{
        fontSize: 11,
        color: visible ? '#E2E8F0' : '#64748B',
      }}>
        {name}
      </span>
    </div>
  );
}

export default function OBSPanel({ state }: OBSPanelProps) {
  const sources = state?.sources ?? {};
  const sourceEntries = Object.entries(sources);

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Scene displays */}
      <div style={{
        display: 'flex',
        gap: 12,
        marginBottom: 16,
      }}>
        <SceneDisplay
          label="Program"
          scene={state?.currentScene ?? ''}
          isProgram={true}
        />
        <SceneDisplay
          label="Preview"
          scene={state?.previewScene ?? ''}
          isProgram={false}
        />
      </div>

      {/* Status badges */}
      <div style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        marginBottom: 16,
      }}>
        <StatusBadge
          label="Streaming"
          active={state?.streaming ?? false}
          activeColor="#EF4444"
        />
        <StatusBadge
          label="Recording"
          active={state?.recording ?? false}
          activeColor="#EF4444"
        />
        <StatusBadge
          label="Virtual Cam"
          active={state?.virtualCam ?? false}
          activeColor="#8B5CF6"
        />
      </div>

      {/* Transition info */}
      <div style={{
        display: 'flex',
        gap: 16,
        padding: '10px 14px',
        background: '#1E293B',
        borderRadius: 6,
        marginBottom: 16,
      }}>
        <div>
          <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>
            Transition
          </div>
          <div style={{ fontSize: 13, color: '#E2E8F0', fontWeight: 500 }}>
            {state?.currentTransition ?? 'Cut'}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>
            Duration
          </div>
          <div style={{ fontSize: 13, color: '#E2E8F0', fontWeight: 500, fontFamily: 'monospace' }}>
            {state?.transitionDuration ?? 300}ms
          </div>
        </div>
      </div>

      {/* Sources */}
      {sourceEntries.length > 0 && (
        <div>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#94A3B8',
            marginBottom: 8,
          }}>
            Sources
          </div>
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
          }}>
            {sourceEntries.map(([name, visible]) => (
              <SourceItem key={name} name={name} visible={visible} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
