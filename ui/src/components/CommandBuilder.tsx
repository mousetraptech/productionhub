import { useState } from 'react';
import type { InlineOSC } from '../types';

/**
 * Builds an inline OSC drag payload from a command type + parameters.
 * Returns the InlineOSC blob that gets attached to the CueAction.
 */

type CmdType =
  | 'set-fader'
  | 'set-dca'
  | 'fade-fader'
  | 'mute'
  | 'unmute'
  | 'recall-scene'
  | 'playback'
  | 'playback-go'
  | 'playback-jump'
  | 'cam-preset'
  | 'obs-scene'
  | 'obs-preview'
  | 'obs-transition'
  | 'raw-osc';

interface CmdDef {
  type: CmdType;
  label: string;
  fields: FieldDef[];
  delay?: number;
  build: (vals: Record<string, string>) => InlineOSC | null;
}

interface FieldDef {
  key: string;
  placeholder: string;
  type: 'number' | 'text';
  width?: number;
}

function normFader(raw: string): number {
  const v = parseFloat(raw);
  if (isNaN(v)) return 0;
  if (v > 1) return Math.min(v / 100, 1);
  return Math.max(0, Math.min(v, 1));
}

const COMMANDS: CmdDef[] = [
  {
    type: 'set-fader',
    label: 'Set Fader',
    fields: [
      { key: 'ch', placeholder: 'Ch', type: 'number', width: 48 },
      { key: 'val', placeholder: 'Level', type: 'number', width: 56 },
    ],
    build: (v) => {
      const ch = parseInt(v.ch, 10);
      const val = normFader(v.val);
      if (isNaN(ch) || ch < 1) return null;
      return {
        address: `/avantis/ch/${ch}/mix/fader`,
        args: [val],
        label: `Fader ${ch} → ${Math.round(val * 100)}%`,
      };
    },
  },
  {
    type: 'set-dca',
    label: 'Set DCA',
    fields: [
      { key: 'n', placeholder: 'DCA', type: 'number', width: 48 },
      { key: 'val', placeholder: 'Level', type: 'number', width: 56 },
    ],
    build: (v) => {
      const n = parseInt(v.n, 10);
      const val = normFader(v.val);
      if (isNaN(n) || n < 1) return null;
      return {
        address: `/avantis/dca/${n}/fader`,
        args: [val],
        label: `DCA ${n} → ${Math.round(val * 100)}%`,
      };
    },
  },
  {
    type: 'fade-fader',
    label: 'Fade Fader',
    fields: [
      { key: 'ch', placeholder: 'Ch', type: 'number', width: 48 },
      { key: 'val', placeholder: 'Target', type: 'number', width: 56 },
      { key: 'dur', placeholder: 'Sec', type: 'number', width: 48 },
    ],
    build: (v) => {
      const ch = parseInt(v.ch, 10);
      const val = normFader(v.val);
      const dur = parseFloat(v.dur);
      if (isNaN(ch) || ch < 1 || isNaN(dur) || dur <= 0) return null;
      return {
        address: `/avantis/ch/${ch}/mix/fade`,
        args: [val, dur],
        label: `Fade Ch ${ch} → ${Math.round(val * 100)}% (${dur}s)`,
      };
    },
  },
  {
    type: 'mute',
    label: 'Mute',
    fields: [
      { key: 'ch', placeholder: 'Ch', type: 'number', width: 48 },
    ],
    build: (v) => {
      const ch = parseInt(v.ch, 10);
      if (isNaN(ch) || ch < 1) return null;
      return {
        address: `/avantis/ch/${ch}/mix/mute`,
        args: [1],
        label: `Mute Ch ${ch}`,
      };
    },
  },
  {
    type: 'unmute',
    label: 'Unmute',
    fields: [
      { key: 'ch', placeholder: 'Ch', type: 'number', width: 48 },
    ],
    build: (v) => {
      const ch = parseInt(v.ch, 10);
      if (isNaN(ch) || ch < 1) return null;
      return {
        address: `/avantis/ch/${ch}/mix/mute`,
        args: [0],
        label: `Unmute Ch ${ch}`,
      };
    },
  },
  {
    type: 'recall-scene',
    label: 'Recall Scene',
    fields: [
      { key: 'n', placeholder: '#', type: 'number', width: 48 },
    ],
    build: (v) => {
      const n = parseInt(v.n, 10);
      if (isNaN(n) || n < 0) return null;
      return {
        address: '/avantis/scene/recall',
        args: [n],
        label: `Scene ${n}`,
      };
    },
  },
  {
    type: 'playback',
    label: 'Playback',
    fields: [
      { key: 'n', placeholder: 'PB', type: 'number', width: 48 },
      { key: 'val', placeholder: 'Level', type: 'number', width: 56 },
    ],
    build: (v) => {
      const n = parseInt(v.n, 10);
      const val = normFader(v.val);
      if (isNaN(n) || n < 1) return null;
      return {
        address: `/lights/pb/${n}`,
        args: [val],
        label: `PB ${n} → ${Math.round(val * 100)}%`,
      };
    },
  },
  {
    type: 'playback-go',
    label: 'PB Go',
    fields: [
      { key: 'n', placeholder: 'PB', type: 'number', width: 48 },
    ],
    build: (v) => {
      const n = parseInt(v.n, 10);
      if (isNaN(n) || n < 1) return null;
      return {
        address: `/lights/pb/${n}/1`,
        args: [],
        label: `PB ${n} GO`,
      };
    },
  },
  {
    type: 'playback-jump',
    label: 'PB Jump',
    fields: [
      { key: 'pb', placeholder: 'PB', type: 'number', width: 48 },
      { key: 'cue', placeholder: 'Cue', type: 'number', width: 56 },
    ],
    build: (v) => {
      const pb = parseInt(v.pb, 10);
      const cue = parseInt(v.cue, 10);
      if (isNaN(pb) || pb < 1 || isNaN(cue) || cue < 1) return null;
      return {
        address: `/lights/pb/${pb}/go`,
        args: [1, cue],
        label: `PB ${pb} → Cue ${cue}`,
      };
    },
  },
  {
    type: 'cam-preset',
    label: 'Cam Preset',
    fields: [
      { key: 'n', placeholder: '#', type: 'number', width: 48 },
    ],
    build: (v) => {
      const n = parseInt(v.n, 10);
      if (isNaN(n) || n < 1) return null;
      return {
        address: `/cam1/preset/recall/${n}`,
        args: [],
        label: `Cam Preset ${n}`,
      };
    },
  },
  {
    type: 'obs-scene',
    label: 'OBS Scene',
    fields: [
      { key: 'name', placeholder: 'Scene', type: 'text', width: 90 },
    ],
    build: (v) => {
      if (!v.name?.trim()) return null;
      return {
        address: `/obs/scene/${v.name.trim()}`,
        args: [],
        label: `OBS → ${v.name.trim()}`,
      };
    },
  },
  {
    type: 'obs-preview',
    label: 'OBS Preview',
    fields: [
      { key: 'name', placeholder: 'Scene', type: 'text', width: 90 },
    ],
    build: (v) => {
      if (!v.name?.trim()) return null;
      return {
        address: `/obs/scene/preview/${v.name.trim()}`,
        args: [],
        label: `OBS PVW → ${v.name.trim()}`,
      };
    },
  },
  {
    type: 'obs-transition',
    label: 'OBS Transition',
    fields: [],
    delay: 100,
    build: () => {
      return {
        address: '/obs/transition/trigger',
        args: [],
        label: 'OBS Transition',
      };
    },
  },
  {
    type: 'raw-osc',
    label: 'Raw OSC',
    fields: [
      { key: 'addr', placeholder: '/address', type: 'text', width: 100 },
      { key: 'args', placeholder: 'args', type: 'text', width: 60 },
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

const BUILDER_COLOR = '#64748B';
const BUILDER_ICON = '⚡';

interface BuilderRowProps {
  def: CmdDef;
}

function BuilderRow({ def }: BuilderRowProps) {
  const [vals, setVals] = useState<Record<string, string>>({});

  const setField = (key: string, value: string) =>
    setVals(prev => ({ ...prev, [key]: value }));

  const payload = def.build(vals);

  return (
    <div
      draggable={!!payload}
      onDragStart={(e) => {
        if (!payload) { e.preventDefault(); return; }
        const data = JSON.stringify({
          actionId: `inline:${def.type}:${Date.now()}`,
          osc: payload,
          ...(def.delay ? { delay: def.delay } : {}),
        });
        e.dataTransfer.setData('application/json', data);
        e.dataTransfer.setData('text/plain', ''); // prevent default text drag
        e.dataTransfer.effectAllowed = 'copy';
      }}
      style={{
        padding: '8px 10px',
        background: payload ? BUILDER_COLOR + '18' : '#0F172A',
        border: `1.5px solid ${payload ? BUILDER_COLOR + '55' : '#1E293B'}`,
        borderRadius: 10,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        cursor: payload ? 'grab' : 'default',
        transition: 'all 0.15s ease',
        userSelect: 'none',
        opacity: payload ? 1 : 0.6,
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1, flexShrink: 0 }}>{BUILDER_ICON}</span>
      <span style={{
        fontSize: 11.5, fontWeight: 600, color: '#94A3B8',
        minWidth: 64, flexShrink: 0,
      }}>
        {def.label}
      </span>
      <div style={{ display: 'flex', gap: 4, flex: 1 }}>
        {def.fields.map(f => (
          <input
            key={f.key}
            type={f.type}
            placeholder={f.placeholder}
            value={vals[f.key] ?? ''}
            onChange={(e) => setField(f.key, e.target.value)}
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              width: f.width ?? 56,
              background: '#020617',
              border: '1px solid #1E293B',
              borderRadius: 5,
              color: '#E2E8F0',
              padding: '4px 6px',
              fontSize: 12,
              fontFamily: "'JetBrains Mono', monospace",
              outline: 'none',
            }}
          />
        ))}
      </div>
      {payload && (
        <span style={{
          fontSize: 10, color: '#475569', fontStyle: 'italic',
          maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          drag →
        </span>
      )}
    </div>
  );
}

export default function CommandBuilder() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {COMMANDS.map(def => (
        <BuilderRow key={def.type} def={def} />
      ))}
    </div>
  );
}
