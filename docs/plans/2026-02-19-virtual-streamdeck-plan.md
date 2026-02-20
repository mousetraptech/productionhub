# Virtual StreamDeck Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a 4x8 virtual StreamDeck at `/deck` — programmable button grid with drag-from-palette configuration, composite multi-action buttons (parallel/series), and live device state feedback.

**Architecture:** Separate `/deck` route rendered by `DeckPage.tsx`. Backend adds `DeckPersistence` (JSON files in `decks/`) and new WS message handlers in `ModWebSocket`. Frontend reuses `ActionPalette` for drag-to-assign and `useDeviceStates` for live feedback. Client-side routing via pathname check in `main.tsx` (no react-router dependency).

**Tech Stack:** React 19, TypeScript, WebSocket (ws), node:fs, Vite, node:test

**Design doc:** `docs/plans/2026-02-19-virtual-streamdeck-design.md`

---

### Task 1: Shared Types

Define the deck data model types used by both backend and frontend.

**Files:**
- Create: `src/deck/types.ts`

**Step 1: Write the types file**

```typescript
/**
 * Virtual StreamDeck Types
 *
 * Shared types for deck profiles, buttons, and WS messages.
 */

export interface DeckAction {
  actionId: string;
  osc?: { address: string; args: any[]; label: string };
}

export interface DeckButton {
  id: string;
  label: string;
  icon: string;
  color: string;
  actions: DeckAction[];
  mode: 'parallel' | 'series';
  seriesGap: number;
}

export interface GridSlot {
  row: number;
  col: number;
  button: DeckButton;
}

export interface DeckProfile {
  name: string;
  grid: GridSlot[];
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/deck/types.ts
git commit -m "feat(deck): add shared types for virtual StreamDeck"
```

---

### Task 2: DeckPersistence

JSON file CRUD for deck profiles. Follows the `ShowPersistence` pattern at `src/cue-engine/persistence.ts`.

**Files:**
- Create: `src/deck/persistence.ts`
- Create: `src/__tests__/deck-persistence.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs';
import * as path from 'path';
import { DeckPersistence } from '../deck/persistence';

const TEST_DIR = path.join(__dirname, '../../.test-decks');

describe('DeckPersistence', () => {
  let persistence: DeckPersistence;

  beforeEach(() => {
    persistence = new DeckPersistence(TEST_DIR);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
  });

  it('should list empty when no profiles exist', () => {
    assert.deepStrictEqual(persistence.list(), []);
  });

  it('should save and load a profile', () => {
    const profile = {
      name: 'Test Deck',
      grid: [{
        row: 0, col: 0,
        button: {
          id: 'btn-1', label: 'House Full', icon: '🏠', color: '#F59E0B',
          actions: [{ actionId: 'house-full' }],
          mode: 'parallel' as const, seriesGap: 1000,
        },
      }],
    };

    persistence.save('Test Deck', profile);
    const loaded = persistence.load('test_deck');
    assert.ok(loaded);
    assert.strictEqual(loaded!.name, 'Test Deck');
    assert.strictEqual(loaded!.grid.length, 1);
    assert.strictEqual(loaded!.grid[0].button.label, 'House Full');
    assert.strictEqual(loaded!.grid[0].button.mode, 'parallel');
  });

  it('should list saved profiles', () => {
    persistence.save('Deck A', { name: 'Deck A', grid: [] });
    persistence.save('Deck B', { name: 'Deck B', grid: [] });
    const list = persistence.list();
    assert.strictEqual(list.length, 2);
    assert.ok(list.includes('deck_a'));
    assert.ok(list.includes('deck_b'));
  });

  it('should delete a profile', () => {
    persistence.save('ToDelete', { name: 'ToDelete', grid: [] });
    assert.strictEqual(persistence.list().length, 1);
    persistence.delete('todelete');
    assert.strictEqual(persistence.list().length, 0);
  });

  it('should return null for missing profile', () => {
    assert.strictEqual(persistence.load('nonexistent'), null);
  });

  it('should sanitize file names', () => {
    persistence.save('My Deck!@#$', { name: 'My Deck!@#$', grid: [] });
    const list = persistence.list();
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0], 'my_deck____');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx ts-node --files src/__tests__/deck-persistence.test.ts`
Expected: FAIL — cannot find module `../deck/persistence`

**Step 3: Write the implementation**

```typescript
/**
 * Deck Persistence
 *
 * Save and load deck profiles as JSON files in the decks/ directory.
 * Follows the same pattern as ShowPersistence.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DeckProfile } from './types';

export class DeckPersistence {
  private decksDir: string;

  constructor(decksDir?: string) {
    this.decksDir = decksDir ?? path.join(process.cwd(), 'decks');
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.decksDir)) {
      fs.mkdirSync(this.decksDir, { recursive: true });
    }
  }

  private safeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  }

  save(name: string, profile: DeckProfile): void {
    this.ensureDir();
    const fileName = this.safeName(name);
    const filePath = path.join(this.decksDir, `${fileName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(profile, null, 2), 'utf-8');
    console.log(`[DeckPersistence] Saved profile "${name}" to ${filePath}`);
  }

  load(name: string): DeckProfile | null {
    const filePath = path.join(this.decksDir, `${this.safeName(name)}.json`);
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as DeckProfile;
  }

  delete(name: string): boolean {
    const filePath = path.join(this.decksDir, `${this.safeName(name)}.json`);
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    console.log(`[DeckPersistence] Deleted profile "${name}"`);
    return true;
  }

  list(): string[] {
    this.ensureDir();
    return fs.readdirSync(this.decksDir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace(/\.json$/, ''));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx ts-node --files src/__tests__/deck-persistence.test.ts`
Expected: all 6 tests PASS

**Step 5: Commit**

```bash
git add src/deck/types.ts src/deck/persistence.ts src/__tests__/deck-persistence.test.ts
git commit -m "feat(deck): add DeckPersistence — JSON file CRUD for deck profiles"
```

---

### Task 3: Deck Fire Logic

A standalone function that fires a deck button's actions — parallel or series. This is the core execution engine, independent of WS transport.

**Files:**
- Create: `src/deck/fire.ts`
- Create: `src/__tests__/deck-fire.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { setTimeout as delay } from 'node:timers/promises';
import { fireDeckButton } from '../deck/fire';
import { DeckAction } from '../deck/types';

describe('fireDeckButton', () => {
  it('should fire all actions in parallel mode', async () => {
    const fired: string[] = [];
    const actions: DeckAction[] = [
      { actionId: 'house-full' },
      { actionId: 'pb1-go' },
    ];

    await fireDeckButton(actions, 'parallel', 0, (actionId, osc) => {
      fired.push(actionId);
    });

    assert.deepStrictEqual(fired, ['house-full', 'pb1-go']);
  });

  it('should fire actions in series with gap', async () => {
    const timestamps: number[] = [];
    const actions: DeckAction[] = [
      { actionId: 'a' },
      { actionId: 'b' },
      { actionId: 'c' },
    ];

    await fireDeckButton(actions, 'series', 100, (_actionId) => {
      timestamps.push(Date.now());
    });

    // b should fire ~100ms after a, c ~100ms after b
    assert.strictEqual(timestamps.length, 3);
    assert.ok(timestamps[1] - timestamps[0] >= 80, `Gap 1: ${timestamps[1] - timestamps[0]}ms`);
    assert.ok(timestamps[2] - timestamps[1] >= 80, `Gap 2: ${timestamps[2] - timestamps[1]}ms`);
  });

  it('should pass inline OSC to callback', async () => {
    const received: any[] = [];
    const actions: DeckAction[] = [
      { actionId: 'inline:test', osc: { address: '/test/addr', args: [1.0], label: 'Test' } },
    ];

    await fireDeckButton(actions, 'parallel', 0, (actionId, osc) => {
      received.push({ actionId, osc });
    });

    assert.strictEqual(received[0].osc.address, '/test/addr');
  });

  it('should resolve immediately for parallel mode', async () => {
    const start = Date.now();
    await fireDeckButton(
      [{ actionId: 'a' }, { actionId: 'b' }],
      'parallel', 500,
      () => {},
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 50, `Parallel should be instant, took ${elapsed}ms`);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx ts-node --files src/__tests__/deck-fire.test.ts`
Expected: FAIL — cannot find module `../deck/fire`

**Step 3: Write the implementation**

```typescript
/**
 * Deck Button Fire Logic
 *
 * Executes a deck button's actions in parallel or series.
 * The callback handles actual OSC routing — this module is transport-agnostic.
 */

import { DeckAction } from './types';

type FireCallback = (actionId: string, osc?: { address: string; args: any[]; label: string }) => void;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function fireDeckButton(
  actions: DeckAction[],
  mode: 'parallel' | 'series',
  seriesGap: number,
  callback: FireCallback,
): Promise<void> {
  if (mode === 'parallel') {
    for (const action of actions) {
      callback(action.actionId, action.osc);
    }
    return;
  }

  // Series: fire one at a time with gap between
  for (let i = 0; i < actions.length; i++) {
    callback(actions[i].actionId, actions[i].osc);
    if (i < actions.length - 1) {
      await delay(seriesGap);
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx ts-node --files src/__tests__/deck-fire.test.ts`
Expected: all 4 tests PASS

**Step 5: Commit**

```bash
git add src/deck/fire.ts src/__tests__/deck-fire.test.ts
git commit -m "feat(deck): add fireDeckButton — parallel/series action execution"
```

---

### Task 4: WS Message Handlers in ModWebSocket

Add `deck-*` message handling to `ModWebSocket`. This wires DeckPersistence and fireDeckButton into the existing WS server.

**Files:**
- Modify: `src/server/websocket.ts` (add constructor arg, add cases to handleMessage switch)
- Modify: `src/hub.ts` (instantiate DeckPersistence, pass to ModWebSocket)

**Step 1: Add DeckPersistence to ModWebSocket constructor**

In `src/server/websocket.ts`:

- Add import at top: `import { DeckPersistence } from '../deck/persistence';`
- Add import: `import { fireDeckButton } from '../deck/fire';`
- Add private field after line 32: `private deckPersistence: DeckPersistence;`
- Add constructor parameter after `brainService?: BrainService`: `deckPersistence?: DeckPersistence`
- Add to constructor body after line 49: `this.deckPersistence = deckPersistence ?? new DeckPersistence();`

**Step 2: Add deck message cases to handleMessage switch**

In `src/server/websocket.ts`, add before the `default:` case (before line 232):

```typescript
      case 'deck-list':
        this.broadcast({ type: 'deck-profiles', profiles: this.deckPersistence.list() });
        break;

      case 'deck-load': {
        const profile = this.deckPersistence.load(msg.name);
        if (profile) {
          this.broadcast({ type: 'deck-state', name: msg.name, grid: profile.grid });
        }
        break;
      }

      case 'deck-save':
        this.deckPersistence.save(msg.name, { name: msg.name, grid: msg.grid });
        this.broadcast({ type: 'deck-saved', name: msg.name });
        break;

      case 'deck-delete':
        this.deckPersistence.delete(msg.name);
        this.broadcast({ type: 'deck-profiles', profiles: this.deckPersistence.list() });
        break;

      case 'deck-fire': {
        const fireActions = msg.actions ?? [];
        const fireMode = msg.mode ?? 'parallel';
        const gap = msg.seriesGap ?? 1000;

        fireDeckButton(fireActions, fireMode, gap, (actionId, osc) => {
          if (osc) {
            this.routeOSC(osc.address, osc.args);
          } else {
            const action = this.actionRegistry.getAction(actionId);
            if (action) {
              for (const cmd of action.commands) {
                const prefix = cmd.prefix ? `/${cmd.prefix}` : this.resolveDevicePrefix(cmd.device);
                if (prefix) this.routeOSC(`${prefix}${cmd.address}`, cmd.args ?? []);
              }
            }
          }
        });

        this.broadcast({ type: 'deck-fired', buttonId: msg.buttonId });
        break;
      }
```

**Step 3: Add resolveDevicePrefix helper**

Add this private method to the `ModWebSocket` class (after the `broadcast` method):

```typescript
  /** Map device type to its configured prefix (same as CueEngine) */
  private resolveDevicePrefix(device: string): string | null {
    const defaults: Record<string, string> = {
      avantis: '/avantis',
      chamsys: '/lights',
      obs: '/obs',
      visca: '/cam1',
      touchdesigner: '/td',
    };
    return defaults[device] ?? null;
  }
```

**Step 4: Wire DeckPersistence in hub.ts**

In `src/hub.ts`:

- Add import: `import { DeckPersistence } from './deck/persistence';`
- Before the `this.modWebSocket = new ModWebSocket(...)` call, add: `const deckPersistence = new DeckPersistence();`
- Add `deckPersistence` as the last argument to the `ModWebSocket` constructor call

**Step 5: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 6: Commit**

```bash
git add src/server/websocket.ts src/hub.ts
git commit -m "feat(deck): add deck WS message handlers — list/load/save/delete/fire"
```

---

### Task 5: Frontend Types and useDeck Hook

Add deck types to the UI and create the `useDeck` hook that manages deck state and WS communication.

**Files:**
- Modify: `ui/src/types.ts` (add deck types and WS message types)
- Create: `ui/src/hooks/useDeck.ts`

**Step 1: Add deck types to ui/src/types.ts**

After the existing `BrainMode` type (line 55), add:

```typescript
// Deck types
export interface DeckAction {
  actionId: string;
  osc?: InlineOSC;
}

export interface DeckButton {
  id: string;
  label: string;
  icon: string;
  color: string;
  actions: DeckAction[];
  mode: 'parallel' | 'series';
  seriesGap: number;
}

export interface GridSlot {
  row: number;
  col: number;
  button: DeckButton;
}
```

Add to the `ServerMessage` union (after the `chat-mode` line):

```typescript
  | { type: 'deck-profiles'; profiles: string[] }
  | { type: 'deck-state'; name: string; grid: GridSlot[] }
  | { type: 'deck-saved'; name: string }
  | { type: 'deck-fired'; buttonId: string }
```

Add to the `ClientMessage` union (after the `chat-set-mode` line):

```typescript
  | { type: 'deck-list' }
  | { type: 'deck-load'; name: string }
  | { type: 'deck-save'; name: string; grid: GridSlot[] }
  | { type: 'deck-delete'; name: string }
  | { type: 'deck-fire'; buttonId: string; actions: DeckAction[]; mode: 'parallel' | 'series'; seriesGap: number }
```

**Step 2: Create the useDeck hook**

```typescript
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

  // Connect to ModWS
  useEffect(() => {
    const host = window.location.hostname || 'localhost';
    const ws = new WebSocket(`ws://${host}:3001`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ type: 'deck-list' }));
      ws.send(JSON.stringify({ type: 'get-actions' }));
    };

    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'deck-profiles':
          setProfiles(msg.profiles);
          break;
        case 'deck-state':
          setCurrentProfile(msg.name);
          setGrid(msg.grid);
          break;
        case 'deck-saved':
          // Refresh profile list after save
          ws.send(JSON.stringify({ type: 'deck-list' }));
          break;
        case 'actions':
          setCategories(msg.categories);
          break;
      }
    };

    return () => { ws.close(); };
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
    setGrid(prev => prev.map(s => {
      if (s.row !== row || s.col !== col) return s;
      const actions = s.button.actions.filter((_, i) => i !== actionIndex);
      if (actions.length === 0) return null as any; // will be filtered
      return { ...s, button: { ...s.button, actions } };
    }).filter(Boolean));
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
```

**Step 3: Verify it compiles**

Run: `cd ui && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add ui/src/types.ts ui/src/hooks/useDeck.ts
git commit -m "feat(deck): add frontend deck types and useDeck hook"
```

---

### Task 6: DeckPage, DeckToolbar, DeckGrid — Scaffold

Create the page shell with toolbar and empty grid. No button interactivity yet — just the layout.

**Files:**
- Create: `ui/src/pages/DeckPage.tsx`
- Create: `ui/src/components/deck/DeckToolbar.tsx`
- Create: `ui/src/components/deck/DeckGrid.tsx`
- Modify: `ui/src/main.tsx` (add pathname routing)

**Step 1: Create DeckToolbar**

```tsx
import { useState } from 'react';

interface DeckToolbarProps {
  profiles: string[];
  currentProfile: string | null;
  editing: boolean;
  onLoadProfile: (name: string) => void;
  onSaveProfile: (name: string) => void;
  onDeleteProfile: (name: string) => void;
  onToggleEdit: () => void;
}

export function DeckToolbar({
  profiles, currentProfile, editing,
  onLoadProfile, onSaveProfile, onDeleteProfile, onToggleEdit,
}: DeckToolbarProps) {
  const [newName, setNewName] = useState('');

  const handleSave = () => {
    const name = newName.trim() || currentProfile;
    if (name) {
      onSaveProfile(name);
      setNewName('');
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '8px 16px',
      background: '#1E293B', borderBottom: '1px solid #334155',
      height: 48, boxSizing: 'border-box',
    }}>
      {/* Profile selector */}
      <select
        value={currentProfile ?? ''}
        onChange={(e) => e.target.value && onLoadProfile(e.target.value)}
        style={{
          background: '#0F172A', color: '#E2E8F0', border: '1px solid #475569',
          borderRadius: 6, padding: '4px 8px', fontSize: 14,
        }}
      >
        <option value="">Select profile...</option>
        {profiles.map(p => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>

      {/* Save controls (edit mode only) */}
      {editing && (
        <>
          <input
            type="text"
            placeholder={currentProfile ?? 'Profile name...'}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            style={{
              background: '#0F172A', color: '#E2E8F0', border: '1px solid #475569',
              borderRadius: 6, padding: '4px 8px', fontSize: 14, width: 160,
            }}
          />
          <button onClick={handleSave} style={toolbarBtn('#3B82F6')}>Save</button>
          {currentProfile && (
            <button onClick={() => onDeleteProfile(currentProfile)} style={toolbarBtn('#EF4444')}>Delete</button>
          )}
        </>
      )}

      <div style={{ flex: 1 }} />

      {/* Edit toggle */}
      <button
        onClick={onToggleEdit}
        style={toolbarBtn(editing ? '#10B981' : '#475569')}
      >
        {editing ? '✅ Done' : '✏️ Edit'}
      </button>
    </div>
  );
}

function toolbarBtn(color: string): React.CSSProperties {
  return {
    background: color, color: '#FFF', border: 'none',
    borderRadius: 6, padding: '6px 14px', fontSize: 13,
    cursor: 'pointer', fontWeight: 600,
  };
}
```

**Step 2: Create DeckGrid**

```tsx
import { GridSlot, DeckButton } from '../../types';

interface DeckGridProps {
  grid: GridSlot[];
  editing: boolean;
  onFire: (button: DeckButton) => void;
  onRemove: (row: number, col: number) => void;
}

const ROWS = 4;
const COLS = 8;

export function DeckGrid({ grid, editing, onFire, onRemove }: DeckGridProps) {
  const getButton = (row: number, col: number): DeckButton | null => {
    const slot = grid.find(s => s.row === row && s.col === col);
    return slot?.button ?? null;
  };

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: `repeat(${COLS}, 1fr)`,
      gridTemplateRows: `repeat(${ROWS}, 1fr)`,
      gap: 8, padding: 16, flex: 1,
    }}>
      {Array.from({ length: ROWS * COLS }, (_, i) => {
        const row = Math.floor(i / COLS);
        const col = i % COLS;
        const button = getButton(row, col);

        if (!button) {
          return (
            <div
              key={`${row}-${col}`}
              data-row={row}
              data-col={col}
              style={{
                border: editing ? '2px dashed #334155' : '2px solid transparent',
                borderRadius: 12, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                color: '#475569', fontSize: 24,
                aspectRatio: '1',
                transition: 'border-color 0.15s',
              }}
            >
              {editing ? '+' : ''}
            </div>
          );
        }

        return (
          <div
            key={`${row}-${col}`}
            data-row={row}
            data-col={col}
            onPointerDown={() => !editing && onFire(button)}
            style={{
              background: button.color + '26',
              border: `2px solid ${button.color}55`,
              borderRadius: 12,
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              cursor: editing ? 'default' : 'pointer',
              userSelect: 'none',
              position: 'relative',
              aspectRatio: '1',
              transition: 'transform 0.1s, box-shadow 0.1s',
            }}
          >
            <span style={{ fontSize: 24 }}>{button.icon}</span>
            <span style={{
              fontSize: 11, color: '#E2E8F0', marginTop: 4,
              textAlign: 'center', padding: '0 4px',
              overflow: 'hidden', textOverflow: 'ellipsis',
              whiteSpace: 'nowrap', maxWidth: '100%',
            }}>
              {button.label}
            </span>
            {button.actions.length > 1 && (
              <span style={{
                position: 'absolute', top: 4, right: 6,
                fontSize: 9, color: '#94A3B8', fontWeight: 700,
              }}>
                {button.actions.length}
              </span>
            )}
            {editing && (
              <button
                onClick={(e) => { e.stopPropagation(); onRemove(row, col); }}
                style={{
                  position: 'absolute', top: -6, right: -6,
                  background: '#EF4444', color: '#FFF', border: 'none',
                  borderRadius: '50%', width: 20, height: 20,
                  fontSize: 12, cursor: 'pointer', lineHeight: '20px',
                  padding: 0,
                }}
              >
                ✕
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

**Step 3: Create DeckPage**

```tsx
import { useDeck } from '../hooks/useDeck';
import { DeckToolbar } from '../components/deck/DeckToolbar';
import { DeckGrid } from '../components/deck/DeckGrid';

export function DeckPage() {
  const deck = useDeck();

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column',
      background: '#0F172A', color: '#E2E8F0',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      <DeckToolbar
        profiles={deck.profiles}
        currentProfile={deck.currentProfile}
        editing={deck.editing}
        onLoadProfile={deck.loadProfile}
        onSaveProfile={deck.saveProfile}
        onDeleteProfile={deck.deleteProfile}
        onToggleEdit={deck.toggleEdit}
      />
      <DeckGrid
        grid={deck.grid}
        editing={deck.editing}
        onFire={deck.fireButton}
        onRemove={deck.removeButton}
      />
    </div>
  );
}
```

**Step 4: Add routing in main.tsx**

Replace the entire `main.tsx` with:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { DeckPage } from './pages/DeckPage'

const isDeckRoute = window.location.pathname === '/deck' || window.location.pathname === '/deck/';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDeckRoute ? <DeckPage /> : <App />}
  </StrictMode>,
)
```

**Step 5: Configure Vite for client-side routing**

In `ui/vite.config.ts`, add `appType: 'spa'` to ensure Vite serves `index.html` for all routes during dev. This is actually the default, but we need to make sure the dev server doesn't 404 on `/deck`. Vite's SPA fallback is built-in — no config change needed. Verify by running the dev server and navigating to `http://localhost:5173/deck`.

**Step 6: Verify it compiles**

Run: `cd ui && npx tsc --noEmit`
Expected: no errors

**Step 7: Commit**

```bash
git add ui/src/main.tsx ui/src/pages/DeckPage.tsx ui/src/components/deck/DeckToolbar.tsx ui/src/components/deck/DeckGrid.tsx
git commit -m "feat(deck): add DeckPage with toolbar and grid layout"
```

---

### Task 7: Drag-and-Drop — Assign Actions to Grid Slots

Wire up the drop targets so actions can be dragged from `ActionPalette` onto grid slots.

**Files:**
- Modify: `ui/src/components/deck/DeckGrid.tsx` (add drop handlers)
- Modify: `ui/src/pages/DeckPage.tsx` (pass ActionPalette + assignAction)

**Step 1: Add drop handling to DeckGrid**

Update the `DeckGridProps` interface to add:

```typescript
  onAssign: (row: number, col: number, actionId: string, osc?: any, meta?: { label: string; icon: string; color: string }) => void;
  categories: ActionCategory[];
```

Add import: `import { ActionCategory } from '../../types';`

For both the empty-slot div and the button div, add these event handlers:

```typescript
onDragOver={(e) => { if (editing) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
onDragEnter={(e) => { if (editing) { e.preventDefault(); (e.currentTarget as HTMLElement).style.borderColor = '#3B82F6'; } }}
onDragLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = ''; }}
onDrop={(e) => {
  e.preventDefault();
  (e.currentTarget as HTMLElement).style.borderColor = '';
  if (!editing) return;

  // Try application/json first (inline OSC from CommandBuilder)
  const jsonData = e.dataTransfer.getData('application/json');
  if (jsonData) {
    try {
      const { actionId, osc } = JSON.parse(jsonData);
      onAssign(row, col, actionId, osc, { label: osc?.label ?? actionId, icon: '⚡', color: '#64748B' });
      return;
    } catch {}
  }

  // Fall back to text/plain (registry action ID)
  const actionId = e.dataTransfer.getData('text/plain');
  if (actionId) {
    // Find action metadata from categories
    let meta = { label: actionId, icon: '', color: '#3B82F6' };
    for (const cat of categories) {
      const item = cat.items.find(i => i.id === actionId);
      if (item) {
        meta = { label: item.label, icon: cat.icon, color: cat.color };
        break;
      }
    }
    onAssign(row, col, actionId, undefined, meta);
  }
}}
```

**Step 2: Update DeckPage to show ActionPalette in edit mode**

Import `ActionPalette` from the existing components. Update DeckPage layout:

```tsx
import { ActionPalette } from '../components/ActionPalette';

// In the return, wrap DeckGrid in a flex row:
<div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
  {deck.editing && (
    <div style={{ width: 270, borderRight: '1px solid #334155', overflowY: 'auto' }}>
      <ActionPalette categories={deck.categories} />
    </div>
  )}
  <DeckGrid
    grid={deck.grid}
    editing={deck.editing}
    categories={deck.categories}
    onFire={deck.fireButton}
    onRemove={deck.removeButton}
    onAssign={deck.assignAction}
  />
</div>
```

**Step 3: Verify it compiles**

Run: `cd ui && npx tsc --noEmit`
Expected: no errors

**Step 4: Manual test**

Run both dev servers (`npm run dev:all`). Navigate to `http://localhost:5173/deck`. Toggle edit mode. Drag an action from the palette onto an empty grid slot. Verify the button appears. Drag another action onto the same slot. Verify the action count badge shows `2`.

**Step 5: Commit**

```bash
git add ui/src/components/deck/DeckGrid.tsx ui/src/pages/DeckPage.tsx
git commit -m "feat(deck): wire drag-and-drop from ActionPalette to grid slots"
```

---

### Task 8: DeckButton Component with Fire Animation

Replace the inline button rendering in DeckGrid with a dedicated `DeckButton` component that handles press animation.

**Files:**
- Create: `ui/src/components/deck/DeckButton.tsx`
- Modify: `ui/src/components/deck/DeckGrid.tsx` (use DeckButton component)

**Step 1: Create DeckButton component**

```tsx
import { useState, useCallback } from 'react';
import { DeckButton as DeckButtonType } from '../../types';

interface DeckButtonProps {
  button: DeckButtonType;
  editing: boolean;
  onFire: (button: DeckButtonType) => void;
  onRemove: () => void;
}

export function DeckButton({ button, editing, onFire, onRemove }: DeckButtonProps) {
  const [firing, setFiring] = useState(false);

  const handlePress = useCallback(() => {
    if (editing) return;
    onFire(button);
    setFiring(true);
    setTimeout(() => setFiring(false), 200);
  }, [button, editing, onFire]);

  return (
    <div
      onPointerDown={handlePress}
      style={{
        background: firing
          ? button.color + '80'
          : button.color + '26',
        border: `2px solid ${button.color}${firing ? 'CC' : '55'}`,
        borderRadius: 12,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        cursor: editing ? 'default' : 'pointer',
        userSelect: 'none',
        position: 'relative',
        aspectRatio: '1',
        transition: 'background 0.2s, border-color 0.2s, transform 0.1s',
        transform: firing ? 'scale(0.95)' : 'scale(1)',
        boxShadow: firing ? `0 0 20px ${button.color}66` : 'none',
      }}
    >
      <span style={{ fontSize: 24, pointerEvents: 'none' }}>{button.icon}</span>
      <span style={{
        fontSize: 11, color: '#E2E8F0', marginTop: 4,
        textAlign: 'center', padding: '0 4px',
        overflow: 'hidden', textOverflow: 'ellipsis',
        whiteSpace: 'nowrap', maxWidth: '100%',
        pointerEvents: 'none',
      }}>
        {button.label}
      </span>
      {button.actions.length > 1 && (
        <span style={{
          position: 'absolute', top: 4, right: 6,
          fontSize: 9, color: '#94A3B8', fontWeight: 700,
          pointerEvents: 'none',
        }}>
          {button.actions.length}
        </span>
      )}
      {button.mode === 'series' && (
        <span style={{
          position: 'absolute', bottom: 4, right: 6,
          fontSize: 8, color: '#94A3B8',
          pointerEvents: 'none',
        }}>
          ▶▶
        </span>
      )}
      {editing && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{
            position: 'absolute', top: -6, right: -6,
            background: '#EF4444', color: '#FFF', border: 'none',
            borderRadius: '50%', width: 20, height: 20,
            fontSize: 12, cursor: 'pointer', lineHeight: '20px',
            padding: 0,
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
```

**Step 2: Update DeckGrid to use DeckButton**

Replace the occupied-slot inline div with `<DeckButton button={button} editing={editing} onFire={onFire} onRemove={() => onRemove(row, col)} />`. Keep the drag/drop handlers on the wrapping container div.

**Step 3: Verify it compiles**

Run: `cd ui && npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add ui/src/components/deck/DeckButton.tsx ui/src/components/deck/DeckGrid.tsx
git commit -m "feat(deck): add DeckButton component with fire animation"
```

---

### Task 9: DeckButtonEditor — Edit Button Details

Create the expanded editor that appears when clicking a button in edit mode. Allows editing label, color, mode, action stack.

**Files:**
- Create: `ui/src/components/deck/DeckButtonEditor.tsx`
- Modify: `ui/src/components/deck/DeckGrid.tsx` (show editor on click in edit mode)

**Step 1: Create DeckButtonEditor**

```tsx
import { DeckButton } from '../../types';

interface DeckButtonEditorProps {
  button: DeckButton;
  row: number;
  col: number;
  onUpdate: (row: number, col: number, updates: Partial<DeckButton>) => void;
  onRemoveAction: (row: number, col: number, actionIndex: number) => void;
  onClose: () => void;
}

export function DeckButtonEditor({
  button, row, col, onUpdate, onRemoveAction, onClose,
}: DeckButtonEditorProps) {
  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.6)', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div style={{
        background: '#1E293B', borderRadius: 12, padding: 20,
        minWidth: 320, maxWidth: 400, border: '1px solid #334155',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
          <h3 style={{ margin: 0, color: '#E2E8F0', fontSize: 16 }}>Edit Button</h3>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#94A3B8',
            cursor: 'pointer', fontSize: 18,
          }}>✕</button>
        </div>

        {/* Label */}
        <label style={labelStyle}>Label</label>
        <input
          type="text"
          value={button.label}
          onChange={(e) => onUpdate(row, col, { label: e.target.value })}
          style={inputStyle}
        />

        {/* Icon */}
        <label style={labelStyle}>Icon</label>
        <input
          type="text"
          value={button.icon}
          onChange={(e) => onUpdate(row, col, { icon: e.target.value })}
          style={{ ...inputStyle, width: 60 }}
        />

        {/* Color */}
        <label style={labelStyle}>Color</label>
        <input
          type="color"
          value={button.color}
          onChange={(e) => onUpdate(row, col, { color: e.target.value })}
          style={{ ...inputStyle, width: 60, height: 32, padding: 2 }}
        />

        {/* Mode */}
        <label style={labelStyle}>Execution Mode</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['parallel', 'series'] as const).map(m => (
            <button
              key={m}
              onClick={() => onUpdate(row, col, { mode: m })}
              style={{
                background: button.mode === m ? '#3B82F6' : '#0F172A',
                color: '#E2E8F0', border: '1px solid #475569',
                borderRadius: 6, padding: '6px 14px', cursor: 'pointer',
                fontSize: 13, fontWeight: button.mode === m ? 700 : 400,
              }}
            >
              {m === 'parallel' ? '⚡ Parallel' : '▶▶ Series'}
            </button>
          ))}
        </div>

        {/* Series gap (only in series mode) */}
        {button.mode === 'series' && (
          <>
            <label style={labelStyle}>Gap (ms)</label>
            <input
              type="number"
              value={button.seriesGap}
              min={0} step={100}
              onChange={(e) => onUpdate(row, col, { seriesGap: parseInt(e.target.value) || 0 })}
              style={{ ...inputStyle, width: 100 }}
            />
          </>
        )}

        {/* Action stack */}
        <label style={labelStyle}>Actions ({button.actions.length})</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {button.actions.map((action, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: '#0F172A', borderRadius: 6, padding: '6px 8px',
            }}>
              <span style={{ flex: 1, fontSize: 12, color: '#CBD5E1', fontFamily: 'monospace' }}>
                {action.osc ? action.osc.label : action.actionId}
              </span>
              <button
                onClick={() => onRemoveAction(row, col, i)}
                style={{
                  background: 'none', border: 'none', color: '#EF4444',
                  cursor: 'pointer', fontSize: 14, padding: '0 4px',
                }}
              >✕</button>
            </div>
          ))}
        </div>

        {/* Drop hint */}
        <div style={{
          marginTop: 8, padding: 8, border: '2px dashed #334155',
          borderRadius: 6, textAlign: 'center', color: '#475569', fontSize: 12,
        }}>
          Drag actions here to add
        </div>
      </div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', color: '#94A3B8', fontSize: 11,
  marginBottom: 4, marginTop: 12, textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const inputStyle: React.CSSProperties = {
  background: '#0F172A', color: '#E2E8F0', border: '1px solid #475569',
  borderRadius: 6, padding: '6px 8px', fontSize: 14, width: '100%',
  boxSizing: 'border-box',
};
```

**Step 2: Add editor state and click handler to DeckGrid**

Add state to DeckGrid: `const [editingSlot, setEditingSlot] = useState<{ row: number; col: number } | null>(null);`

Add `onUpdate` and `onRemoveAction` to DeckGridProps. On button click in edit mode, call `setEditingSlot({ row, col })`. Render `<DeckButtonEditor>` when `editingSlot` is set.

**Step 3: Wire through DeckPage**

Pass `deck.updateButton` and `deck.removeAction` into DeckGrid.

**Step 4: Verify it compiles**

Run: `cd ui && npx tsc --noEmit`
Expected: no errors

**Step 5: Commit**

```bash
git add ui/src/components/deck/DeckButtonEditor.tsx ui/src/components/deck/DeckGrid.tsx ui/src/pages/DeckPage.tsx
git commit -m "feat(deck): add DeckButtonEditor — label, color, mode, action stack"
```

---

### Task 10: Live State Feedback

Add device state indicators to DeckButton — fill bars for levels, glow for active states, LIVE dots.

**Files:**
- Create: `ui/src/components/deck/useDeckButtonState.ts`
- Modify: `ui/src/components/deck/DeckButton.tsx` (render state overlay)
- Modify: `ui/src/components/deck/DeckGrid.tsx` (pass deviceStates)
- Modify: `ui/src/pages/DeckPage.tsx` (add useDeviceStates, pass down)

**Step 1: Create useDeckButtonState hook**

This hook parses a button's first action to determine what device state to reflect.

```typescript
import { DeckButton as DeckButtonType } from '../../types';

interface DeviceStates {
  avantis: any;
  obs: any;
  chamsys: any;
  visca: any;
  touchdesigner: any;
}

export interface ButtonState {
  level: number | null;    // 0-1 fill bar
  active: boolean;         // glow border
  live: boolean;           // red LIVE dot
}

export function getDeckButtonState(button: DeckButtonType, deviceStates: DeviceStates): ButtonState {
  const state: ButtonState = { level: null, active: false, live: false };
  if (!button.actions.length) return state;

  const firstAction = button.actions[0];
  const address = firstAction.osc?.address ?? '';

  // ChamSys playback level: /lights/pb/{N} or /pb/{N}
  const pbLevelMatch = address.match(/\/(?:lights\/)?pb\/(\d+)$/);
  if (pbLevelMatch && deviceStates.chamsys?.playbacks) {
    const pb = deviceStates.chamsys.playbacks[pbLevelMatch[1]];
    if (pb) {
      state.level = pb.level ?? null;
      state.active = pb.active ?? false;
    }
    return state;
  }

  // ChamSys playback go: /lights/pb/{N}/go or /pb/{N}/1
  const pbGoMatch = address.match(/\/(?:lights\/)?pb\/(\d+)\/(?:go|1)$/);
  if (pbGoMatch && deviceStates.chamsys?.playbacks) {
    const pb = deviceStates.chamsys.playbacks[pbGoMatch[1]];
    if (pb) state.active = pb.active ?? false;
    return state;
  }

  // Camera preset: /cam{N}/preset/recall/{P}
  const camMatch = address.match(/\/cam(\d+)\/preset\/recall\/(\d+)$/);
  if (camMatch && deviceStates.visca) {
    state.active = deviceStates.visca.currentPreset === parseInt(camMatch[2]);
    return state;
  }

  // OBS scene: /obs/scene/{name}
  const obsSceneMatch = address.match(/\/obs\/scene\/([^/]+)$/);
  if (obsSceneMatch && deviceStates.obs) {
    state.live = deviceStates.obs.currentScene === obsSceneMatch[1];
    return state;
  }

  // OBS preview: /obs/scene/preview/{name}
  const obsPreviewMatch = address.match(/\/obs\/scene\/preview\/([^/]+)$/);
  if (obsPreviewMatch && deviceStates.obs) {
    state.active = deviceStates.obs.previewScene === obsPreviewMatch[1];
    return state;
  }

  // For registry actions, try to match by actionId patterns
  const actionId = firstAction.actionId;
  if (!address && actionId && deviceStates.chamsys?.playbacks) {
    // Registry actions that map to chamsys playbacks can be matched
    // by checking the action's commands — but we don't have that info client-side.
    // This is a future enhancement.
  }

  return state;
}
```

**Step 2: Update DeckButton to render state**

Add imports and use `getDeckButtonState`. Render:
- A fill bar div (absolute positioned, bottom-up, width 100%, height = `level * 100%`, button color at 40% opacity)
- A green border when `active` is true
- A red "LIVE" dot when `live` is true

```tsx
// Inside DeckButton, before the return:
const buttonState = getDeckButtonState(button, deviceStates);

// Fill bar (inside the button div, first child):
{buttonState.level !== null && (
  <div style={{
    position: 'absolute', bottom: 0, left: 0, right: 0,
    height: `${(buttonState.level ?? 0) * 100}%`,
    background: button.color + '66',
    borderRadius: '0 0 10px 10px',
    transition: 'height 0.15s ease-out',
    pointerEvents: 'none',
  }} />
)}

// LIVE dot (top-left corner):
{buttonState.live && (
  <span style={{
    position: 'absolute', top: 4, left: 6,
    fontSize: 8, color: '#EF4444', fontWeight: 700,
  }}>● LIVE</span>
)}

// Modify border color:
border: `2px solid ${
  buttonState.active ? '#10B981' :
  buttonState.live ? '#EF4444' :
  button.color + (firing ? 'CC' : '55')
}`
```

Add `deviceStates` to DeckButtonProps.

**Step 3: Pass deviceStates through DeckGrid and DeckPage**

In `DeckPage.tsx`, add: `import { useDeviceStates } from '../hooks/useDeviceStates';`
Call: `const { deviceStates } = useDeviceStates();`
Pass `deviceStates` into `<DeckGrid>`, which passes it into each `<DeckButton>`.

**Step 4: Verify it compiles**

Run: `cd ui && npx tsc --noEmit`
Expected: no errors

**Step 5: Commit**

```bash
git add ui/src/components/deck/useDeckButtonState.ts ui/src/components/deck/DeckButton.tsx ui/src/components/deck/DeckGrid.tsx ui/src/pages/DeckPage.tsx
git commit -m "feat(deck): add live state feedback — fill bars, active glow, LIVE dots"
```

---

### Task 11: End-to-End Verification

Manual test of the complete flow + type check.

**Step 1: Type check backend**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 2: Type check frontend**

Run: `cd ui && npx tsc --noEmit`
Expected: no errors

**Step 3: Run backend tests**

Run: `npm test`
Expected: all tests pass (existing + new deck-persistence and deck-fire tests)

**Step 4: Manual E2E test**

1. Start backend: `npm run dev`
2. Start frontend: `cd ui && npm run dev`
3. Open `http://localhost:5173/deck`
4. Verify: empty grid renders, toolbar shows
5. Toggle edit mode — verify ActionPalette appears
6. Drag an action onto slot (0,0) — verify button appears with icon/label/color
7. Drag another action onto the same slot — verify action count badge shows `2`
8. Click button in edit mode — verify editor opens with action stack, mode toggle
9. Toggle to series mode, set gap — verify UI updates
10. Save profile — verify it appears in dropdown
11. Click Done to exit edit mode
12. Press a button — verify pulse animation
13. If emulators running: verify live state feedback on ChamSys/OBS/camera buttons
14. Open `http://localhost:5173/deck?profile=<name>` — verify auto-loads
15. Open `http://localhost:5173/` — verify original CueStack UI unchanged

**Step 5: Commit any fixes from manual testing**

```bash
git add -A
git commit -m "fix(deck): address issues found during manual testing"
```
