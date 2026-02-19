import type { ProposedAction } from '../types';

interface Props {
  action: ProposedAction;
  index: number;
  status: 'pending' | 'confirmed' | 'rejected' | 'executed';
  result?: string;
}

export default function ActionCard({ action, status, result }: Props) {
  const bgColor = status === 'executed' ? '#064E3B'
    : status === 'rejected' ? '#7F1D1D'
    : '#1E293B';

  const borderColor = status === 'executed' ? '#10B981'
    : status === 'rejected' ? '#EF4444'
    : '#334155';

  return (
    <div style={{
      background: bgColor,
      border: `1px solid ${borderColor}`,
      borderRadius: 6,
      padding: '6px 10px',
      marginTop: 4,
      fontSize: 12,
    }}>
      <div style={{ color: '#E2E8F0', fontWeight: 500 }}>{action.label}</div>
      {result && (
        <div style={{ color: '#94A3B8', fontSize: 11, marginTop: 2 }}>{result}</div>
      )}
    </div>
  );
}
