import { useState, useEffect, useRef } from 'react';
import type { InlineOSC } from '../types';
import { getCommands, type FieldDef } from './command-defs';

export interface CommandModalTarget {
  commandType: string;
  cueId: string | null;
}

interface CommandModalProps {
  target: CommandModalTarget;
  obsScenes?: string[];
  onSubmit: (target: CommandModalTarget, osc: InlineOSC, delay?: number) => void;
  onCancel: () => void;
}

export default function CommandModal({ target, obsScenes, onSubmit, onCancel }: CommandModalProps) {
  const commands = getCommands(obsScenes);
  const def = commands.find(c => c.type === target.commandType);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const firstInputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    setTimeout(() => firstInputRef.current?.focus(), 50);
  }, []);

  if (!def) return null;

  // No-field commands (cam home, obs transition) — auto-submit
  if (def.fields.length === 0) {
    const payload = def.build({});
    if (payload) {
      setTimeout(() => onSubmit(target, payload, def.delay), 0);
    }
    return null;
  }

  const setField = (key: string, value: string) =>
    setVals(prev => ({ ...prev, [key]: value }));

  const handleSubmit = () => {
    const payload = def.build(vals);
    if (!payload) {
      setError('Please fill in all required fields with valid values.');
      return;
    }
    onSubmit(target, payload, def.delay);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') onCancel();
  };

  const renderField = (f: FieldDef, idx: number) => {
    if (f.type === 'select' && f.options) {
      return (
        <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>{f.placeholder}</label>
          <select
            ref={idx === 0 ? (el) => { firstInputRef.current = el; } : undefined}
            value={vals[f.key] ?? ''}
            onChange={(e) => setField(f.key, e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              width: '100%',
              background: '#020617',
              border: '1px solid #334155',
              borderRadius: 6,
              color: '#E2E8F0',
              padding: '8px 10px',
              fontSize: 13,
              outline: 'none',
            }}
          >
            <option value="">Select...</option>
            {f.options.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );
    }

    return (
      <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>{f.placeholder}</label>
        <input
          ref={idx === 0 ? (el) => { firstInputRef.current = el; } : undefined}
          type={f.type}
          placeholder={f.placeholder}
          value={vals[f.key] ?? ''}
          onChange={(e) => setField(f.key, e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            width: '100%',
            background: '#020617',
            border: '1px solid #334155',
            borderRadius: 6,
            color: '#E2E8F0',
            padding: '8px 10px',
            fontSize: 13,
            fontFamily: "'JetBrains Mono', monospace",
            outline: 'none',
          }}
        />
      </div>
    );
  };

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0F172A',
          border: '1px solid #334155',
          borderRadius: 14,
          padding: '24px 28px',
          minWidth: 320,
          maxWidth: 400,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: '#E2E8F0' }}>
          {def.label}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {def.fields.map((f, idx) => renderField(f, idx))}
        </div>
        {error && (
          <div style={{ fontSize: 12, color: '#EF4444' }}>{error}</div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 18px', borderRadius: 8,
              background: 'none', border: '1px solid #334155',
              color: '#94A3B8', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            style={{
              padding: '8px 18px', borderRadius: 8,
              background: '#3B82F6', border: 'none',
              color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
