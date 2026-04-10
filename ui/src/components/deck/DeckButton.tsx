import { useState, useCallback } from 'react';
import { DeckButton as DeckButtonType } from '../../types';
import { getDeckButtonState, ButtonState, ActionCommandRef } from './useDeckButtonState';
import { getButtonColors, BUTTON_TYPES } from './buttonTypes';

interface DeckButtonProps {
  button: DeckButtonType;
  editing: boolean;
  onFire: (button: DeckButtonType) => void;
  onRemove: () => void;
  onClick?: () => void;
  deviceStates?: any;
  actionCommands?: Map<string, ActionCommandRef[]>;
  showActive?: boolean;
}

const FONT_MONO = "'IBM Plex Mono', monospace";

export function DeckButton({ button, editing, onFire, onRemove, onClick, deviceStates, actionCommands, showActive }: DeckButtonProps) {
  const [firing, setFiring] = useState(false);

  const buttonState: ButtonState = deviceStates
    ? getDeckButtonState(button, deviceStates, actionCommands, { showActive })
    : { level: null, active: false, live: false };

  const isToggled = !!(button.toggle && buttonState.active);

  // Derive colors from type system
  const firstOsc = button.actions[0]?.osc?.address ?? '';
  const colors = getButtonColors(button.buttonType, button.label, firstOsc, button.color);
  const toggleColors = isToggled && button.toggle?.activeColor
    ? { bg: button.toggle.activeColor + '30', border: button.toggle.activeColor, text: '#e8e8e8' }
    : null;

  const handlePress = useCallback(() => {
    if (editing) {
      onClick?.();
      return;
    }
    if (button.imperative) {
      onFire(button);
      setFiring(true);
      setTimeout(() => setFiring(false), 200);
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

  const c = toggleColors ?? colors;
  const isMuted = isToggled; // for mute-type toggles, active = muted

  // Multi-line label support
  const labelLines = displayLabel.split('\n');

  // State-driven visual effects
  const stateActive = buttonState.active && !button.toggle; // non-toggle active (e.g. show/rec glow)
  const glowColor = stateActive ? c.text : 'transparent';

  return (
    <div
      onPointerDown={editing ? undefined : handlePress}
      onClick={editing ? handlePress : undefined}
      style={{
        position: 'relative',
        background: c.bg,
        border: `1px solid ${firing ? c.text : c.border}`,
        borderRadius: 3,
        width: '100%',
        height: '100%',
        minHeight: 62,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: editing ? 'default' : 'pointer',
        userSelect: 'none',
        touchAction: 'manipulation',
        fontFamily: FONT_MONO,
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '0.05em',
        color: c.text,
        padding: '8px 6px',
        textAlign: 'center',
        lineHeight: 1.3,
        transition: 'transform 0.1s, opacity 0.1s, box-shadow 0.15s, filter 0.15s',
        transform: firing ? 'scale(0.92)' : 'scale(1)',
        filter: firing ? 'brightness(1.4)' : isMuted ? 'saturate(0.3)' : 'none',
        opacity: isMuted ? 0.4 : 1,
        boxShadow: stateActive
          ? `0 0 12px 2px ${glowColor}`
          : firing
            ? `0 0 12px ${c.border}`
            : 'none',
      }}
    >
      {/* Fader level bar */}
      {buttonState.level !== null && (
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: `${(buttonState.level ?? 0) * 100}%`,
          background: c.text + '22',
          borderRadius: '0 0 2px 2px',
          transition: 'height 0.15s ease-out',
          pointerEvents: 'none',
        }} />
      )}

      {/* Icon */}
      {displayIcon && (
        <span style={{ fontSize: 18, pointerEvents: 'none', marginBottom: 2 }}>{displayIcon}</span>
      )}

      {/* Multi-line label */}
      {labelLines.map((line, i) => (
        <span key={i} style={{ pointerEvents: 'none' }}>{line}</span>
      ))}

      {/* Type badge */}
      {button.buttonType && BUTTON_TYPES[button.buttonType] && (
        <span style={{
          position: 'absolute', top: 3, right: 4,
          fontSize: 8, opacity: 0.5, pointerEvents: 'none',
          letterSpacing: 0,
        }}>
          {BUTTON_TYPES[button.buttonType].label.slice(0, 3).toUpperCase()}
        </span>
      )}

      {/* Multi-action count */}
      {button.actions.length > 1 && !button.buttonType && (
        <span style={{
          position: 'absolute', top: 3, right: 4,
          fontSize: 8, color: c.text, opacity: 0.5, fontWeight: 700,
          pointerEvents: 'none',
        }}>
          {button.actions.length}
        </span>
      )}

      {/* Custom image indicator */}
      {button.customImage && (
        <span style={{
          position: 'absolute', bottom: 3, left: 4,
          fontSize: 8, opacity: 0.5, pointerEvents: 'none',
        }}>IMG</span>
      )}

      {/* Series mode */}
      {button.mode === 'series' && (
        <span style={{
          position: 'absolute', bottom: 3, right: 4,
          fontSize: 8, opacity: 0.5, pointerEvents: 'none',
        }}>SER</span>
      )}

      {/* Edit mode remove button */}
      {editing && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{
            position: 'absolute', top: -6, right: -6,
            background: '#a02020', color: '#FFF', border: 'none',
            borderRadius: '50%', width: 18, height: 18,
            fontSize: 11, cursor: 'pointer', lineHeight: '18px',
            padding: 0, fontFamily: FONT_MONO,
          }}
        >x</button>
      )}
    </div>
  );
}
