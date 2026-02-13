/**
 * Configuration loader
 *
 * Reads a YAML config file with OSC and device settings.
 * Supports both the legacy single-device format and the new multi-device format.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { DeviceConfig } from './drivers/device-driver';
import { ProbeTarget } from './systems-check';

// --- Legacy Config (backward compat with single-Avantis setups) ---

export interface LegacyConfig {
  osc: {
    listenAddress: string;
    listenPort: number;
    replyPort?: number;
  };
  midi: {
    host: string;
    port: number;
    baseChannel: number;
  };
  feedback?: {
    enabled: boolean;
    echoSuppressionMs: number;
  };
  logging?: {
    verbose: boolean;
  };
}

// --- Hub Config (multi-device) ---

export interface HubDeviceEntry {
  type: string;     // "avantis" | "chamsys" | "obs" | "visca"
  prefix: string;   // "/avantis", "/lights", "/cam1", "/obs"
  host: string;
  port: number;
  [key: string]: any;
}

export interface HubFileConfig {
  osc: {
    listenAddress: string;
    listenPort: number;
    replyPort?: number;
  };
  devices: HubDeviceEntry[];
  health?: {
    enabled: boolean;
    port: number;
  };
  logging?: {
    verbose: boolean;
  };
}

/** Runtime config used by ProductionHub */
export interface Config {
  osc: {
    listenAddress: string;
    listenPort: number;
    replyPort?: number;
  };
  devices: DeviceConfig[];
  health?: {
    enabled: boolean;
    port: number;
  };
  logging?: {
    verbose: boolean;
  };
  systemsCheck?: {
    externalTargets: ProbeTarget[];
  };
  checklist?: string[];
  ui?: {
    enabled: boolean;
    port: number;
  };
  macros?: Array<{
    address: string;
    name: string;
    actions: Array<{
      address: string;
      args?: (number | string)[];
      delayMs?: number;
    }>;
  }>;
}

// --- Defaults ---

const DEFAULT_OSC = {
  listenAddress: '0.0.0.0',
  listenPort: 9000,
};

/**
 * Load and normalize config from YAML.
 * Auto-detects legacy (single midi: block) vs hub (devices: array) format.
 */
export function loadConfig(configPath?: string): Config {
  const resolvedPath = configPath ?? path.join(process.cwd(), 'config.yml');

  if (!fs.existsSync(resolvedPath)) {
    console.log(`[Config] No config file found at ${resolvedPath}, using defaults`);
    return {
      osc: DEFAULT_OSC,
      devices: [{
        type: 'avantis',
        prefix: '/avantis',
        host: '192.168.1.70',
        port: 51325,
        midiBaseChannel: 12,
        feedback: { enabled: true, echoSuppressionMs: 100 },
      }],
      logging: { verbose: false },
    };
  }

  const raw = fs.readFileSync(resolvedPath, 'utf-8');
  const parsed = parse(raw) as any;

  // Detect format: does it have a 'devices' array?
  if (parsed.devices && Array.isArray(parsed.devices)) {
    return loadHubConfig(parsed);
  } else if (parsed.midi) {
    return loadLegacyConfig(parsed);
  } else {
    throw new Error('[Config] Invalid config: must have either "devices" array or "midi" section');
  }
}

/** Load new multi-device format */
function loadHubConfig(parsed: any): Config {
  const devices: DeviceConfig[] = parsed.devices.map((d: any) => {
    if (!d.type) throw new Error(`[Config] Device missing "type" field`);
    if (!d.prefix) throw new Error(`[Config] Device "${d.type}" missing "prefix" field`);
    if (!d.host) throw new Error(`[Config] Device "${d.type}" missing "host" field`);
    if (!d.port) throw new Error(`[Config] Device "${d.type}" missing "port" field`);

    // Normalize prefix: ensure leading slash, no trailing slash
    let prefix = d.prefix;
    if (!prefix.startsWith('/')) prefix = '/' + prefix;
    prefix = prefix.replace(/\/$/, '');

    return { ...d, prefix };
  });

  const config: Config = {
    osc: {
      listenAddress: parsed.osc?.listenAddress ?? DEFAULT_OSC.listenAddress,
      listenPort: parsed.osc?.listenPort ?? DEFAULT_OSC.listenPort,
      replyPort: parsed.osc?.replyPort,
    },
    devices,
    health: parsed.health ? {
      enabled: parsed.health.enabled ?? true,
      port: parsed.health.port ?? 8080,
    } : undefined,
    logging: {
      verbose: parsed.logging?.verbose ?? false,
    },
    systemsCheck: parsed.systemsCheck ? {
      externalTargets: (parsed.systemsCheck.externalTargets ?? []).map((t: any) => ({
        name: t.name ?? `${t.host}:${t.port}`,
        host: t.host,
        port: t.port,
        protocol: t.protocol ?? 'tcp',
      })),
    } : undefined,
    checklist: parsed.checklist && Array.isArray(parsed.checklist)
      ? parsed.checklist.map((item: any) => String(item))
      : undefined,
    ui: parsed.ui ? {
      enabled: parsed.ui.enabled ?? false,
      port: parsed.ui.port ?? 3001,
    } : undefined,
    macros: parsed.macros && Array.isArray(parsed.macros)
      ? parsed.macros.map((m: any) => ({
          address: m.address,
          name: m.name ?? m.address,
          actions: (m.actions ?? []).map((a: any) => ({
            address: a.address,
            args: Array.isArray(a.args) ? a.args : undefined,
            delayMs: a.delayMs ?? undefined,
          })),
        }))
      : undefined,
  };

  console.log(`[Config] Hub mode: ${devices.length} device(s) configured`);
  return config;
}

/** Load legacy single-Avantis format and convert to hub format */
function loadLegacyConfig(parsed: any): Config {
  const midi = parsed.midi ?? {};
  const feedback = parsed.feedback ?? {};

  const baseChannel = midi.baseChannel ?? 12;
  if (baseChannel < 1 || baseChannel > 16) {
    throw new Error(`midi.baseChannel must be 1-16, got ${baseChannel}`);
  }

  const avantisDevice: DeviceConfig = {
    type: 'avantis',
    prefix: '/avantis',
    host: midi.host ?? '192.168.1.70',
    port: midi.port ?? 51325,
    midiBaseChannel: baseChannel,
    feedback: {
      enabled: feedback.enabled ?? true,
      echoSuppressionMs: feedback.echoSuppressionMs ?? 100,
    },
  };

  const config: Config = {
    osc: {
      listenAddress: parsed.osc?.listenAddress ?? DEFAULT_OSC.listenAddress,
      listenPort: parsed.osc?.listenPort ?? DEFAULT_OSC.listenPort,
      replyPort: parsed.osc?.replyPort,
    },
    devices: [avantisDevice],
    logging: {
      verbose: parsed.logging?.verbose ?? false,
    },
  };

  console.log('[Config] Legacy mode: single Avantis device');
  return config;
}
