/**
 * useDeck Hook
 *
 * Manages deck state: profile CRUD, grid editing, button firing.
 * Connects to the same ModWebSocket as useProductionHub.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { DeckButton, DeckAction, GridSlot, ActionCategory, InlineOSC } from '../types';

interface UseDeckOptions {
  initialProfile?: string;
}

export function useDeck(options: UseDeckOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [profiles, setProfiles] = useState<string[]>([]);
  const [currentProfile, setCurrentProfile] = useState<string | null>(null);
  const [grid, setGrid] = useState<GridSlot[]>([]);
  const [editing, setEditing] = useState(false);
  const [categories, setCategories] = useState<ActionCategory[]>([]);

  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Connect to ModWS with auto-reconnect
  useEffect(() => {
    const host = window.location.hostname || 'localhost';

    function connect() {
      const ws = new WebSocket(`ws://${host}:3001`);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = undefined;
        }
        ws.send(JSON.stringify({ type: 'deck-list' }));
        ws.send(JSON.stringify({ type: 'get-actions' }));
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);
        switch (msg.type) {
          case 'deck-profiles':
            setProfiles(msg.profiles);
            break;
          case 'deck-state':
            setCurrentProfile(msg.name);
            setGrid(msg.grid);
            break;
          case 'deck-saved':
            ws.send(JSON.stringify({ type: 'deck-list' }));
            break;
          case 'actions':
            setCategories(msg.categories);
            break;
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
          setConnected(false);
          reconnectTimer.current = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => { ws.close(); };
    }

    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  // Auto-load initial profile from URL param
  useEffect(() => {
    if (!connected) return;
    const params = new URLSearchParams(window.location.search);
    const profile = params.get('profile') || options.initialProfile;
    if (profile) {
      wsRef.current?.send(JSON.stringify({ type: 'deck-load', name: profile }));
    }
  }, [connected, options.initialProfile]);

  const send = useCallback((msg: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const loadProfile = useCallback((name: string) => {
    send({ type: 'deck-load', name });
  }, [send]);

  const saveProfile = useCallback((name: string) => {
    send({ type: 'deck-save', name, grid });
  }, [send, grid]);

  const deleteProfile = useCallback((name: string) => {
    send({ type: 'deck-delete', name });
    if (currentProfile === name) {
      setCurrentProfile(null);
      setGrid([]);
    }
  }, [send, currentProfile]);

  const fireButton = useCallback((button: DeckButton) => {
    send({
      type: 'deck-fire',
      buttonId: button.id,
      actions: button.actions,
      mode: button.mode,
      seriesGap: button.seriesGap,
    });
  }, [send]);

  // Grid editing operations (local state, saved explicitly)

  const assignAction = useCallback((row: number, col: number, actionId: string, osc?: InlineOSC, actionMeta?: { label: string; icon: string; color: string }) => {
    setGrid(prev => {
      const existing = prev.find(s => s.row === row && s.col === col);
      if (existing) {
        // Append action to existing button
        const updated = { ...existing.button, actions: [...existing.button.actions, { actionId, osc }] };
        return prev.map(s => s.row === row && s.col === col ? { ...s, button: updated } : s);
      }
      // Create new button
      const button: DeckButton = {
        id: `btn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: actionMeta?.label ?? actionId,
        icon: actionMeta?.icon ?? '',
        color: actionMeta?.color ?? '#3B82F6',
        actions: [{ actionId, osc }],
        mode: 'parallel',
        seriesGap: 1000,
      };
      return [...prev, { row, col, button }];
    });
  }, []);

  const removeButton = useCallback((row: number, col: number) => {
    setGrid(prev => prev.filter(s => !(s.row === row && s.col === col)));
  }, []);

  const updateButton = useCallback((row: number, col: number, updates: Partial<DeckButton>) => {
    setGrid(prev => prev.map(s =>
      s.row === row && s.col === col
        ? { ...s, button: { ...s.button, ...updates } }
        : s
    ));
  }, []);

  const removeAction = useCallback((row: number, col: number, actionIndex: number) => {
    setGrid(prev => prev.flatMap(s => {
      if (s.row !== row || s.col !== col) return [s];
      const actions = s.button.actions.filter((_, i) => i !== actionIndex);
      if (actions.length === 0) return [];
      return [{ ...s, button: { ...s.button, actions } }];
    }));
  }, []);

  const toggleEdit = useCallback(() => setEditing(e => !e), []);

  return {
    connected,
    profiles,
    currentProfile,
    grid,
    editing,
    categories,
    loadProfile,
    saveProfile,
    deleteProfile,
    fireButton,
    assignAction,
    removeButton,
    updateButton,
    removeAction,
    toggleEdit,
  };
}
