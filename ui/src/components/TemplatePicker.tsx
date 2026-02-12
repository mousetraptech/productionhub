import { useState } from 'react';
import type { Template } from '../types';

interface TemplatePickerProps {
  templates: Template[];
  onSelect: (templateId: string) => void;
}

export default function TemplatePicker({ templates, onSelect }: TemplatePickerProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      background: '#020617ee', backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      <div style={{ maxWidth: 640, width: '100%', padding: '0 24px' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.15em', color: '#3B82F6', marginBottom: 10,
          }}>
            Production Hub
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#F1F5F9', margin: 0, lineHeight: 1.3 }}>
            What kind of show tonight?
          </h1>
          <p style={{ color: '#64748B', fontSize: 14, marginTop: 8 }}>
            Pick a template. You can change everything after.
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {templates.map(t => (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              onMouseEnter={() => setHoveredId(t.id)}
              onMouseLeave={() => setHoveredId(null)}
              style={{
                display: 'flex', alignItems: 'center', gap: 16,
                padding: '16px 20px',
                background: hoveredId === t.id ? '#1E293B' : '#0F172A',
                border: hoveredId === t.id ? '1.5px solid #334155' : '1.5px solid #1E293B',
                borderRadius: 14,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                textAlign: 'left',
                width: '100%',
                transform: hoveredId === t.id ? 'translateY(-1px)' : 'none',
              }}
            >
              <span style={{ fontSize: 28, lineHeight: 1 }}>{t.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: '#E2E8F0' }}>{t.name}</div>
                <div style={{ fontSize: 12.5, color: '#64748B', marginTop: 2 }}>{t.description}</div>
              </div>
              <div style={{
                fontSize: 12, color: '#475569', fontWeight: 600,
                fontFamily: "'JetBrains Mono', monospace",
              }}>
                {t.cues.length === 0 ? '' : `${t.cues.length} cues`}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
