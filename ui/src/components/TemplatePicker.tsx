import { useState } from 'react';
import type { Template } from '../types';

interface TemplatePickerProps {
  templates: Template[];
  savedShows?: string[];
  onSelect: (templateId: string) => void;
  onLoadShow?: (name: string) => void;
  onDeleteShow?: (name: string) => void;
  onDismiss: () => void;
}

export default function TemplatePicker({ templates, savedShows, onSelect, onLoadShow, onDeleteShow, onDismiss }: TemplatePickerProps) {
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
            {savedShows && savedShows.length > 0 ? 'Load a saved show, pick a template, or start from scratch.' : 'Pick a template, or start from scratch.'}
          </p>
        </div>

        {/* Saved Shows */}
        {savedShows && savedShows.length > 0 && (
          <>
            <div style={{
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.12em', color: '#475569', marginBottom: 8,
            }}>
              Saved Shows
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 24 }}>
              {savedShows.map(name => (
                <div
                  key={name}
                  onMouseEnter={() => setHoveredId(`show:${name}`)}
                  onMouseLeave={() => setHoveredId(null)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 16,
                    padding: '14px 20px',
                    background: hoveredId === `show:${name}` ? '#1E293B' : '#0F172A',
                    border: hoveredId === `show:${name}` ? '1.5px solid #334155' : '1.5px solid #1E293B',
                    borderRadius: 14,
                    transition: 'all 0.15s ease',
                    transform: hoveredId === `show:${name}` ? 'translateY(-1px)' : 'none',
                  }}
                >
                  <span style={{ fontSize: 22, lineHeight: 1 }}>💾</span>
                  <span style={{ flex: 1, fontWeight: 700, fontSize: 15, color: '#E2E8F0' }}>{name}</span>
                  <button
                    onClick={() => onLoadShow?.(name)}
                    style={{
                      padding: '6px 14px', borderRadius: 8,
                      background: '#3B82F6', border: 'none',
                      color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    }}
                  >
                    Load
                  </button>
                  <button
                    onClick={() => onDeleteShow?.(name)}
                    style={{
                      padding: '6px 10px', borderRadius: 8,
                      background: 'none', border: '1px solid #334155',
                      color: '#475569', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      transition: 'color 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#EF4444')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
            <div style={{
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.12em', color: '#475569', marginBottom: 8,
            }}>
              Templates
            </div>
          </>
        )}

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

        <button
          onClick={onDismiss}
          style={{
            display: 'block',
            margin: '20px auto 0',
            background: 'none',
            border: 'none',
            color: '#475569',
            fontSize: 13,
            cursor: 'pointer',
            padding: '8px 16px',
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#94A3B8')}
          onMouseLeave={e => (e.currentTarget.style.color = '#475569')}
        >
          Start from scratch &rarr;
        </button>
      </div>
    </div>
  );
}
