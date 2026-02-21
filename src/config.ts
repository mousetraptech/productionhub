/**
 * Configuration loader
 *
 * Reads a YAML config file with OSC and device settings.
 * Supports both the legacy single-device format and the new multi-device format.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { ZodError } from 'zod';
import { DeviceConfig } from './drivers/device-driver';
import { ProbeTarget } from './systems-check';
import { validateHubConfig, validateLegacyConfig, formatZodError } from './config-schema';

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
  brain?: {
    enabled: boolean;
    model: string;
    mode: 'confirm' | 'trusted';
    manualPath?: string;
  };
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
        midiBaseChannel: 1,
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
  // Validate with Zod schema
  let validated;
  try {
    validated = validateHubConfig(parsed);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`[Config] Validation failed:\n${formatZodError(error)}`);
    }
    throw error;
  }

  // Normalize prefixes and build device configs
  const devices: DeviceConfig[] = validated.devices.map((d) => {
    let prefix = d.prefix;
    if (!prefix.startsWith('/')) prefix = '/' + prefix;
    prefix = prefix.replace(/\/$/, '');
    return { ...d, prefix } as DeviceConfig;
  });

  const config: Config = {
    osc: {
      listenAddress: validated.osc?.listenAddress ?? DEFAULT_OSC.listenAddress,
      listenPort: validated.osc?.listenPort ?? DEFAULT_OSC.listenPort,
      replyPort: validated.osc?.replyPort,
    },
    devices,
    health: validated.health ? {
      enabled: validated.health.enabled,
      port: validated.health.port,
    } : undefined,
    logging: {
      verbose: validated.logging?.verbose ?? false,
    },
    systemsCheck: validated.systemsCheck ? {
      externalTargets: validated.systemsCheck.externalTargets.map((t) => ({
        name: t.name ?? `${t.host}:${t.port}`,
        host: t.host,
        port: t.port,
        protocol: t.protocol,
      })),
    } : undefined,
    checklist: validated.checklist,
    ui: validated.ui ? {
      enabled: validated.ui.enabled,
      port: validated.ui.port,
    } : undefined,
    macros: validated.macros?.map((m) => ({
      address: m.address,
      name: m.name ?? m.address,
      actions: m.actions.map((a) => ({
        address: a.address,
        args: a.args,
        delayMs: a.delayMs,
      })),
    })),
    brain: parsed.brain ? {
      enabled: parsed.brain.enabled ?? false,
      model: parsed.brain.model ?? 'claude-sonnet-4-5-20250929',
      mode: parsed.brain.mode ?? 'confirm',
      manualPath: parsed.brain.manualPath,
    } : undefined,
  };

  console.log(`[Config] Hub mode: ${devices.length} device(s) configured`);
  return config;
}

/** Load legacy single-Avantis format and convert to hub format */
function loadLegacyConfig(parsed: any): Config {
  // Validate with Zod schema
  let validated;
  try {
    validated = validateLegacyConfig(parsed);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Error(`[Config] Validation failed:\n${formatZodError(error)}`);
    }
    throw error;
  }

  const avantisDevice: DeviceConfig = {
    type: 'avantis',
    prefix: '/avantis',
    host: validated.midi.host,
    port: validated.midi.port,
    midiBaseChannel: validated.midi.baseChannel,
    feedback: {
      enabled: validated.feedback?.enabled ?? true,
      echoSuppressionMs: validated.feedback?.echoSuppressionMs ?? 100,
    },
  };

  const config: Config = {
    osc: {
      listenAddress: validated.osc?.listenAddress ?? DEFAULT_OSC.listenAddress,
      listenPort: validated.osc?.listenPort ?? DEFAULT_OSC.listenPort,
      replyPort: validated.osc?.replyPort,
    },
    devices: [avantisDevice],
    logging: {
      verbose: validated.logging?.verbose ?? false,
    },
  };

  console.log('[Config] Legacy mode: single Avantis device');
  return config;
}
