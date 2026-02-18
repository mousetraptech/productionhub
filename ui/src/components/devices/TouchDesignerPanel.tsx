import { TouchDesignerState } from '../../hooks/useDeviceStates';

interface TouchDesignerPanelProps {
  state: TouchDesignerState | null;
}

function formatValue(value: any): string {
  if (value === null || value === undefined) return '(null)';
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value.toString() : value.toFixed(3);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function ParameterRow({
  address,
  value
}: {
  address: string;
  value: any;
}) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      padding: '6px 10px',
      background: '#1E293B',
      borderRadius: 4,
      gap: 12,
    }}>
      <span style={{
        fontSize: 11,
        color: '#94A3B8',
        fontFamily: 'monospace',
        flex: 1,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {address}
      </span>
      <span style={{
        fontSize: 12,
        color: '#E2E8F0',
        fontWeight: 500,
        fontFamily: 'monospace',
        minWidth: 60,
        textAlign: 'right',
      }}>
        {formatValue(value)}
      </span>
    </div>
  );
}

export default function TouchDesignerPanel({ state }: TouchDesignerPanelProps) {
  const parameters = state?.parameters ?? {};
  const paramEntries = Object.entries(parameters);
  const lastMessage = state?.lastMessage;
  const messageCount = state?.messageCount ?? 0;

  return (
    <div style={{ padding: '8px 0' }}>
      {/* Stats bar */}
      <div style={{
        display: 'flex',
        gap: 16,
        padding: '10px 14px',
        background: '#1E293B',
        borderRadius: 6,
        marginBottom: 12,
      }}>
        <div>
          <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>
            Messages
          </div>
          <div style={{
            fontSize: 14,
            fontWeight: 600,
            color: '#E2E8F0',
            fontFamily: 'monospace',
          }}>
            {messageCount}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#64748B', marginBottom: 2 }}>
            Parameters
          </div>
          <div style={{
            fontSize: 14,
            fontWeight: 600,
            color: '#E2E8F0',
            fontFamily: 'monospace',
          }}>
            {paramEntries.length}
          </div>
        </div>
      </div>

      {/* Last message */}
      {lastMessage && (
        <div style={{
          padding: '10px 14px',
          background: 'rgba(139, 92, 246, 0.1)',
          border: '1px solid rgba(139, 92, 246, 0.3)',
          borderRadius: 6,
          marginBottom: 12,
        }}>
          <div style={{
            fontSize: 10,
            color: '#8B5CF6',
            fontWeight: 600,
            marginBottom: 4,
            textTransform: 'uppercase',
            letterSpacing: 1,
          }}>
            Last Message
          </div>
          <div style={{
            fontSize: 12,
            color: '#E2E8F0',
            fontFamily: 'monospace',
          }}>
            {lastMessage.address}
            {lastMessage.args.length > 0 && (
              <span style={{ color: '#94A3B8' }}>
                {' '}[{lastMessage.args.map(a =>
                  typeof a === 'object' && a.value !== undefined ? a.value : a
                ).join(', ')}]
              </span>
            )}
          </div>
        </div>
      )}

      {/* Parameter list */}
      {paramEntries.length > 0 ? (
        <div>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#94A3B8',
            marginBottom: 8,
          }}>
            Parameters
          </div>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            maxHeight: 200,
            overflowY: 'auto',
          }}>
            {paramEntries.map(([address, value]) => (
              <ParameterRow key={address} address={address} value={value} />
            ))}
          </div>
        </div>
      ) : (
        <div style={{
          padding: 20,
          textAlign: 'center',
          color: '#64748B',
          fontSize: 12,
        }}>
          No parameters received yet
        </div>
      )}
    </div>
  );
}
