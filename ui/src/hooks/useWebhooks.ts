import { useState, useEffect, useCallback } from 'react';
import type { DeckAction, ActionCategory } from '../types';

export interface Webhook {
  name: string;
  mode: 'parallel' | 'series';
  seriesGap: number;
  actions: DeckAction[];
}

const API = `${window.location.protocol}//${window.location.hostname}:8081`;

export function useWebhooks() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [categories, setCategories] = useState<ActionCategory[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    try {
      const [whRes, actRes] = await Promise.all([
        fetch(`${API}/api/v1/webhooks`),
        fetch(`${API}/api/v1/actions`),
      ]);
      if (whRes.ok) {
        const data = await whRes.json();
        const list: Webhook[] = Object.entries(data).map(([name, def]: [string, any]) => ({
          name,
          mode: def.mode ?? 'series',
          seriesGap: def.seriesGap ?? 500,
          actions: def.actions ?? [],
        }));
        setWebhooks(list);
      }
      if (actRes.ok) {
        setCategories(await actRes.json());
      }
    } catch (err) {
      console.error('Failed to load webhooks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const save = useCallback(async (list: Webhook[]) => {
    const obj: Record<string, any> = {};
    for (const wh of list) {
      obj[wh.name] = { mode: wh.mode, seriesGap: wh.seriesGap, actions: wh.actions };
    }
    await fetch(`${API}/api/v1/webhooks`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj),
    });
    setWebhooks(list);
  }, []);

  const remove = useCallback(async (name: string) => {
    await fetch(`${API}/api/v1/webhooks/${encodeURIComponent(name)}`, { method: 'DELETE' });
    setWebhooks(prev => prev.filter(w => w.name !== name));
  }, []);

  const fire = useCallback(async (name: string) => {
    await fetch(`${API}/api/v1/webhooks/${encodeURIComponent(name)}`, { method: 'POST' });
  }, []);

  return { webhooks, setWebhooks, categories, loading, save, remove, fire, refresh: fetchAll };
}
