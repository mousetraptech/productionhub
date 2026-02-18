import { AvantisState, AvantisStrip } from '../../hooks/useDeviceStates';

interface AvantisPanelProps {
  state: AvantisState | null;
}

// Bank definitions: what strips are visible per layer/bank
const LAYER_BANKS = [
  { label: 'Ch 1-12', strips: Array.from({ length: 12 }, (_, i) => ({ key: `ch/${i + 1}`, label: `Ch ${i + 1}` })) },
  { label: 'Ch 13-24', strips: Array.from({ length: 12 }, (_, i) => ({ key: `ch/${i + 13}`, label: `Ch ${i + 13}` })) },
  { label: 'Ch 25-36', strips: Array.from({ length: 12 }, (_, i) => ({ key: `ch/${i + 25}`, label: `Ch ${i + 25}` })) },
  { label: 'Ch 37-48', strips: Array.from({ length: 12 }, (_, i) => ({ key: `ch/${i + 37}`, label: `Ch ${i + 37}` })) },
  { label: 'Ch 49-64', strips: Array.from({ length: 12 }, (_, i) => ({ key: `ch/${i + 49}`, label: i + 49 <= 64 ? `Ch ${i + 49}` : '' })).filter(s => s.label) },
  { label: 'Mix 1-12', strips: Array.from({ length: 12 }, (_, i) => ({ key: `mix/${i + 1}`, label: `Mix ${i + 1}` })) },
  { label: 'DCA 1-12', strips: Array.from({ length: 12 }, (_, i) => ({ key: `dca/${i + 1}`, label: i < 16 ? `DCA ${i + 1}` : '' })).filter(s => s.label) },
  { label: 'Grp/FX/Mtx', strips: [
    ...Array.from({ length: 4 }, (_, i) => ({ key: `grp/${i + 1}`, label: `Grp ${i + 1}` })),
    ...Array.from({ length: 4 }, (_, i) => ({ key: `fxsend/${i + 1}`, label: `FX S${i + 1}` })),
    ...Array.from({ length: 4 }, (_, i) => ({ key: `fxrtn/${i + 1}`, label: `FX R${i + 1}` })),
  ]},
];

function getStrip(state: AvantisState | null, key: string): AvantisStrip {
  return state?.strips?.[key] ?? { fader: 0, mute: false, pan: 0.5 };
}

// Fake EQ curve SVG for the touchscreen display
function EQCurve({ strip, color }: { strip: AvantisStrip; color: string }) {
  // Generate a deterministic but varied EQ curve based on fader/pan
  const f = strip.fader;
  const p = strip.pan;
  const mid = 18 + (p - 0.5) * 6;
  const d = `M 0 ${20 - f * 4} Q ${12 + p * 8} ${mid - f * 8} 24 ${16 - f * 2} Q ${36 - p * 6} ${mid + f * 4} 48 ${20 - f * 3}`;
  return (
    <svg viewBox="0 0 48 36" style={{ width: '100%', height: 20 }}>
      <path d={d} stroke={color} strokeWidth={1.2} fill="none" opacity={0.8} />
      <line x1={0} y1={18} x2={48} y2={18} stroke="#334155" strokeWidth={0.3} />
    </svg>
  );
}

// Meter LED column
function MeterLEDs({ level, width = 3 }: { level: number; width?: number }) {
  const totalLEDs = 12;
  const litLEDs = Math.round(level * totalLEDs);
  return (
    <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 1, height: 36 }}>
      {Array.from({ length: totalLEDs }, (_, i) => {
        const lit = i < litLEDs;
        let color = '#10B981'; // green
        if (i >= 10) color = '#EF4444'; // red
        else if (i >= 8) color = '#F59E0B'; // amber
        return (
          <div key={i} style={{
            width,
            height: 2,
            borderRadius: 0.5,
            background: lit ? color : '#1a1a2e',
            opacity: lit ? 1 : 0.3,
          }} />
        );
      })}
    </div>
  );
}

// Touchscreen channel strip (shown on the screen displays)
function ScreenStrip({ strip, label, color, active }: {
  strip: AvantisStrip;
  label: string;
  color: string;
  active?: boolean;
}) {
  return (
    <div style={{
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 1,
      padding: '2px 1px',
      background: active ? '#1a2744' : 'transparent',
      borderRight: '1px solid #1a1a2e',
    }}>
      {/* Channel name */}
      <div style={{
        fontSize: 5.5,
        color: color,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        width: '100%',
        textAlign: 'center',
        padding: '1px 0',
        background: `${color}20`,
        borderRadius: 1,
      }}>
        {label}
      </div>

      {/* EQ curve */}
      <EQCurve strip={strip} color={color} />

      {/* Meter + fader */}
      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 36 }}>
        <MeterLEDs level={strip.fader * 0.9} />
        {/* Mini fader */}
        <div style={{
          width: 4,
          height: 36,
          background: '#0a0a1a',
          borderRadius: 2,
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute',
            bottom: 0,
            width: '100%',
            height: `${strip.fader * 100}%`,
            background: `linear-gradient(to top, ${color}88, ${color})`,
            borderRadius: 2,
            transition: 'height 0.08s',
          }} />
          {/* Fader cap */}
          <div style={{
            position: 'absolute',
            bottom: `calc(${strip.fader * 100}% - 2px)`,
            left: -1,
            width: 6,
            height: 4,
            background: '#CBD5E1',
            borderRadius: 1,
            transition: 'bottom 0.08s',
          }} />
        </div>
        <MeterLEDs level={strip.fader * 0.85} />
      </div>

      {/* Pan */}
      <div style={{
        width: '80%',
        height: 3,
        background: '#0a0a1a',
        borderRadius: 2,
        position: 'relative',
        marginTop: 1,
      }}>
        <div style={{
          position: 'absolute',
          width: 4,
          height: 3,
          background: '#94A3B8',
          borderRadius: 1,
          left: `calc(${strip.pan * 100}% - 2px)`,
          transition: 'left 0.08s',
        }} />
      </div>

      {/* Mute indicator */}
      <div style={{
        width: '80%',
        height: 6,
        background: strip.mute ? '#EF4444' : '#1E293B',
        borderRadius: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 4,
        color: strip.mute ? '#fff' : '#475569',
        fontWeight: 700,
      }}>
        M
      </div>

      {/* Value */}
      <div style={{
        fontSize: 5,
        color: '#64748B',
        fontFamily: 'monospace',
      }}>
        {Math.round(strip.fader * 100)}
      </div>
    </div>
  );
}

// Touchscreen display component
function TouchScreen({ strips, state, bankLabel, side }: {
  strips: { key: string; label: string }[];
  state: AvantisState | null;
  bankLabel: string;
  side: 'left' | 'right';
}) {
  const screenColors = [
    '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6',
    '#EC4899', '#06B6D4', '#EF4444', '#FBBF24',
    '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6',
  ];

  return (
    <div style={{
      flex: 1,
      background: '#000',
      borderRadius: 4,
      border: '2px solid #1a1a2e',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Screen top bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '2px 6px',
        background: '#0a0a1a',
        borderBottom: '1px solid #1a1a2e',
      }}>
        <span style={{ fontSize: 6, color: '#64748B' }}>{bankLabel}</span>
        <span style={{ fontSize: 6, color: '#3B82F6' }}>
          {side === 'left' ? 'Main' : 'Assign'}
        </span>
      </div>

      {/* Tab buttons */}
      <div style={{
        display: 'flex',
        gap: 1,
        padding: '2px 4px',
        background: '#050510',
      }}>
        {['Processing', 'Routing', 'I/O', 'Ganging', side === 'left' ? 'Meters' : 'FX', 'Scenes', 'Setup'].map((tab, i) => (
          <div key={tab} style={{
            flex: 1,
            padding: '2px 0',
            fontSize: 4.5,
            textAlign: 'center',
            color: i === 0 ? '#fff' : '#475569',
            background: i === 0 ? '#3B82F6' : '#111827',
            borderRadius: 1,
            cursor: 'pointer',
          }}>
            {tab}
          </div>
        ))}
      </div>

      {/* Channel strips */}
      <div style={{
        flex: 1,
        display: 'flex',
        padding: '2px 2px 4px',
        background: '#050510',
        gap: 0,
      }}>
        {strips.map((s, i) => (
          <ScreenStrip
            key={s.key}
            strip={getStrip(state, s.key)}
            label={s.label}
            color={screenColors[i % screenColors.length]}
            active={i === 0}
          />
        ))}
      </div>
    </div>
  );
}

// Physical rotary encoder
function RotaryEncoder({ size = 10, color = '#1E293B' }: { size?: number; color?: string }) {
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: '50%',
      background: `radial-gradient(circle at 35% 35%, #475569, ${color})`,
      border: '1px solid #0F172A',
      boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.1)',
    }}>
      {/* Indicator line */}
      <div style={{
        width: 1,
        height: size * 0.35,
        background: '#94A3B8',
        margin: '2px auto 0',
        borderRadius: 1,
      }} />
    </div>
  );
}

// Physical fader strip at the bottom
function PhysicalFader({ strip, label, color }: {
  strip: AvantisStrip;
  label: string;
  color: string;
}) {
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 2,
      flex: 1,
      minWidth: 0,
    }}>
      {/* Rotary encoder */}
      <RotaryEncoder size={8} />

      {/* Select button */}
      <div style={{
        width: 8,
        height: 5,
        borderRadius: 1,
        background: '#1E293B',
        border: '0.5px solid #334155',
      }} />

      {/* LED meter */}
      <div style={{ display: 'flex', gap: 1 }}>
        <MeterLEDs level={strip.fader * 0.9} width={2} />
      </div>

      {/* Mute button */}
      <div style={{
        width: 10,
        height: 6,
        borderRadius: 1.5,
        background: strip.mute ? '#EF4444' : '#1a1a2e',
        border: `0.5px solid ${strip.mute ? '#EF4444' : '#334155'}`,
        boxShadow: strip.mute ? '0 0 4px #EF444488' : 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 4,
        color: strip.mute ? '#fff' : '#475569',
        fontWeight: 700,
      }}>
        M
      </div>

      {/* Fader slot */}
      <div style={{
        width: 6,
        height: 60,
        background: '#0a0a12',
        borderRadius: 3,
        position: 'relative',
        border: '0.5px solid #1a1a2e',
      }}>
        {/* Fader travel marks */}
        {[0, 0.25, 0.5, 0.75, 1].map(mark => (
          <div key={mark} style={{
            position: 'absolute',
            bottom: `${mark * 100}%`,
            left: -2,
            width: 10,
            height: 0.5,
            background: '#1E293B',
          }} />
        ))}

        {/* Fader cap */}
        <div style={{
          position: 'absolute',
          bottom: `calc(${strip.fader * 100}% - 5px)`,
          left: -2,
          width: 10,
          height: 10,
          background: 'linear-gradient(to bottom, #555, #333, #444)',
          borderRadius: 2,
          border: '0.5px solid #666',
          boxShadow: '0 1px 3px rgba(0,0,0,0.5)',
          transition: 'bottom 0.08s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {/* Fader cap line */}
          <div style={{
            width: 6,
            height: 0.5,
            background: '#888',
            borderRadius: 1,
          }} />
        </div>
      </div>

      {/* Channel label */}
      <div style={{
        fontSize: 4.5,
        color: color,
        fontWeight: 600,
        whiteSpace: 'nowrap',
        marginTop: 1,
        padding: '1px 2px',
        background: `${color}20`,
        borderRadius: 1,
        textAlign: 'center',
        width: '100%',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {label}
      </div>
    </div>
  );
}

// Center section between the two screens
function CenterSection({ state }: { state: AvantisState | null }) {
  return (
    <div style={{
      width: 28,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      padding: '4px 0',
    }}>
      {/* Top button */}
      <div style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: '#10B981',
        border: '1px solid #0F172A',
        boxShadow: '0 0 4px #10B98144',
      }} />

      {/* Scene indicator */}
      <div style={{
        width: 16,
        height: 20,
        background: '#000',
        borderRadius: 2,
        border: '1px solid #1a1a2e',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
      }}>
        <span style={{ fontSize: 4, color: '#64748B' }}>SCN</span>
        <span style={{
          fontSize: 7,
          fontWeight: 700,
          color: '#10B981',
          fontFamily: 'monospace',
        }}>
          {state?.currentScene ?? 0}
        </span>
      </div>

      {/* Navigation buttons */}
      {[0, 1, 2].map(i => (
        <div key={i} style={{
          width: 10,
          height: 6,
          borderRadius: 1.5,
          background: i === 1 ? '#EF4444' : '#1E293B',
          border: '0.5px solid #334155',
          boxShadow: i === 1 ? '0 0 3px #EF444444' : 'none',
        }} />
      ))}

      {/* Bottom indicator */}
      <div style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: '#3B82F6',
        boxShadow: '0 0 6px #3B82F644',
      }} />
    </div>
  );
}

// Center fader section (between left and right fader banks)
function CenterFaderControls() {
  return (
    <div style={{
      width: 24,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '4px 0',
      gap: 3,
    }}>
      {/* User assignable buttons */}
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} style={{
          width: 12,
          height: 8,
          borderRadius: 2,
          background: '#1E293B',
          border: '0.5px solid #334155',
        }} />
      ))}

      {/* Blue indicator */}
      <div style={{
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: '#3B82F6',
        boxShadow: '0 0 6px #3B82F644',
        margin: '4px 0',
      }} />

      {/* Arrow keys */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center' }}>
        <div style={{ width: 8, height: 6, borderRadius: 1, background: '#1E293B', border: '0.5px solid #334155' }} />
        <div style={{ display: 'flex', gap: 2 }}>
          <div style={{ width: 8, height: 6, borderRadius: 1, background: '#1E293B', border: '0.5px solid #334155' }} />
          <div style={{ width: 8, height: 6, borderRadius: 1, background: '#1E293B', border: '0.5px solid #334155' }} />
        </div>
        <div style={{ width: 8, height: 6, borderRadius: 1, background: '#1E293B', border: '0.5px solid #334155' }} />
      </div>
    </div>
  );
}

export default function AvantisPanel({ state }: AvantisPanelProps) {
  // Left bank: first 12 channels, Right bank: next 12 channels (default view)
  const leftBank = LAYER_BANKS[0]; // Ch 1-12
  const rightBank = LAYER_BANKS[1]; // Ch 13-24

  const leftStrips = leftBank.strips;
  const rightStrips = rightBank.strips;

  // Get colors for physical faders
  const faderColor = (key: string) => {
    if (key.startsWith('ch/')) return '#3B82F6';
    if (key.startsWith('mix/')) return '#10B981';
    if (key.startsWith('dca/')) return '#EF4444';
    if (key.startsWith('grp/')) return '#F59E0B';
    if (key.startsWith('fxsend/')) return '#8B5CF6';
    if (key.startsWith('fxrtn/')) return '#EC4899';
    if (key.startsWith('mtx/')) return '#06B6D4';
    if (key === 'main') return '#FBBF24';
    return '#64748B';
  };

  return (
    <div style={{ padding: '4px 0' }}>
      {/* ===== CONSOLE CHASSIS ===== */}
      <div style={{
        background: 'linear-gradient(180deg, #2a2a30 0%, #1a1a20 40%, #222228 100%)',
        borderRadius: 12,
        padding: 6,
        position: 'relative',
        boxShadow: '0 8px 32px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
        border: '1px solid #333',
      }}>
        {/* Red corner bumpers */}
        {/* Top-left */}
        <div style={{
          position: 'absolute', top: 3, left: 3,
          width: 4, height: 20, background: '#DC2626',
          borderRadius: '6px 0 0 0',
          boxShadow: '0 0 4px #DC262644',
        }} />
        <div style={{
          position: 'absolute', top: 3, left: 3,
          width: 20, height: 4, background: '#DC2626',
          borderRadius: '6px 0 0 0',
          boxShadow: '0 0 4px #DC262644',
        }} />
        {/* Top-right */}
        <div style={{
          position: 'absolute', top: 3, right: 3,
          width: 4, height: 20, background: '#DC2626',
          borderRadius: '0 6px 0 0',
          boxShadow: '0 0 4px #DC262644',
        }} />
        <div style={{
          position: 'absolute', top: 3, right: 3,
          width: 20, height: 4, background: '#DC2626',
          borderRadius: '0 6px 0 0',
          boxShadow: '0 0 4px #DC262644',
        }} />
        {/* Bottom-left */}
        <div style={{
          position: 'absolute', bottom: 3, left: 3,
          width: 4, height: 20, background: '#DC2626',
          borderRadius: '0 0 0 6px',
          boxShadow: '0 0 4px #DC262644',
        }} />
        <div style={{
          position: 'absolute', bottom: 3, left: 3,
          width: 20, height: 4, background: '#DC2626',
          borderRadius: '0 0 0 6px',
          boxShadow: '0 0 4px #DC262644',
        }} />
        {/* Bottom-right */}
        <div style={{
          position: 'absolute', bottom: 3, right: 3,
          width: 4, height: 20, background: '#DC2626',
          borderRadius: '0 0 6px 0',
          boxShadow: '0 0 4px #DC262644',
        }} />
        <div style={{
          position: 'absolute', bottom: 3, right: 3,
          width: 20, height: 4, background: '#DC2626',
          borderRadius: '0 0 6px 0',
          boxShadow: '0 0 4px #DC262644',
        }} />

        {/* Logo bar */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '2px 12px 4px',
        }}>
          <span style={{
            fontSize: 7,
            fontWeight: 300,
            color: '#94A3B8',
            letterSpacing: '0.15em',
            fontStyle: 'italic',
          }}>
            avantis
          </span>
          <span style={{
            fontSize: 6,
            fontWeight: 700,
            color: '#94A3B8',
            letterSpacing: '0.1em',
          }}>
            ALLEN&HEATH
          </span>
        </div>

        {/* ===== TOUCHSCREEN SECTION ===== */}
        <div style={{
          display: 'flex',
          gap: 0,
          alignItems: 'stretch',
          marginBottom: 6,
          padding: '0 4px',
        }}>
          {/* Left screen */}
          <TouchScreen
            strips={leftStrips}
            state={state}
            bankLabel={leftBank.label}
            side="left"
          />

          {/* Center controls between screens */}
          <CenterSection state={state} />

          {/* Right screen */}
          <TouchScreen
            strips={rightStrips}
            state={state}
            bankLabel={rightBank.label}
            side="right"
          />

          {/* Right-side rotary encoders */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: '4px 2px',
            justifyContent: 'flex-start',
          }}>
            <RotaryEncoder size={10} color="#2a2a35" />
            <RotaryEncoder size={10} color="#2a2a35" />
          </div>
        </div>

        {/* Encoder row above faders */}
        <div style={{
          display: 'flex',
          padding: '2px 6px',
          gap: 0,
          marginBottom: 4,
        }}>
          {/* Left bank encoders */}
          <div style={{ flex: 1, display: 'flex', justifyContent: 'space-around' }}>
            {leftStrips.map(s => (
              <RotaryEncoder key={s.key} size={7} />
            ))}
          </div>
          <div style={{ width: 24 }} />
          {/* Right bank encoders */}
          <div style={{ flex: 1, display: 'flex', justifyContent: 'space-around' }}>
            {rightStrips.map(s => (
              <RotaryEncoder key={s.key} size={7} />
            ))}
          </div>
        </div>

        {/* ===== FADER SECTION ===== */}
        <div style={{
          display: 'flex',
          gap: 0,
          padding: '4px 6px 8px',
          background: 'linear-gradient(180deg, #1a1a20 0%, #151518 100%)',
          borderRadius: 6,
          border: '1px solid #1a1a2e',
        }}>
          {/* Left fader bank (12 faders) */}
          <div style={{ flex: 1, display: 'flex', gap: 1 }}>
            {leftStrips.map(s => (
              <PhysicalFader
                key={s.key}
                strip={getStrip(state, s.key)}
                label={s.label}
                color={faderColor(s.key)}
              />
            ))}
          </div>

          {/* Center controls */}
          <CenterFaderControls />

          {/* Right fader bank (12 faders) */}
          <div style={{ flex: 1, display: 'flex', gap: 1 }}>
            {rightStrips.map(s => (
              <PhysicalFader
                key={s.key}
                strip={getStrip(state, s.key)}
                label={s.label}
                color={faderColor(s.key)}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Summary stats below the console */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: 12,
        marginTop: 8,
        padding: '6px 0',
      }}>
        <span style={{ fontSize: 9, color: '#475569' }}>
          Scene: <span style={{ color: '#10B981', fontWeight: 600, fontFamily: 'monospace' }}>{state?.currentScene ?? 0}</span>
        </span>
        <span style={{ fontSize: 9, color: '#475569' }}>
          Strips: <span style={{ color: '#94A3B8', fontFamily: 'monospace' }}>{state ? Object.keys(state.strips).length : 0}</span>
        </span>
      </div>
    </div>
  );
}
