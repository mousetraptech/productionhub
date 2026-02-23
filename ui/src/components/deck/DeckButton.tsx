import { useState, useCallback } from 'react';
import { DeckButton as DeckButtonType } from '../../types';
import { getDeckButtonState, ButtonState, ActionCommandRef } from './useDeckButtonState';

interface DeckButtonProps {
  button: DeckButtonType;
  editing: boolean;
  onFire: (button: DeckButtonType) => void;
  onRemove: () => void;
  onClick?: () => void;
  deviceStates?: any;
  actionCommands?: Map<string, ActionCommandRef[]>;
}

export function DeckButton({ button, editing, onFire, onRemove, onClick, deviceStates, actionCommands }: DeckButtonProps) {
  const [firing, setFiring] = useState(false);

  const buttonState: ButtonState = deviceStates
    ? getDeckButtonState(button, deviceStates, actionCommands)
    : { level: null, active: false, live: false };

  const isToggled = !!(button.toggle && buttonState.active);

  const handlePress = useCallback(() => {
    if (editing) {
      onClick?.();
      return;
    }
    const isActive = !!(button.toggle && buttonState.active);
    const effectiveButton = isActive
      ? { ...button, actions: button.toggle!.activeActions }
      : button;
    onFire(effectiveButton);
    setFiring(true);
    setTimeout(() => setFiring(false), 200);
  }, [button, buttonState.active, editing, onFire, onClick]);
  const displayLabel = isToggled ? button.toggle!.activeLabel : button.label;
  const displayIcon = isToggled ? button.toggle!.activeIcon : button.icon;
  const displayColor = isToggled ? button.toggle!.activeColor : button.color;

  return (
    <>
    <div
      onPointerDown={handlePress}
      style={{
        background: firing
          ? displayColor + '80'
          : isToggled
            ? displayColor + '40'
            : buttonState.active
              ? displayColor + '55'
              : displayColor + '26',
        border: `2px solid ${
          buttonState.active && !button.toggle ? '#10B981' :
          buttonState.live ? '#EF4444' :
          displayColor + (firing ? 'CC' : '55')
        }`,
        borderRadius: 12,
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        cursor: editing ? 'default' : 'pointer',
        userSelect: 'none',
        touchAction: 'manipulation',
        position: 'relative',
        minHeight: 0,
        transition: 'background 0.2s, border-color 0.2s, transform 0.1s',
        transform: firing ? 'scale(0.95)' : 'scale(1)',
        boxShadow: firing
          ? `0 0 20px ${displayColor}66`
          : isToggled
            ? `0 0 12px ${displayColor}44`
            : 'none',
      }}
    >
      {buttonState.level !== null && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: `${(buttonState.level ?? 0) * 100}%`,
          background: displayColor + '66',
          borderRadius: '0 0 10px 10px',
          transition: 'height 0.15s ease-out',
          pointerEvents: 'none',
        }} />
      )}
      <span style={{ fontSize: 24, pointerEvents: 'none' }}>{displayIcon}</span>
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
        {displayLabel}
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
    </>
  );
}
