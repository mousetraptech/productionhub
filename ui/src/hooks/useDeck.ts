/**
 * useDeck Hook
 *
 * Manages deck state: profile CRUD, grid editing, button firing.
 * Connects to the same ModWebSocket as useProductionHub.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { DeckButton, GridSlot, ActionCategory, InlineOSC } from '../types';

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
  const [showActive, setShowActive] = useState(false);
  const [groupStack, setGroupStack] = useState<string[]>([]);
  const [activeGrid, setActiveGrid] = useState<GridSlot[]>([]);

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
          case 'show-context':
            setShowActive(msg.state === 'active');
            break;
          case 'deck-group-changed':
            setGroupStack(msg.stack ?? []);
            setActiveGrid(msg.grid ?? []);
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
      prompt: button.prompt,
    });
  }, [send]);

  // Grid editing — applies mutations at the correct depth (root or inside a group)

  /** Apply a mutation to the sub-grid identified by groupStack, returning a new root grid */
  const mutateAtDepth = useCallback((rootGrid: GridSlot[], stack: string[], mutate: (subGrid: GridSlot[]) => GridSlot[]): GridSlot[] => {
    if (stack.length === 0) return mutate(rootGrid);
    const [head, ...rest] = stack;
    return rootGrid.map(s => {
      if (s.button.id !== head || !s.button.group) return s;
      const newGroup = rest.length === 0
        ? mutate(s.button.group)
        : mutateAtDepth(s.button.group, rest, mutate);
      return { ...s, button: { ...s.button, group: newGroup } };
    });
  }, []);

  const editGrid = useCallback((mutate: (subGrid: GridSlot[]) => GridSlot[]) => {
    setGrid(prev => mutateAtDepth(prev, groupStack, mutate));
  }, [groupStack, mutateAtDepth]);

  /** Check if a cell is occupied by any button's span region */
  const isCellOccupied = useCallback((subGrid: GridSlot[], row: number, col: number, excludeId?: string): boolean => {
    return subGrid.some(s => {
      if (excludeId && s.button.id === excludeId) return false;
      const sc = s.button.span?.cols ?? 1;
      const sr = s.button.span?.rows ?? 1;
      return row >= s.row && row < s.row + sr && col >= s.col && col < s.col + sc;
    });
  }, []);

  const assignAction = useCallback((row: number, col: number, actionId: string, osc?: InlineOSC, actionMeta?: { label: string; icon: string; color: string }, toggle?: DeckButton['toggle'], wait?: number) => {
    editGrid(sub => {
      // Don't assign to a cell occluded by a span
      if (isCellOccupied(sub, row, col) && !sub.find(s => s.row === row && s.col === col)) return sub;

      const existing = sub.find(s => s.row === row && s.col === col);
      const action = wait ? { actionId, wait } : { actionId, osc };
      if (existing) {
        const updated = { ...existing.button, actions: [...existing.button.actions, action] };
        return sub.map(s => s.row === row && s.col === col ? { ...s, button: updated } : s);
      }
      const button: DeckButton = {
        id: `btn-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: actionMeta?.label ?? actionId,
        icon: actionMeta?.icon ?? '',
        color: actionMeta?.color ?? '#3B82F6',
        actions: [action],
        mode: 'parallel',
        seriesGap: 1000,
        ...(toggle ? { toggle } : {}),
      };
      return [...sub, { row, col, button }];
    });
  }, [editGrid, isCellOccupied]);

  const removeButton = useCallback((row: number, col: number) => {
    editGrid(sub => sub.filter(s => !(s.row === row && s.col === col)));
  }, [editGrid]);

  const updateButton = useCallback((row: number, col: number, updates: Partial<DeckButton>) => {
    editGrid(sub => sub.map(s =>
      s.row === row && s.col === col
        ? { ...s, button: { ...s.button, ...updates } }
        : s
    ));
  }, [editGrid]);

  const removeAction = useCallback((row: number, col: number, actionIndex: number) => {
    editGrid(sub => sub.flatMap(s => {
      if (s.row !== row || s.col !== col) return [s];
      const actions = s.button.actions.filter((_, i) => i !== actionIndex);
      if (actions.length === 0) return [];
      return [{ ...s, button: { ...s.button, actions } }];
    }));
  }, [editGrid]);

  const reorderAction = useCallback((row: number, col: number, fromIndex: number, toIndex: number) => {
    editGrid(sub => sub.map(s => {
      if (s.row !== row || s.col !== col) return s;
      const actions = [...s.button.actions];
      const [moved] = actions.splice(fromIndex, 1);
      actions.splice(toIndex, 0, moved);
      return { ...s, button: { ...s.button, actions } };
    }));
  }, [editGrid]);

  const swapButtons = useCallback((fromRow: number, fromCol: number, toRow: number, toCol: number) => {
    editGrid(sub => {
      const fromSlot = sub.find(s => s.row === fromRow && s.col === fromCol);
      const toSlot = sub.find(s => s.row === toRow && s.col === toCol);
      let next = sub.filter(s =>
        !(s.row === fromRow && s.col === fromCol) &&
        !(s.row === toRow && s.col === toCol)
      );
      if (fromSlot) next = [...next, { row: toRow, col: toCol, button: fromSlot.button }];
      if (toSlot) next = [...next, { row: fromRow, col: fromCol, button: toSlot.button }];
      return next;
    });
  }, [editGrid]);

  const toggleEdit = useCallback(() => setEditing(e => !e), []);

  const createGroup = useCallback((row: number, col: number, name: string) => {
    editGrid(sub => {
      const button: DeckButton = {
        id: `grp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        label: name,
        icon: '\uD83D\uDCC1',
        color: '#6366F1',
        actions: [],
        mode: 'parallel',
        seriesGap: 0,
        group: [],
      };
      return [...sub.filter(s => !(s.row === row && s.col === col)), { row, col, button }];
    });
  }, [editGrid]);

  const enterGroup = useCallback((buttonId: string) => {
    send({ type: 'deck-group-enter', buttonId });
  }, [send]);

  const groupBack = useCallback(() => {
    send({ type: 'deck-group-back' });
  }, [send]);

  // Resolve the visible grid: walk groupStack through the local grid state
  const displayGrid = useMemo(() => {
    if (groupStack.length === 0) return grid;
    let current = grid;
    for (const btnId of groupStack) {
      const slot = current.find(s => s.button.id === btnId);
      if (slot?.button.group) {
        current = slot.button.group;
      } else {
        return grid; // invalid stack, fall back to root
      }
    }
    return current;
  }, [grid, groupStack]);
  const inGroup = groupStack.length > 0;

  return {
    connected,
    profiles,
    currentProfile,
    grid,
    editing,
    categories,
    showActive,
    loadProfile,
    saveProfile,
    deleteProfile,
    fireButton,
    assignAction,
    removeButton,
    updateButton,
    removeAction,
    reorderAction,
    swapButtons,
    toggleEdit,
    groupStack,
    displayGrid,
    inGroup,
    createGroup,
    enterGroup,
    groupBack,
  };
}
