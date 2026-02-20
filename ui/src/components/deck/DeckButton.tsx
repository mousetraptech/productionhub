import { useState, useCallback } from 'react';
import { DeckButton as DeckButtonType } from '../../types';
import { getDeckButtonState, ButtonState } from './useDeckButtonState';

interface DeckButtonProps {
  button: DeckButtonType;
  editing: boolean;
  onFire: (button: DeckButtonType) => void;
  onRemove: () => void;
  onClick?: () => void;
  deviceStates?: any;
}

export function DeckButton({ button, editing, onFire, onRemove, onClick, deviceStates }: DeckButtonProps) {
  const [firing, setFiring] = useState(false);

  const handlePress = useCallback(() => {
    if (editing) {
      onClick?.();
      return;
    }
    onFire(button);
    setFiring(true);
    setTimeout(() => setFiring(false), 200);
  }, [button, editing, onFire, onClick]);

  const buttonState: ButtonState = deviceStates
    ? getDeckButtonState(button, deviceStates)
    : { level: null, active: false, live: false };

  return (
    <div
      onPointerDown={handlePress}
      style={{
        background: firing
          ? button.color + '80'
          : button.color + '26',
        border: `2px solid ${
          buttonState.active ? '#10B981' :
          buttonState.live ? '#EF4444' :
          button.color + (firing ? 'CC' : '55')
        }`,
        borderRadius: 12,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        cursor: editing ? 'default' : 'pointer',
        userSelect: 'none',
        touchAction: 'manipulation',
        position: 'relative',
        aspectRatio: '1',
        transition: 'background 0.2s, border-color 0.2s, transform 0.1s',
        transform: firing ? 'scale(0.95)' : 'scale(1)',
        boxShadow: firing ? `0 0 20px ${button.color}66` : 'none',
      }}
    >
      {buttonState.level !== null && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: `${(buttonState.level ?? 0) * 100}%`,
          background: button.color + '66',
          borderRadius: '0 0 10px 10px',
          transition: 'height 0.15s ease-out',
          pointerEvents: 'none',
        }} />
      )}
      <span style={{ fontSize: 24, pointerEvents: 'none' }}>{button.icon}</span>
      {buttonState.live && (
        <span style={{
          position: 'absolute', top: 4, left: 6,
          fontSize: 8, color: '#EF4444', fontWeight: 700,
          pointerEvents: 'none',
        }}>LIVE</span>
      )}
      <span style={{
        fontSize: 11, color: '#E2E8F0', marginTop: 4,
        textAlign: 'center', padding: '0 4px',
        overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', maxWidth: '100%',
        pointerEvents: 'none',
      }}>
        {button.label}
      </span>
      {button.actions.length > 1 && (
        <span style={{
          position: 'absolute', top: 4, right: 6,
          fontSize: 9, color: '#94A3B8', fontWeight: 700,
          pointerEvents: 'none',
        }}>
          {button.actions.length}
        </span>
      )}
      {button.mode === 'series' && (
        <span style={{
          position: 'absolute', bottom: 4, right: 6,
          fontSize: 8, color: '#94A3B8',
          pointerEvents: 'none',
        }}>
          SER
        </span>
      )}
      {editing && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{
            position: 'absolute', top: -6, right: -6,
            background: '#EF4444', color: '#FFF', border: 'none',
            borderRadius: '50%', width: 20, height: 20,
            fontSize: 12, cursor: 'pointer', lineHeight: '20px',
            padding: 0,
          }}
        >
          x
        </button>
      )}
    </div>
  );
}
