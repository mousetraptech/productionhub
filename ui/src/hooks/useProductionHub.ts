import { useState, useEffect, useRef, useCallback } from 'react';
import type { ShowState, ActionCategory, Template, ClientMessage, ServerMessage } from '../types';

const WS_URL = `ws://${window.location.hostname}:3001`;
const RECONNECT_DELAY = 2000;

export function useProductionHub() {
  const [show, setShow] = useState<ShowState>({
    name: '',
    cues: [],
    activeCueIndex: null,
    firedCues: [],
  });
  const [categories, setCategories] = useState<ActionCategory[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = undefined;
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg: ServerMessage = JSON.parse(event.data);
          switch (msg.type) {
            case 'state':
              setShow(msg.show);
              break;
            case 'actions':
              setCategories(msg.categories);
              break;
            case 'templates':
              setTemplates(msg.templates);
              break;
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return { show, categories, templates, connected, send };
}
