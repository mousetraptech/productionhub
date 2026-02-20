import { DeckButton } from '../../types';

interface DeckButtonEditorProps {
  button: DeckButton;
  row: number;
  col: number;
  onUpdate: (row: number, col: number, updates: Partial<DeckButton>) => void;
  onRemoveAction: (row: number, col: number, actionIndex: number) => void;
  onClose: () => void;
}

export function DeckButtonEditor({
  button, row, col, onUpdate, onRemoveAction, onClose,
}: DeckButtonEditorProps) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.6)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1E293B', borderRadius: 12, padding: 20,
          minWidth: 320, maxWidth: 400, border: '1px solid #334155',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: '#E2E8F0', fontSize: 16 }}>Edit Button</h3>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#94A3B8',
            cursor: 'pointer', fontSize: 18,
          }}>x</button>
        </div>

        {/* Label */}
        <label style={labelStyle}>Label</label>
        <input
          type="text"
          value={button.label}
          onChange={(e) => onUpdate(row, col, { label: e.target.value })}
          style={inputStyle}
        />

        {/* Icon */}
        <label style={labelStyle}>Icon</label>
        <input
          type="text"
          value={button.icon}
          onChange={(e) => onUpdate(row, col, { icon: e.target.value })}
          style={{ ...inputStyle, width: 60 }}
        />

        {/* Color */}
        <label style={labelStyle}>Color</label>
        <input
          type="color"
          value={button.color}
          onChange={(e) => onUpdate(row, col, { color: e.target.value })}
          style={{ ...inputStyle, width: 60, height: 32, padding: 2 }}
        />

        {/* Mode */}
        <label style={labelStyle}>Execution Mode</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['parallel', 'series'] as const).map(m => (
            <button
              key={m}
              onClick={() => onUpdate(row, col, { mode: m })}
              style={{
                background: button.mode === m ? '#3B82F6' : '#0F172A',
                color: '#E2E8F0', border: '1px solid #475569',
                borderRadius: 6, padding: '6px 14px', cursor: 'pointer',
                fontSize: 13, fontWeight: button.mode === m ? 700 : 400,
              }}
            >
              {m === 'parallel' ? 'Parallel' : 'Series'}
            </button>
          ))}
        </div>

        {/* Series gap */}
        {button.mode === 'series' && (
          <>
            <label style={labelStyle}>Gap (ms)</label>
            <input
              type="number"
              value={button.seriesGap}
              min={0} step={100}
              onChange={(e) => onUpdate(row, col, { seriesGap: parseInt(e.target.value) || 0 })}
              style={{ ...inputStyle, width: 100 }}
            />
          </>
        )}

        {/* Action stack */}
        <label style={labelStyle}>Actions ({button.actions.length})</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {button.actions.map((action, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#0F172A', borderRadius: 6, padding: '6px 8px',
            }}>
              <span style={{ flex: 1, fontSize: 12, color: '#CBD5E1', fontFamily: 'monospace' }}>
                {action.osc ? action.osc.label : action.actionId}
              </span>
              <button
                onClick={() => onRemoveAction(row, col, i)}
                style={{
                  background: 'none', border: 'none', color: '#EF4444',
                  cursor: 'pointer', fontSize: 14, padding: '0 4px',
                }}
              >x</button>
            </div>
          ))}
        </div>

        <div style={{
          marginTop: 12, fontSize: 11, color: '#475569', textAlign: 'center',
        }}>
          Close editor and drag actions onto the button to add more
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', color: '#94A3B8', fontSize: 11,
  marginBottom: 4, marginTop: 12, textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const inputStyle: React.CSSProperties = {
  background: '#0F172A', color: '#E2E8F0', border: '1px solid #475569',
  borderRadius: 6, padding: '6px 8px', fontSize: 14, width: '100%',
  boxSizing: 'border-box',
};
