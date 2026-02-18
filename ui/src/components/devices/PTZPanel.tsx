import { VISCAState } from '../../hooks/useDeviceStates';

interface PTZPanelProps {
  state: VISCAState | null;
}

function JoystickDisplay({
  panSpeed,
  tiltSpeed
}: {
  panSpeed: number;
  tiltSpeed: number;
}) {
  // Map -1..1 to 0..100 position
  const x = 50 + (panSpeed * 40);
  const y = 50 - (tiltSpeed * 40); // Invert Y for natural feel

  return (
    <div style={{
      width: 100,
      height: 100,
      background: '#1E293B',
      borderRadius: '50%',
      position: 'relative',
      border: '2px solid #334155',
    }}>
      {/* Crosshairs */}
      <div style={{
        position: 'absolute',
        top: '50%',
        left: 0,
        right: 0,
        height: 1,
        background: '#334155',
      }} />
      <div style={{
        position: 'absolute',
        left: '50%',
        top: 0,
        bottom: 0,
        width: 1,
        background: '#334155',
      }} />

      {/* Position indicator */}
      <div style={{
        position: 'absolute',
        width: 16,
        height: 16,
        borderRadius: '50%',
        background: (panSpeed !== 0 || tiltSpeed !== 0) ? '#3B82F6' : '#475569',
        border: '2px solid #E2E8F0',
        left: `calc(${x}% - 8px)`,
        top: `calc(${y}% - 8px)`,
        transition: 'left 0.05s, top 0.05s, background 0.1s',
        boxShadow: (panSpeed !== 0 || tiltSpeed !== 0) ? '0 0 8px #3B82F6' : 'none',
      }} />
    </div>
  );
}

function ZoomSlider({
  position,
  speed
}: {
  position: number;
  speed: number;
}) {
  return (
    <div style={{ flex: 1 }}>
      <div style={{
        fontSize: 10,
        color: '#64748B',
        marginBottom: 4,
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>Zoom</span>
        <span style={{ fontFamily: 'monospace' }}>
          {Math.round(position * 100)}%
        </span>
      </div>
      <div style={{
        height: 8,
        background: '#1E293B',
        borderRadius: 4,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Position fill */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: `${position * 100}%`,
          background: '#06B6D4',
          borderRadius: 4,
          transition: 'width 0.05s',
        }} />
        {/* Speed indicator */}
        {speed !== 0 && (
          <div style={{
            position: 'absolute',
            top: -2,
            left: `calc(${position * 100}% - 6px)`,
            width: 0,
            height: 0,
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderBottom: speed > 0 ? 'none' : '8px solid #F59E0B',
            borderTop: speed > 0 ? '8px solid #F59E0B' : 'none',
          }} />
        )}
      </div>
    </div>
  );
}

function PresetButton({
  number,
  isCurrent,
  isStored
}: {
  number: number;
  isCurrent: boolean;
  isStored: boolean;
}) {
  return (
    <div style={{
      width: 28,
      height: 28,
      borderRadius: 4,
      background: isCurrent ? '#3B82F6' : isStored ? '#1E293B' : '#0F172A',
      border: isStored ? '1px solid #3B82F6' : '1px solid #334155',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 11,
      fontWeight: 600,
      color: isCurrent ? '#FFF' : isStored ? '#3B82F6' : '#475569',
    }}>
      {number}
    </div>
  );
}

function StatusToggle({
  label,
  value,
  activeLabel,
  inactiveLabel,
  activeColor = '#10B981'
}: {
  label: string;
  value: boolean;
  activeLabel: string;
  inactiveLabel: string;
  activeColor?: string;
}) {
  return (
    <div style={{
      padding: '8px 12px',
      background: '#1E293B',
      borderRadius: 6,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    }}>
      <div style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: value ? activeColor : '#475569',
        boxShadow: value ? `0 0 6px ${activeColor}` : 'none',
      }} />
      <span style={{ fontSize: 11, color: '#94A3B8' }}>{label}:</span>
      <span style={{
        fontSize: 11,
        fontWeight: 600,
        color: value ? '#E2E8F0' : '#64748B',
      }}>
        {value ? activeLabel : inactiveLabel}
      </span>
    </div>
  );
}

export default function PTZPanel({ state }: PTZPanelProps) {
  const storedPresets = state?.storedPresets ?? [];
  const currentPreset = state?.currentPreset ?? 0;

  // Show presets 0-9 plus Home
  const presetNumbers = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Main controls row */}
      <div style={{
        display: 'flex',
        gap: 16,
        alignItems: 'flex-start',
        marginBottom: 16,
      }}>
        {/* Joystick */}
        <div>
          <div style={{
            fontSize: 10,
            color: '#64748B',
            marginBottom: 6,
            textAlign: 'center',
          }}>
            Pan/Tilt
          </div>
          <JoystickDisplay
            panSpeed={state?.panSpeed ?? 0}
            tiltSpeed={state?.tiltSpeed ?? 0}
          />
        </div>

        {/* Right column */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Zoom */}
          <ZoomSlider
            position={state?.zoomPosition ?? 0}
            speed={state?.zoomSpeed ?? 0}
          />

          {/* Presets */}
          <div>
            <div style={{
              fontSize: 10,
              color: '#64748B',
              marginBottom: 6,
            }}>
              Presets
            </div>
            <div style={{
              display: 'flex',
              gap: 4,
              flexWrap: 'wrap',
            }}>
              {presetNumbers.map(n => (
                <PresetButton
                  key={n}
                  number={n}
                  isCurrent={currentPreset === n}
                  isStored={storedPresets.includes(n)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Status row */}
      <div style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
      }}>
        <StatusToggle
          label="Power"
          value={state?.power ?? true}
          activeLabel="ON"
          inactiveLabel="OFF"
        />
        <StatusToggle
          label="Focus"
          value={state?.focusMode === 'auto'}
          activeLabel="Auto"
          inactiveLabel="Manual"
          activeColor="#8B5CF6"
        />
      </div>
    </div>
  );
}
