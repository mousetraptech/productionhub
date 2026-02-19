import type { ChatMessage as ChatMsg } from '../hooks/useChat';
import ActionCard from './ActionCard';

interface Props {
  message: ChatMsg;
  onConfirm: (requestId: string) => void;
  onReject: (requestId: string) => void;
}

export default function ChatMessage({ message, onConfirm, onReject }: Props) {
  const isUser = message.role === 'user';

  return (
    <div style={{
      display: 'flex',
      justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 8,
    }}>
      <div style={{
        maxWidth: '85%',
        background: isUser ? '#1D4ED8' : '#1E293B',
        borderRadius: 8,
        padding: '8px 12px',
        fontSize: 13,
        color: '#E2E8F0',
      }}>
        {message.error && (
          <div style={{ color: '#F87171' }}>{message.error}</div>
        )}

        {message.text && <div>{message.text}</div>}

        {message.actions && message.actions.map((action, i) => (
          <ActionCard
            key={i}
            action={action}
            index={i}
            status={message.status === 'executed' ? 'executed' : message.status === 'rejected' ? 'rejected' : 'pending'}
            result={message.results?.[i]}
          />
        ))}

        {message.status === 'pending' && message.actions && message.actions.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button
              onClick={() => onConfirm(message.id)}
              style={{
                background: '#10B981', color: '#fff', border: 'none',
                borderRadius: 4, padding: '4px 12px', fontSize: 12,
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              Confirm
            </button>
            <button
              onClick={() => onReject(message.id)}
              style={{
                background: '#EF4444', color: '#fff', border: 'none',
                borderRadius: 4, padding: '4px 12px', fontSize: 12,
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
