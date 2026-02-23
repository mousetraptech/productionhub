# MOD UI Simplification, OBS Scene Dropdowns & Stream Deck Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Simplify the MOD UI from fill-then-drag to drag-then-prompt, add live OBS scene dropdowns, and fix the Stream Deck plugin manifest crash.

**Architecture:** Replace the CommandBuilder's inline form rows with clean draggable tiles. On drop, a modal dialog prompts for parameters. OBS driver gains GetSceneList to power scene dropdowns. Stream Deck manifest is copied to bin/ during rollup build.

**Tech Stack:** React (inline styles, no CSS framework), TypeScript, OBS WebSocket v5 JSON-RPC, Rollup

---

### Task 1: Fix Stream Deck Plugin Manifest Path

**Files:**
- Modify: `streamdeck-plugin/rollup.config.mjs`

**Step 1: Add rollup copy plugin to build config**

```javascript
// streamdeck-plugin/rollup.config.mjs
import typescript from "@rollup/plugin-typescript";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import { copyFileSync, mkdirSync } from "fs";

function copyManifest() {
  return {
    name: "copy-manifest",
    writeBundle() {
      mkdirSync("com.productionhub.deck.sdPlugin/bin", { recursive: true });
      copyFileSync(
        "com.productionhub.deck.sdPlugin/manifest.json",
        "com.productionhub.deck.sdPlugin/bin/manifest.json"
      );
    },
  };
}

export default {
  input: "src/plugin.ts",
  output: {
    file: "com.productionhub.deck.sdPlugin/bin/plugin.js",
    format: "esm",
    sourcemap: true,
  },
  plugins: [
    nodeResolve(),
    commonjs(),
    typescript(),
    copyManifest(),
  ],
};
```

**Step 2: Build the plugin**

Run: `cd /Users/dave/projects/productionhub/streamdeck-plugin && npm run build`
Expected: Build succeeds, `com.productionhub.deck.sdPlugin/bin/manifest.json` now exists

**Step 3: Verify the fix**

Run: `ls -la /Users/dave/projects/productionhub/streamdeck-plugin/com.productionhub.deck.sdPlugin/bin/manifest.json`
Expected: File exists

**Step 4: Commit**

```bash
git add streamdeck-plugin/rollup.config.mjs streamdeck-plugin/com.productionhub.deck.sdPlugin/bin/manifest.json
git commit -m "fix: copy manifest.json to bin/ so Stream Deck SDK finds it"
```

---

### Task 2: OBS Driver — Add GetSceneList and getState()

**Files:**
- Modify: `src/drivers/obs-driver.ts`

**Step 1: Add scene list state and getState() method**

After line 56 (`private reconnectQueue = ...`), add:

```typescript
  private scenes: string[] = [];
  private currentScene: string = '';
  private previewScene: string = '';
```

After `emitFeedback()` (line 474), add:

```typescript
  getState(): Record<string, any> {
    return {
      scenes: this.scenes,
      currentScene: this.currentScene,
      previewScene: this.previewScene,
    };
  }
```

**Step 2: Query scene list after identification**

In `handleWSMessage()`, after `this.flushQueue()` in the `case 2` (Identified) block (line 338), add:

```typescript
        this.querySceneList();
```

Add the new method after `flushQueue()`:

```typescript
  private async querySceneList(): Promise<void> {
    try {
      const resp = await this.sendRequestAsync('GetSceneList');
      if (resp?.requestStatus?.result && resp.responseData?.scenes) {
        this.scenes = resp.responseData.scenes.map((s: any) => s.sceneName);
        if (this.verbose) console.log(`[OBS] Scene list: ${this.scenes.join(', ')}`);
        // Emit feedback to trigger state broadcast to UI
        this.emitFeedback('/scenes/list', [{ type: 's', value: this.scenes.join(',') }]);
      }
    } catch (err: any) {
      console.error(`[OBS] Failed to get scene list: ${err.message}`);
    }
  }
```

**Step 3: Track current scene and preview from events**

In `handleEvent()`, update the `CurrentProgramSceneChanged` case to also store the name:

```typescript
      case 'CurrentProgramSceneChanged':
        this.currentScene = data.eventData?.sceneName ?? '';
        this.emitFeedback('/scene/current', [
          { type: 's', value: this.currentScene },
        ]);
        break;
```

Add a new case for `CurrentPreviewSceneChanged`:

```typescript
      case 'CurrentPreviewSceneChanged':
        this.previewScene = data.eventData?.sceneName ?? '';
        this.emitFeedback('/scene/preview', [
          { type: 's', value: this.previewScene },
        ]);
        break;
```

Add a new case for `SceneListChanged`:

```typescript
      case 'SceneListChanged':
        this.querySceneList();
        break;
```

**Step 4: Run type check**

Run: `cd /Users/dave/projects/productionhub && npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/drivers/obs-driver.ts
git commit -m "feat: OBS driver queries scene list and exposes getState()"
```

---

### Task 3: UI — Add scenes to OBSState type

**Files:**
- Modify: `ui/src/hooks/useDeviceStates.ts`

**Step 1: Add scenes field to OBSState**

In the `OBSState` interface (line 33-42), add `scenes`:

```typescript
export interface OBSState {
  scenes: string[];
  currentScene: string;
  previewScene: string;
  streaming: boolean;
  recording: boolean;
  virtualCam: boolean;
  currentTransition: string;
  transitionDuration: number;
  sources: Record<string, boolean>;
}
```

**Step 2: Run type check**

Run: `cd /Users/dave/projects/productionhub/ui && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add ui/src/hooks/useDeviceStates.ts
git commit -m "feat: add scenes field to OBSState type"
```

---

### Task 4: UI — Create CommandTile component

Replace the inline-form BuilderRow tiles with simple draggable tiles that carry only the command type.

**Files:**
- Create: `ui/src/components/CommandTile.tsx`

**Step 1: Create the CommandTile component**

```tsx
import { useState } from 'react';

export interface CommandTileDef {
  type: string;
  label: string;
  icon: string;
  color: string;
  category: string;
}

interface CommandTileProps {
  def: CommandTileDef;
}

export default function CommandTile({ def }: CommandTileProps) {
  const [hovering, setHovering] = useState(false);

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-command-type', def.type);
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      style={{
        padding: '9px 12px',
        background: hovering ? def.color + '28' : def.color + '12',
        border: `1.5px solid ${hovering ? def.color + '77' : def.color + '33'}`,
        borderRadius: 10,
        cursor: 'grab',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        transition: 'all 0.15s ease',
        userSelect: 'none',
        transform: hovering ? 'translateY(-1px)' : 'none',
      }}
    >
      <span style={{ fontSize: 16, lineHeight: 1 }}>{def.icon}</span>
      <span style={{ fontWeight: 600, color: '#E2E8F0', fontSize: 13, lineHeight: 1.2 }}>
        {def.label}
      </span>
    </div>
  );
}
```

Uses a new MIME type `application/x-command-type` to distinguish from registry actions (`text/plain`) and pre-built inline OSC (`application/json`).

**Step 2: Run type check**

Run: `cd /Users/dave/projects/productionhub/ui && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add ui/src/components/CommandTile.tsx
git commit -m "feat: add CommandTile drag component for command types"
```

---

### Task 5: UI — Create CommandModal component

The modal that appears on drop, prompts for parameters, validates, and builds the OSC payload.

**Files:**
- Create: `ui/src/components/CommandModal.tsx`

**Step 1: Create the CommandModal component**

This component reuses the COMMANDS definitions and `normFader` from CommandBuilder.tsx, but renders them in a modal dialog instead of inline form rows. The command definitions (`COMMANDS` array, `CmdDef`/`FieldDef` types, and `normFader` function) should be extracted to a shared file.

Create `ui/src/components/command-defs.ts`:

```typescript
import type { InlineOSC } from '../types';

export type CmdType =
  | 'set-fader'
  | 'set-dca'
  | 'fade-fader'
  | 'fade-dca'
  | 'mute'
  | 'unmute'
  | 'recall-scene'
  | 'playback'
  | 'playback-go'
  | 'playback-jump'
  | 'cam1-preset' | 'cam1-zoom' | 'cam1-home'
  | 'cam2-preset' | 'cam2-zoom' | 'cam2-home'
  | 'cam3-preset' | 'cam3-zoom' | 'cam3-home'
  | 'obs-scene'
  | 'obs-preview'
  | 'obs-transition'
  | 'raw-osc';

export interface FieldDef {
  key: string;
  placeholder: string;
  type: 'number' | 'text' | 'select';
  width?: number;
  options?: string[];  // for select fields, populated dynamically
}

export interface CmdDef {
  type: CmdType;
  label: string;
  fields: FieldDef[];
  delay?: number;
  build: (vals: Record<string, string>) => InlineOSC | null;
}

export function normFader(raw: string): number {
  const v = parseFloat(raw);
  if (isNaN(v)) return 0;
  if (v > 1) return Math.min(v / 100, 1);
  return Math.max(0, Math.min(v, 1));
}

export function getCommands(obsScenes?: string[]): CmdDef[] {
  const sceneField = (key: string, placeholder: string): FieldDef =>
    obsScenes && obsScenes.length > 0
      ? { key, placeholder, type: 'select', options: obsScenes }
      : { key, placeholder, type: 'text', width: 140 };

  return [
    {
      type: 'set-fader',
      label: 'Set Fader',
      fields: [
        { key: 'ch', placeholder: 'Channel', type: 'number', width: 80 },
        { key: 'val', placeholder: 'Level (0-100)', type: 'number', width: 100 },
      ],
      build: (v) => {
        const ch = parseInt(v.ch, 10);
        const val = normFader(v.val);
        if (isNaN(ch) || ch < 1) return null;
        return { address: `/avantis/ch/${ch}/mix/fader`, args: [val], label: `Fader ${ch} → ${Math.round(val * 100)}%` };
      },
    },
    {
      type: 'set-dca',
      label: 'Set DCA',
      fields: [
        { key: 'n', placeholder: 'DCA', type: 'number', width: 80 },
        { key: 'val', placeholder: 'Level (0-100)', type: 'number', width: 100 },
      ],
      build: (v) => {
        const n = parseInt(v.n, 10);
        const val = normFader(v.val);
        if (isNaN(n) || n < 1) return null;
        return { address: `/avantis/dca/${n}/fader`, args: [val], label: `DCA ${n} → ${Math.round(val * 100)}%` };
      },
    },
    {
      type: 'fade-fader',
      label: 'Fade Fader',
      fields: [
        { key: 'ch', placeholder: 'Channel', type: 'number', width: 80 },
        { key: 'val', placeholder: 'Target (0-100)', type: 'number', width: 100 },
        { key: 'dur', placeholder: 'Seconds', type: 'number', width: 80 },
      ],
      build: (v) => {
        const ch = parseInt(v.ch, 10);
        const val = normFader(v.val);
        const dur = parseFloat(v.dur);
        if (isNaN(ch) || ch < 1 || isNaN(dur) || dur <= 0) return null;
        return { address: `/avantis/ch/${ch}/mix/fade`, args: [val, dur], label: `Fade Ch ${ch} → ${Math.round(val * 100)}% (${dur}s)` };
      },
    },
    {
      type: 'fade-dca',
      label: 'Fade DCA',
      fields: [
        { key: 'n', placeholder: 'DCA', type: 'number', width: 80 },
        { key: 'val', placeholder: 'Target (0-100)', type: 'number', width: 100 },
        { key: 'dur', placeholder: 'Seconds', type: 'number', width: 80 },
      ],
      build: (v) => {
        const n = parseInt(v.n, 10);
        const val = normFader(v.val);
        const dur = parseFloat(v.dur);
        if (isNaN(n) || n < 1 || isNaN(dur) || dur <= 0) return null;
        return { address: `/avantis/dca/${n}/fade`, args: [val, dur], label: `Fade DCA ${n} → ${Math.round(val * 100)}% (${dur}s)` };
      },
    },
    {
      type: 'mute',
      label: 'Mute',
      fields: [
        { key: 'ch', placeholder: 'Channel', type: 'number', width: 80 },
      ],
      build: (v) => {
        const ch = parseInt(v.ch, 10);
        if (isNaN(ch) || ch < 1) return null;
        return { address: `/avantis/ch/${ch}/mix/mute`, args: [1], label: `Mute Ch ${ch}` };
      },
    },
    {
      type: 'unmute',
      label: 'Unmute',
      fields: [
        { key: 'ch', placeholder: 'Channel', type: 'number', width: 80 },
      ],
      build: (v) => {
        const ch = parseInt(v.ch, 10);
        if (isNaN(ch) || ch < 1) return null;
        return { address: `/avantis/ch/${ch}/mix/mute`, args: [0], label: `Unmute Ch ${ch}` };
      },
    },
    {
      type: 'recall-scene',
      label: 'Recall Scene',
      fields: [
        { key: 'n', placeholder: 'Scene #', type: 'number', width: 80 },
      ],
      build: (v) => {
        const n = parseInt(v.n, 10);
        if (isNaN(n) || n < 0) return null;
        return { address: '/avantis/scene/recall', args: [n], label: `Scene ${n}` };
      },
    },
    {
      type: 'playback',
      label: 'Playback Level',
      fields: [
        { key: 'n', placeholder: 'PB #', type: 'number', width: 80 },
        { key: 'val', placeholder: 'Level (0-100)', type: 'number', width: 100 },
      ],
      build: (v) => {
        const n = parseInt(v.n, 10);
        const val = normFader(v.val);
        if (isNaN(n) || n < 1) return null;
        return { address: `/lights/pb/${n}`, args: [val], label: `PB ${n} → ${Math.round(val * 100)}%` };
      },
    },
    {
      type: 'playback-go',
      label: 'Playback Go',
      fields: [
        { key: 'n', placeholder: 'PB #', type: 'number', width: 80 },
      ],
      build: (v) => {
        const n = parseInt(v.n, 10);
        if (isNaN(n) || n < 1) return null;
        return { address: `/lights/pb/${n}/go`, args: [{ type: 'i', value: 1 }], label: `PB ${n} GO` };
      },
    },
    {
      type: 'playback-jump',
      label: 'Playback Jump',
      fields: [
        { key: 'pb', placeholder: 'PB #', type: 'number', width: 80 },
        { key: 'cue', placeholder: 'Cue #', type: 'number', width: 80 },
      ],
      build: (v) => {
        const pb = parseInt(v.pb, 10);
        const cue = parseInt(v.cue, 10);
        if (isNaN(pb) || pb < 1 || isNaN(cue) || cue < 1) return null;
        return { address: `/lights/pb/${pb}/go`, args: [1, cue], label: `PB ${pb} → Cue ${cue}` };
      },
    },
    // Camera commands — 3 per camera
    ...([1, 2, 3] as const).flatMap((cam): CmdDef[] => [
      {
        type: `cam${cam}-preset` as CmdType,
        label: `Cam ${cam} Preset`,
        fields: [{ key: 'n', placeholder: 'Preset #', type: 'number', width: 80 }],
        build: (v) => {
          const n = parseInt(v.n, 10);
          if (isNaN(n) || n < 1) return null;
          return { address: `/cam${cam}/preset/recall/${n}`, args: [], label: `C${cam} Preset ${n}` };
        },
      },
      {
        type: `cam${cam}-zoom` as CmdType,
        label: `Cam ${cam} Zoom`,
        fields: [{ key: 'val', placeholder: 'Level (0-100)', type: 'number', width: 100 }],
        build: (v) => {
          const val = normFader(v.val);
          return { address: `/cam${cam}/zoom/direct`, args: [val], label: `C${cam} Zoom ${Math.round(val * 100)}%` };
        },
      },
      {
        type: `cam${cam}-home` as CmdType,
        label: `Cam ${cam} Home`,
        fields: [],
        build: () => ({ address: `/cam${cam}/home`, args: [], label: `C${cam} Home` }),
      },
    ]),
    {
      type: 'obs-scene',
      label: 'OBS Scene',
      fields: [sceneField('name', 'Scene')],
      build: (v) => {
        if (!v.name?.trim()) return null;
        return { address: `/obs/scene/${v.name.trim()}`, args: [], label: `OBS → ${v.name.trim()}` };
      },
    },
    {
      type: 'obs-preview',
      label: 'OBS Preview',
      fields: [sceneField('name', 'Scene')],
      build: (v) => {
        if (!v.name?.trim()) return null;
        return { address: `/obs/scene/preview/${v.name.trim()}`, args: [], label: `OBS PVW → ${v.name.trim()}` };
      },
    },
    {
      type: 'obs-transition',
      label: 'OBS Transition',
      fields: [],
      delay: 100,
      build: () => ({ address: '/obs/transition/trigger', args: [], label: 'OBS Transition' }),
    },
    {
      type: 'raw-osc',
      label: 'Raw OSC',
      fields: [
        { key: 'addr', placeholder: '/address', type: 'text', width: 140 },
        { key: 'args', placeholder: 'arg1, arg2, ...', type: 'text', width: 100 },
      ],
      build: (v) => {
        const addr = v.addr?.trim();
        if (!addr || !addr.startsWith('/')) return null;
        const args = (v.args || '').split(/[\s,]+/).filter(Boolean).map(a => {
          const n = parseFloat(a);
          return isNaN(n) ? a : n;
        });
        return { address: addr, args, label: addr };
      },
    },
  ];
}

// Tile definitions for the sidebar — groups commands by device category
export interface TileCategory {
  category: string;
  icon: string;
  color: string;
  commands: { type: CmdType; label: string }[];
}

export const TILE_CATEGORIES: TileCategory[] = [
  {
    category: 'Audio',
    icon: '🎤',
    color: '#3B82F6',
    commands: [
      { type: 'set-fader', label: 'Set Fader' },
      { type: 'set-dca', label: 'Set DCA' },
      { type: 'fade-fader', label: 'Fade Fader' },
      { type: 'fade-dca', label: 'Fade DCA' },
      { type: 'mute', label: 'Mute' },
      { type: 'unmute', label: 'Unmute' },
      { type: 'recall-scene', label: 'Recall Scene' },
    ],
  },
  {
    category: 'Lighting',
    icon: '💡',
    color: '#F59E0B',
    commands: [
      { type: 'playback', label: 'Playback Level' },
      { type: 'playback-go', label: 'Playback Go' },
      { type: 'playback-jump', label: 'Playback Jump' },
    ],
  },
  {
    category: 'Cameras',
    icon: '🎥',
    color: '#14B8A6',
    commands: [
      { type: 'cam1-preset', label: 'Cam 1 Preset' },
      { type: 'cam1-zoom', label: 'Cam 1 Zoom' },
      { type: 'cam1-home', label: 'Cam 1 Home' },
      { type: 'cam2-preset', label: 'Cam 2 Preset' },
      { type: 'cam2-zoom', label: 'Cam 2 Zoom' },
      { type: 'cam2-home', label: 'Cam 2 Home' },
      { type: 'cam3-preset', label: 'Cam 3 Preset' },
      { type: 'cam3-zoom', label: 'Cam 3 Zoom' },
      { type: 'cam3-home', label: 'Cam 3 Home' },
    ],
  },
  {
    category: 'OBS',
    icon: '📺',
    color: '#A855F7',
    commands: [
      { type: 'obs-scene', label: 'OBS Scene' },
      { type: 'obs-preview', label: 'OBS Preview' },
      { type: 'obs-transition', label: 'OBS Transition' },
    ],
  },
  {
    category: 'Custom',
    icon: '⚡',
    color: '#64748B',
    commands: [
      { type: 'raw-osc', label: 'Raw OSC' },
    ],
  },
];
```

**Step 2: Create the CommandModal component**

Create `ui/src/components/CommandModal.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react';
import type { InlineOSC } from '../types';
import { getCommands, type CmdDef, type FieldDef } from './command-defs';

export interface CommandModalTarget {
  commandType: string;
  /** null = create new cue, string = add to existing cue */
  cueId: string | null;
}

interface CommandModalProps {
  target: CommandModalTarget;
  obsScenes?: string[];
  onSubmit: (target: CommandModalTarget, osc: InlineOSC, delay?: number) => void;
  onCancel: () => void;
}

export default function CommandModal({ target, obsScenes, onSubmit, onCancel }: CommandModalProps) {
  const commands = getCommands(obsScenes);
  const def = commands.find(c => c.type === target.commandType);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const firstInputRef = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    // Auto-focus first field
    setTimeout(() => firstInputRef.current?.focus(), 50);
  }, []);

  if (!def) {
    // No fields needed (e.g., obs-transition, cam home) — submit immediately
    const noFieldDef = commands.find(c => c.type === target.commandType);
    if (noFieldDef && noFieldDef.fields.length === 0) {
      const payload = noFieldDef.build({});
      if (payload) {
        // Use effect to avoid calling onSubmit during render
        setTimeout(() => onSubmit(target, payload, noFieldDef.delay), 0);
      }
      return null;
    }
    return null;
  }

  // If no fields, auto-submit
  if (def.fields.length === 0) {
    const payload = def.build({});
    if (payload) {
      setTimeout(() => onSubmit(target, payload, def.delay), 0);
    }
    return null;
  }

  const setField = (key: string, value: string) =>
    setVals(prev => ({ ...prev, [key]: value }));

  const handleSubmit = () => {
    const payload = def.build(vals);
    if (!payload) {
      setError('Please fill in all required fields with valid values.');
      return;
    }
    onSubmit(target, payload, def.delay);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') onCancel();
  };

  const renderField = (f: FieldDef, idx: number) => {
    if (f.type === 'select' && f.options) {
      return (
        <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>{f.placeholder}</label>
          <select
            ref={idx === 0 ? (el) => { firstInputRef.current = el; } : undefined}
            value={vals[f.key] ?? ''}
            onChange={(e) => setField(f.key, e.target.value)}
            onKeyDown={handleKeyDown}
            style={{
              width: '100%',
              background: '#020617',
              border: '1px solid #334155',
              borderRadius: 6,
              color: '#E2E8F0',
              padding: '8px 10px',
              fontSize: 13,
              outline: 'none',
            }}
          >
            <option value="">Select...</option>
            {f.options.map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );
    }

    return (
      <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>{f.placeholder}</label>
        <input
          ref={idx === 0 ? (el) => { firstInputRef.current = el; } : undefined}
          type={f.type}
          placeholder={f.placeholder}
          value={vals[f.key] ?? ''}
          onChange={(e) => setField(f.key, e.target.value)}
          onKeyDown={handleKeyDown}
          style={{
            width: '100%',
            background: '#020617',
            border: '1px solid #334155',
            borderRadius: 6,
            color: '#E2E8F0',
            padding: '8px 10px',
            fontSize: 13,
            fontFamily: "'JetBrains Mono', monospace",
            outline: 'none',
          }}
        />
      </div>
    );
  };

  return (
    <div
      onClick={onCancel}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#0F172A',
          border: '1px solid #334155',
          borderRadius: 14,
          padding: '24px 28px',
          minWidth: 320,
          maxWidth: 400,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 700, color: '#E2E8F0' }}>
          {def.label}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {def.fields.map((f, idx) => renderField(f, idx))}
        </div>
        {error && (
          <div style={{ fontSize: 12, color: '#EF4444' }}>{error}</div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 18px', borderRadius: 8,
              background: 'none', border: '1px solid #334155',
              color: '#94A3B8', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            style={{
              padding: '8px 18px', borderRadius: 8,
              background: '#3B82F6', border: 'none',
              color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Step 3: Run type check**

Run: `cd /Users/dave/projects/productionhub/ui && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add ui/src/components/command-defs.ts ui/src/components/CommandModal.tsx
git commit -m "feat: add CommandModal and shared command definitions"
```

---

### Task 6: UI — Replace CommandBuilder with CommandTiles in ActionPalette

**Files:**
- Modify: `ui/src/components/ActionPalette.tsx`

**Step 1: Replace CommandBuilder import and rendering with CommandTile categories**

Replace the entire `ActionPalette.tsx` content. The key changes:
- Remove `CommandBuilder` import, add `CommandTile` and `TILE_CATEGORIES` imports
- Replace the single "Custom Commands" collapsible section with per-category tile sections
- Each tile category renders CommandTile components

```tsx
import { useState } from 'react';
import type { ActionCategory } from '../types';
import DragTile from './DragTile';
import CommandTile from './CommandTile';
import { TILE_CATEGORIES } from './command-defs';

interface ActionPaletteProps {
  categories: ActionCategory[];
  onNewShow: () => void;
}

export default function ActionPalette({ categories, onNewShow }: ActionPaletteProps) {
  const [expandedCats, setExpandedCats] = useState<string[]>(
    [...categories.map(c => c.category), ...TILE_CATEGORIES.map(t => `__cmd_${t.category}`)]
  );

  if (categories.length > 0 && expandedCats.length <= TILE_CATEGORIES.length) {
    setExpandedCats([...categories.map(c => c.category), ...TILE_CATEGORIES.map(t => `__cmd_${t.category}`)]);
  }

  const toggleCat = (cat: string) =>
    setExpandedCats(prev =>
      prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
    );

  return (
    <div style={{
      width: 270, minWidth: 270,
      borderRight: '1px solid #1E293B',
      display: 'flex', flexDirection: 'column',
      background: '#020617',
    }}>
      <div style={{ padding: '16px 18px 12px', borderBottom: '1px solid #1E293B' }}>
        <div style={{
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.12em', color: '#475569',
        }}>
          Actions
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '6px 10px' }}>
        {/* Registry actions from backend */}
        {categories.map(cat => {
          const expanded = expandedCats.includes(cat.category);
          return (
            <div key={cat.category} style={{ marginBottom: 2 }}>
              <button
                onClick={() => toggleCat(cat.category)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '9px 8px',
                  background: 'none', border: 'none',
                  color: '#94A3B8', cursor: 'pointer',
                  fontSize: 12.5, fontWeight: 600, textAlign: 'left', borderRadius: 6,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#0F172A')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                <span style={{ fontSize: 15 }}>{cat.icon}</span>
                <span style={{ flex: 1 }}>{cat.category}</span>
                <span style={{
                  fontSize: 9, transition: 'transform 0.2s',
                  transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
                }}>▼</span>
              </button>
              {expanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '3px 0 6px' }}>
                  {cat.items.map(item => (
                    <DragTile key={item.id} item={item} color={cat.color} icon={cat.icon} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Divider between registry and command tiles */}
        {categories.length > 0 && (
          <div style={{ borderTop: '1px solid #1E293B', margin: '8px 0' }} />
        )}

        {/* Command tiles by category */}
        {TILE_CATEGORIES.map(tileCat => {
          const catKey = `__cmd_${tileCat.category}`;
          const expanded = expandedCats.includes(catKey);
          return (
            <div key={catKey} style={{ marginBottom: 2 }}>
              <button
                onClick={() => toggleCat(catKey)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  width: '100%', padding: '9px 8px',
                  background: 'none', border: 'none',
                  color: '#94A3B8', cursor: 'pointer',
                  fontSize: 12.5, fontWeight: 600, textAlign: 'left', borderRadius: 6,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = '#0F172A')}
                onMouseLeave={e => (e.currentTarget.style.background = 'none')}
              >
                <span style={{ fontSize: 15 }}>{tileCat.icon}</span>
                <span style={{ flex: 1 }}>{tileCat.category}</span>
                <span style={{
                  fontSize: 9, transition: 'transform 0.2s',
                  transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
                }}>▼</span>
              </button>
              {expanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '3px 0 6px' }}>
                  {tileCat.commands.map(cmd => (
                    <CommandTile
                      key={cmd.type}
                      def={{
                        type: cmd.type,
                        label: cmd.label,
                        icon: tileCat.icon,
                        color: tileCat.color,
                        category: tileCat.category,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ padding: '12px 14px', borderTop: '1px solid #1E293B' }}>
        <button
          onClick={onNewShow}
          style={{
            width: '100%', padding: '9px 0',
            background: '#0F172A', border: '1px solid #1E293B',
            borderRadius: 8, color: '#64748B', cursor: 'pointer',
            fontSize: 12.5, fontWeight: 600, transition: 'all 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = '#1E293B'; e.currentTarget.style.color = '#94A3B8'; }}
          onMouseLeave={e => { e.currentTarget.style.background = '#0F172A'; e.currentTarget.style.color = '#64748B'; }}
        >
          New Show
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Run type check**

Run: `cd /Users/dave/projects/productionhub/ui && npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add ui/src/components/ActionPalette.tsx
git commit -m "feat: replace CommandBuilder with CommandTile categories in sidebar"
```

---

### Task 7: UI — Wire Drop Handlers and Modal in App.tsx, CueStack, CueRow

**Files:**
- Modify: `ui/src/App.tsx`
- Modify: `ui/src/components/CueStack.tsx`
- Modify: `ui/src/components/CueRow.tsx`

**Step 1: Update CueStack drop handler**

In `CueStack.tsx`, add a new prop and update `onListDrop`:

Add to props interface:
```typescript
  onCommandDrop?: (commandType: string, cueId: string | null) => void;
```

Update `onListDrop` to detect `application/x-command-type` before checking `application/json`:

```typescript
  const onListDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    // Check for command type (new CommandTile drag)
    const cmdType = e.dataTransfer.getData('application/x-command-type');
    if (cmdType) {
      onCommandDrop?.(cmdType, null); // null = new cue
      return;
    }

    // Check for inline OSC (legacy CommandBuilder drag)
    const jsonData = e.dataTransfer.getData('application/json');
    // ... rest unchanged
```

Also pass `onCommandDrop` through to CueRow's `onDrop` callback. Update the CueRow render to add a new `onCommandTypeDrop` prop:

```typescript
  onCommandTypeDrop={onCommandDrop ? (cueId: string, cmdType: string) => onCommandDrop(cmdType, cueId) : undefined}
```

**Step 2: Update CueRow drop handler**

In `CueRow.tsx`, add a new prop:

```typescript
  onCommandTypeDrop?: (cueId: string, commandType: string) => void;
```

Update the `onDrop` handler in the actions area to check for command type first:

```typescript
  // Check for command type (CommandTile drag)
  const cmdType = e.dataTransfer.getData('application/x-command-type');
  if (cmdType) {
    onCommandTypeDrop?.(cue.id, cmdType);
    return;
  }
```

**Step 3: Wire modal state in App.tsx**

Add state and imports at the top of App.tsx:

```typescript
import CommandModal, { type CommandModalTarget } from './components/CommandModal';
```

Add state:
```typescript
const [modalTarget, setModalTarget] = useState<CommandModalTarget | null>(null);
```

Add handler:
```typescript
const handleCommandDrop = (commandType: string, cueId: string | null) => {
  setModalTarget({ commandType, cueId });
};

const handleModalSubmit = (target: CommandModalTarget, osc: InlineOSC, delay?: number) => {
  const actionId = `inline:${target.commandType}:${Date.now()}`;
  if (target.cueId) {
    send({ type: 'add-action-to-cue', cueId: target.cueId, actionId, osc, ...(delay ? { delay } : {}) });
  } else {
    send({ type: 'add-cue', cue: { name: osc.label, actions: [{ actionId, osc, ...(delay ? { delay } : {}) }] } });
  }
  setModalTarget(null);
};
```

Pass `onCommandDrop` to CueStack:
```typescript
<CueStack show={show} categories={categories} send={send} onCommandDrop={handleCommandDrop} />
```

Render the modal at the bottom of the component, passing OBS scenes:
```typescript
{modalTarget && (
  <CommandModal
    target={modalTarget}
    obsScenes={deviceStates.obs?.scenes}
    onSubmit={handleModalSubmit}
    onCancel={() => setModalTarget(null)}
  />
)}
```

**Step 4: Run type check**

Run: `cd /Users/dave/projects/productionhub/ui && npx tsc --noEmit`
Expected: No errors

**Step 5: Manual test**

Run: `cd /Users/dave/projects/productionhub && npm run dev:emulate` and `cd /Users/dave/projects/productionhub/ui && npm run dev`

Verify:
- Sidebar shows command tiles grouped by category (Audio, Lighting, Cameras, OBS, Custom)
- Dragging a tile to the cue stack opens a modal
- Filling in parameters and clicking Add creates the cue
- Pressing Enter submits, Escape cancels
- OBS Scene/Preview shows a dropdown of scene names if OBS is connected
- Registry actions (DragTile) still work without modal (direct drop)
- No-field commands (Cam Home, OBS Transition) create cues immediately without modal

**Step 6: Commit**

```bash
git add ui/src/App.tsx ui/src/components/CueStack.tsx ui/src/components/CueRow.tsx
git commit -m "feat: wire command drop handlers and modal dialog in MOD UI"
```

---

### Task 8: Clean Up — Remove Old CommandBuilder

**Files:**
- Delete: `ui/src/components/CommandBuilder.tsx` (no longer imported)

**Step 1: Verify CommandBuilder is not imported anywhere**

Run: `grep -r "CommandBuilder" ui/src/`
Expected: No results (ActionPalette.tsx no longer imports it)

**Step 2: Delete the file**

```bash
rm ui/src/components/CommandBuilder.tsx
```

**Step 3: Run type check**

Run: `cd /Users/dave/projects/productionhub/ui && npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add -u ui/src/components/CommandBuilder.tsx
git commit -m "chore: remove old CommandBuilder component"
```
