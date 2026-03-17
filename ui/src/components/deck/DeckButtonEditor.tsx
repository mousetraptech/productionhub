import { DeckButton } from '../../types';
import { BUTTON_TYPES, ButtonType } from './buttonTypes';

interface DeckButtonEditorProps {
  button: DeckButton;
  row: number;
  col: number;
  onUpdate: (row: number, col: number, updates: Partial<DeckButton>) => void;
  onRemoveAction: (row: number, col: number, actionIndex: number) => void;
  onClose: () => void;
}

const FONT_MONO = "'IBM Plex Mono', monospace";

const labelStyle: React.CSSProperties = {
  display: 'block', fontFamily: FONT_MONO, fontSize: 10,
  color: '#888', letterSpacing: '0.1em', textTransform: 'uppercase',
  marginBottom: 4, marginTop: 14,
};

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#1c1c1c', color: '#e8e8e8',
  border: '1px solid #333', borderRadius: 2,
  fontFamily: FONT_MONO, fontSize: 12, padding: '7px 10px',
  boxSizing: 'border-box', outline: 'none',
};

export function DeckButtonEditor({
  button, row, col, onUpdate, onRemoveAction, onClose,
}: DeckButtonEditorProps) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.85)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#141414', borderRadius: 4, padding: 24,
          minWidth: 360, maxWidth: 400, border: '1px solid #333',
          maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        <h3 style={{
          margin: '0 0 16px', fontFamily: FONT_MONO, fontSize: 11,
          fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase',
          color: '#c8a96e',
        }}>
          Edit Button
        </h3>

        {/* Label */}
        <label style={labelStyle}>Label (use \n for line break)</label>
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
          style={{ ...inputStyle, width: 80 }}
        />

        {/* Button Type */}
        <label style={labelStyle}>Type</label>
        <select
          value={button.buttonType ?? ''}
          onChange={(e) => {
            const val = e.target.value;
            if (val === '') {
              onUpdate(row, col, { buttonType: undefined });
            } else {
              onUpdate(row, col, { buttonType: val as ButtonType });
            }
          }}
          style={{ ...inputStyle }}
        >
          <option value="">Auto-detect</option>
          {(Object.keys(BUTTON_TYPES) as ButtonType[]).map(t => (
            <option key={t} value={t}>{BUTTON_TYPES[t].label}</option>
          ))}
        </select>

        {/* Mode */}
        <label style={labelStyle}>Execution Mode</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          {(['parallel', 'series'] as const).map(m => (
            <button
              key={m}
              onClick={() => onUpdate(row, col, { mode: m })}
              style={{
                fontFamily: FONT_MONO, fontSize: 10, letterSpacing: '0.1em',
                textTransform: 'uppercase',
                background: button.mode === m ? '#1c1c1c' : 'transparent',
                color: button.mode === m ? '#e8e8e8' : '#555',
                border: `1px solid ${button.mode === m ? '#c8a96e' : '#333'}`,
                borderRadius: 2, padding: '5px 12px', cursor: 'pointer',
              }}
            >
              {m}
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

        {/* Prompt before fire */}
        <label style={labelStyle}>Prompt before fire</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <input
            type="checkbox"
            checked={!!button.prompt}
            onChange={(e) => {
              if (e.target.checked) {
                onUpdate(row, col, { prompt: { message: 'Session name:' } });
              } else {
                onUpdate(row, col, { prompt: undefined });
              }
            }}
            style={{ accentColor: '#c8a96e' }}
          />
          <span style={{ fontFamily: FONT_MONO, color: '#888', fontSize: 10 }}>
            Ask for input before firing
          </span>
        </div>
        {button.prompt && (
          <>
            <label style={labelStyle}>Prompt message</label>
            <input
              type="text"
              value={button.prompt.message}
              onChange={(e) => onUpdate(row, col, { prompt: { ...button.prompt!, message: e.target.value } })}
              style={inputStyle}
            />
            <label style={labelStyle}>Default value</label>
            <input
              type="text"
              value={button.prompt.default ?? ''}
              onChange={(e) => onUpdate(row, col, { prompt: { ...button.prompt!, default: e.target.value || undefined } })}
              style={inputStyle}
            />
          </>
        )}

        {/* Action stack */}
        <label style={labelStyle}>Actions ({button.actions.length})</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {button.actions.map((action, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#1c1c1c', borderRadius: 2, padding: '6px 8px',
              border: '1px solid #2a2a2a',
            }}>
              <span style={{
                flex: 1, fontSize: 10, color: '#888', fontFamily: FONT_MONO,
              }}>
                {action.osc ? action.osc.label : action.actionId}
              </span>
              <button
                onClick={() => onRemoveAction(row, col, i)}
                style={{
                  background: 'none', border: 'none', color: '#f08080',
                  cursor: 'pointer', fontSize: 12, padding: '0 4px',
                  fontFamily: FONT_MONO,
                }}
              >x</button>
            </div>
          ))}
        </div>

        <div style={{
          marginTop: 14, fontFamily: FONT_MONO, fontSize: 9,
          color: '#555', textAlign: 'center', letterSpacing: '0.05em',
        }}>
          Close editor and drag actions onto the button to add more
        </div>
      </div>
    </div>
  );
}
