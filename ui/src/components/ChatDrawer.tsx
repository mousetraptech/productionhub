import { useState, useRef, useEffect } from 'react';
import type { ChatMessage as ChatMsg } from '../hooks/useChat';
import type { BrainMode } from '../types';
import ChatMessage from './ChatMessage';

interface Props {
  messages: ChatMsg[];
  mode: BrainMode;
  thinking: boolean;
  onSend: (text: string) => void;
  onConfirm: (requestId: string) => void;
  onReject: (requestId: string) => void;
  onToggleMode: () => void;
}

export default function ChatDrawer({
  messages, mode, thinking, onSend, onConfirm, onReject, onToggleMode,
}: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput('');
  };

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          position: 'fixed',
          bottom: open ? undefined : 16,
          right: 16,
          zIndex: 300,
          background: '#6366F1',
          color: '#fff',
          border: 'none',
          borderRadius: open ? '6px 6px 0 0' : 24,
          padding: open ? '6px 16px' : '10px 16px',
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          display: open ? 'none' : 'flex',
          alignItems: 'center',
          gap: 6,
          boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
        }}
      >
        Brain
      </button>

      {/* Drawer */}
      {open && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          height: 340,
          background: '#0F172A',
          borderTop: '2px solid #6366F1',
          zIndex: 300,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 16px',
            borderBottom: '1px solid #1E293B',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#E2E8F0' }}>
                Booth Brain
              </span>
              <button
                onClick={onToggleMode}
                style={{
                  background: mode === 'trusted' ? '#DC2626' : '#1E293B',
                  color: mode === 'trusted' ? '#fff' : '#94A3B8',
                  border: `1px solid ${mode === 'trusted' ? '#DC2626' : '#334155'}`,
                  borderRadius: 12,
                  padding: '2px 10px',
                  fontSize: 11,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {mode === 'confirm' ? 'Confirm Mode' : 'Trusted Mode'}
              </button>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: 'none', border: 'none', color: '#94A3B8',
                cursor: 'pointer', fontSize: 18, lineHeight: 1,
              }}
            >
              x
            </button>
          </div>

          {/* Messages */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '12px 16px',
          }}>
            {messages.length === 0 && (
              <div style={{ color: '#475569', fontSize: 13, textAlign: 'center', marginTop: 40 }}>
                Type a command or ask a question.
              </div>
            )}
            {messages.map((msg, i) => (
              <ChatMessage
                key={`${msg.id}-${msg.role}-${i}`}
                message={msg}
                onConfirm={onConfirm}
                onReject={onReject}
              />
            ))}
            {thinking && (
              <div style={{ color: '#6366F1', fontSize: 12, padding: '4px 0' }}>
                Thinking...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} style={{
            display: 'flex',
            padding: '8px 16px',
            borderTop: '1px solid #1E293B',
            gap: 8,
          }}>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder="Tell Booth Brain what you need..."
              disabled={thinking}
              style={{
                flex: 1,
                background: '#1E293B',
                border: '1px solid #334155',
                borderRadius: 6,
                padding: '8px 12px',
                color: '#E2E8F0',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={thinking || !input.trim()}
              style={{
                background: '#6366F1',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                cursor: thinking ? 'not-allowed' : 'pointer',
                opacity: thinking || !input.trim() ? 0.5 : 1,
              }}
            >
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}
