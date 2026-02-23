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
  options?: string[];
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
        return { address: `/avantis/ch/${ch}/mix/fader`, args: [val], label: `Fader ${ch} \u2192 ${Math.round(val * 100)}%` };
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
        return { address: `/avantis/dca/${n}/fader`, args: [val], label: `DCA ${n} \u2192 ${Math.round(val * 100)}%` };
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
        return { address: `/avantis/ch/${ch}/mix/fade`, args: [val, dur], label: `Fade Ch ${ch} \u2192 ${Math.round(val * 100)}% (${dur}s)` };
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
        return { address: `/avantis/dca/${n}/fade`, args: [val, dur], label: `Fade DCA ${n} \u2192 ${Math.round(val * 100)}% (${dur}s)` };
      },
    },
    {
      type: 'mute',
      label: 'Mute',
      fields: [{ key: 'ch', placeholder: 'Channel', type: 'number', width: 80 }],
      build: (v) => {
        const ch = parseInt(v.ch, 10);
        if (isNaN(ch) || ch < 1) return null;
        return { address: `/avantis/ch/${ch}/mix/mute`, args: [1], label: `Mute Ch ${ch}` };
      },
    },
    {
      type: 'unmute',
      label: 'Unmute',
      fields: [{ key: 'ch', placeholder: 'Channel', type: 'number', width: 80 }],
      build: (v) => {
        const ch = parseInt(v.ch, 10);
        if (isNaN(ch) || ch < 1) return null;
        return { address: `/avantis/ch/${ch}/mix/mute`, args: [0], label: `Unmute Ch ${ch}` };
      },
    },
    {
      type: 'recall-scene',
      label: 'Recall Scene',
      fields: [{ key: 'n', placeholder: 'Scene #', type: 'number', width: 80 }],
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
        return { address: `/lights/pb/${n}`, args: [val], label: `PB ${n} \u2192 ${Math.round(val * 100)}%` };
      },
    },
    {
      type: 'playback-go',
      label: 'Playback Go',
      fields: [{ key: 'n', placeholder: 'PB #', type: 'number', width: 80 }],
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
        return { address: `/lights/pb/${pb}/go`, args: [1, cue], label: `PB ${pb} \u2192 Cue ${cue}` };
      },
    },
    ...([1, 2, 3] as const).flatMap((cam): CmdDef[] => [
      {
        type: `cam${cam}-preset` as CmdType,
        label: `Cam ${cam} Preset`,
        fields: [{ key: 'n', placeholder: 'Preset #', type: 'number' as const, width: 80 }],
        build: (v) => {
          const n = parseInt(v.n, 10);
          if (isNaN(n) || n < 1) return null;
          return { address: `/cam${cam}/preset/recall/${n}`, args: [], label: `C${cam} Preset ${n}` };
        },
      },
      {
        type: `cam${cam}-zoom` as CmdType,
        label: `Cam ${cam} Zoom`,
        fields: [{ key: 'val', placeholder: 'Level (0-100)', type: 'number' as const, width: 100 }],
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
        return { address: `/obs/scene/${v.name.trim()}`, args: [], label: `OBS \u2192 ${v.name.trim()}` };
      },
    },
    {
      type: 'obs-preview',
      label: 'OBS Preview',
      fields: [sceneField('name', 'Scene')],
      build: (v) => {
        if (!v.name?.trim()) return null;
        return { address: `/obs/scene/preview/${v.name.trim()}`, args: [], label: `OBS PVW \u2192 ${v.name.trim()}` };
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

export interface TileCategory {
  category: string;
  icon: string;
  color: string;
  commands: { type: CmdType; label: string }[];
}

export const TILE_CATEGORIES: TileCategory[] = [
  {
    category: 'Audio',
    icon: '\uD83C\uDFA4',
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
    icon: '\uD83D\uDCA1',
    color: '#F59E0B',
    commands: [
      { type: 'playback', label: 'Playback Level' },
      { type: 'playback-go', label: 'Playback Go' },
      { type: 'playback-jump', label: 'Playback Jump' },
    ],
  },
  {
    category: 'Cameras',
    icon: '\uD83C\uDFA5',
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
    icon: '\uD83D\uDCFA',
    color: '#A855F7',
    commands: [
      { type: 'obs-scene', label: 'OBS Scene' },
      { type: 'obs-preview', label: 'OBS Preview' },
      { type: 'obs-transition', label: 'OBS Transition' },
    ],
  },
  {
    category: 'Custom',
    icon: '\u26A1',
    color: '#64748B',
    commands: [
      { type: 'raw-osc', label: 'Raw OSC' },
    ],
  },
];
