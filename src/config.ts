/**
 * Configuration loader
 *
 * Reads a YAML config file with OSC and MIDI settings.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

export interface Config {
  osc: {
    listenAddress: string;
    listenPort: number;
    replyPort?: number; // Port to send feedback to on clients (default: same as client source port)
  };
  midi: {
    host: string;
    port: number;
    baseChannel: number; // 1-indexed (1-16), default 12
  };
  feedback?: {
    enabled: boolean;          // Send MIDI→OSC feedback to clients (default: true)
    echoSuppressionMs: number; // Ignore desk echoes within this window after sending (default: 100)
  };
  logging?: {
    verbose: boolean;
  };
}

const DEFAULT_CONFIG: Config = {
  osc: {
    listenAddress: '0.0.0.0',
    listenPort: 9000,
  },
  midi: {
    host: '192.168.1.70',
    port: 51325,
    baseChannel: 12,
  },
  feedback: {
    enabled: true,
    echoSuppressionMs: 100,
  },
  logging: {
    verbose: false,
  },
};

export function loadConfig(configPath?: string): Config {
  const resolvedPath = configPath ?? path.join(process.cwd(), 'config.yml');

  if (!fs.existsSync(resolvedPath)) {
    console.log(`[Config] No config file found at ${resolvedPath}, using defaults`);
    return DEFAULT_CONFIG;
  }

  const raw = fs.readFileSync(resolvedPath, 'utf-8');
  const parsed = parse(raw) as Partial<Config>;

  const config: Config = {
    osc: {
      listenAddress: parsed.osc?.listenAddress ?? DEFAULT_CONFIG.osc.listenAddress,
      listenPort: parsed.osc?.listenPort ?? DEFAULT_CONFIG.osc.listenPort,
      replyPort: (parsed as any).osc?.replyPort,
    },
    midi: {
      host: parsed.midi?.host ?? DEFAULT_CONFIG.midi.host,
      port: parsed.midi?.port ?? DEFAULT_CONFIG.midi.port,
      baseChannel: parsed.midi?.baseChannel ?? DEFAULT_CONFIG.midi.baseChannel,
    },
    feedback: {
      enabled: (parsed as any).feedback?.enabled ?? DEFAULT_CONFIG.feedback!.enabled,
      echoSuppressionMs: (parsed as any).feedback?.echoSuppressionMs ?? DEFAULT_CONFIG.feedback!.echoSuppressionMs,
    },
    logging: {
      verbose: parsed.logging?.verbose ?? DEFAULT_CONFIG.logging!.verbose,
    },
  };

  // Validate
  if (config.midi.baseChannel < 1 || config.midi.baseChannel > 16) {
    throw new Error(`midi.baseChannel must be 1-16, got ${config.midi.baseChannel}`);
  }

  console.log(`[Config] Loaded from ${resolvedPath}`);
  return config;
}
