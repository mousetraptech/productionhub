import { useState, ReactNode } from 'react';

interface CollapsiblePanelProps {
  title: string;
  icon?: string;
  defaultExpanded?: boolean;
  expandable?: boolean;
  children: ReactNode;
}

export default function CollapsiblePanel({
  title,
  icon,
  defaultExpanded = false,
  expandable = true,
  children,
}: CollapsiblePanelProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <>
      <div style={{
        background: '#0F172A',
        borderRadius: 8,
        overflow: 'hidden',
        marginBottom: 8,
      }}>
        <button
          onClick={() => setExpanded(!expanded)}
          style={{
            width: '100%',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'transparent',
            border: 'none',
            color: '#E2E8F0',
            cursor: 'pointer',
            fontSize: 14,
            fontWeight: 600,
            textAlign: 'left',
          }}
        >
          <span style={{
            transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            transition: 'transform 0.15s',
            fontSize: 12,
          }}>
            ▶
          </span>
          {icon && <span>{icon}</span>}
          <span style={{ flex: 1 }}>{title}</span>

          {/* Expand button */}
          {expandable && expanded && (
            <span
              onClick={(e) => {
                e.stopPropagation();
                setFullscreen(true);
              }}
              style={{
                fontSize: 14,
                color: '#64748B',
                cursor: 'pointer',
                padding: '0 4px',
                lineHeight: 1,
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#E2E8F0')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#64748B')}
              title="Expand"
            >
              ⛶
            </span>
          )}
        </button>
        {expanded && (
          <div style={{
            padding: '0 16px 16px',
            borderTop: '1px solid #1E293B',
          }}>
            {children}
          </div>
        )}
      </div>

      {/* Fullscreen overlay */}
      {fullscreen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 1000,
            background: 'rgba(0, 0, 0, 0.85)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            flexDirection: 'column',
            animation: 'expandIn 0.2s ease-out',
          }}
        >
          <style>{`
            @keyframes expandIn {
              from { opacity: 0; transform: scale(0.95); }
              to { opacity: 1; transform: scale(1); }
            }
          `}</style>

          {/* Header bar */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 20px',
            background: '#0F172A',
            borderBottom: '1px solid #1E293B',
            flexShrink: 0,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
              {icon && <span style={{ fontSize: 16 }}>{icon}</span>}
              <span style={{
                fontSize: 16,
                fontWeight: 700,
                color: '#E2E8F0',
                letterSpacing: '0.02em',
              }}>
                {title}
              </span>
              <span style={{
                fontSize: 11,
                color: '#475569',
                background: '#1E293B',
                padding: '2px 8px',
                borderRadius: 4,
              }}>
                EXPANDED
              </span>
            </div>

            <button
              onClick={() => setFullscreen(false)}
              style={{
                background: '#1E293B',
                border: '1px solid #334155',
                color: '#94A3B8',
                padding: '6px 14px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#334155';
                e.currentTarget.style.color = '#E2E8F0';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = '#1E293B';
                e.currentTarget.style.color = '#94A3B8';
              }}
            >
              <span style={{ fontSize: 14 }}>✕</span>
              Close
            </button>
          </div>

          {/* Content area — scrollable, centered */}
          <div style={{
            flex: 1,
            overflow: 'auto',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'flex-start',
            padding: 24,
          }}>
            <div style={{
              width: '100%',
              maxWidth: 1200,
              transform: 'scale(1)',
              transformOrigin: 'top center',
            }}>
              {children}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
