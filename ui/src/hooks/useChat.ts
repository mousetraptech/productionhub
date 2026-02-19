import { useState, useCallback } from 'react';
import type { ProposedAction, BrainMode, ClientMessage, ServerMessage } from '../types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'brain';
  text: string;
  actions?: ProposedAction[];
  results?: string[];
  status: 'sent' | 'pending' | 'confirmed' | 'rejected' | 'executed' | 'error';
  error?: string;
}

export function useChat(
  send: (msg: ClientMessage) => void,
) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [mode, setMode] = useState<BrainMode>('confirm');
  const [thinking, setThinking] = useState(false);

  const sendMessage = useCallback((text: string) => {
    const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    // Add user message
    setMessages(prev => [...prev, {
      id: requestId,
      role: 'user',
      text,
      status: 'sent',
    }]);

    setThinking(true);
    send({ type: 'chat-message', requestId, text });
  }, [send]);

  const confirm = useCallback((requestId: string) => {
    send({ type: 'chat-confirm', requestId });
    setMessages(prev => prev.map(m =>
      m.id === requestId ? { ...m, status: 'confirmed' as const } : m
    ));
  }, [send]);

  const reject = useCallback((requestId: string) => {
    send({ type: 'chat-reject', requestId });
    setMessages(prev => prev.map(m =>
      m.id === requestId ? { ...m, status: 'rejected' as const } : m
    ));
  }, [send]);

  const toggleMode = useCallback(() => {
    const newMode = mode === 'confirm' ? 'trusted' : 'confirm';
    send({ type: 'chat-set-mode', mode: newMode });
  }, [mode, send]);

  /** Handle incoming server messages — call this from useProductionHub */
  const handleServerMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case 'chat-response':
        setThinking(false);
        setMessages(prev => [...prev, {
          id: msg.requestId,
          role: 'brain',
          text: msg.text,
          actions: msg.actions,
          status: msg.actions && msg.actions.length > 0 ? 'pending' : 'sent',
        }]);
        break;

      case 'chat-executed':
        setThinking(false);
        setMessages(prev => {
          // Check if there's already a pending message for this requestId
          const existing = prev.find(m => m.id === msg.requestId && m.role === 'brain');
          if (existing) {
            return prev.map(m =>
              m.id === msg.requestId && m.role === 'brain'
                ? { ...m, results: msg.results, status: 'executed' as const }
                : m
            );
          }
          // Trusted mode: no prior brain message, add one
          return [...prev, {
            id: msg.requestId,
            role: 'brain',
            text: 'Done.',
            actions: msg.actions,
            results: msg.results,
            status: 'executed',
          }];
        });
        break;

      case 'chat-error':
        setThinking(false);
        setMessages(prev => [...prev, {
          id: msg.requestId,
          role: 'brain',
          text: '',
          status: 'error',
          error: msg.error,
        }]);
        break;

      case 'chat-mode':
        setMode(msg.mode);
        break;
    }
  }, []);

  return { messages, mode, thinking, sendMessage, confirm, reject, toggleMode, handleServerMessage };
}
