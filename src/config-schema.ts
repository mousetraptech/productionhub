/**
 * Config Schema Validation
 *
 * Zod schemas for validating Production Hub configuration.
 * Provides comprehensive validation with clear error messages.
 */

import { z } from 'zod';

// --- Reusable Validators ---

const portSchema = z.number().int().min(1).max(65535);

const hostSchema = z.string().min(1).refine(
  (val) => {
    // Accept IP addresses, hostnames, and special values
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
    const hostname = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
    return val === 'localhost' || val === '0.0.0.0' || ipv4.test(val) || hostname.test(val);
  },
  { message: 'Invalid host: must be IP address or hostname' }
);

const prefixSchema = z.string().refine(
  (val) => /^\/[a-zA-Z0-9_-]+$/.test(val) || /^[a-zA-Z0-9_-]+$/.test(val),
  { message: 'Prefix must contain only alphanumeric characters, underscores, or hyphens' }
);

// --- Device Type Enum ---

const deviceTypeSchema = z.enum(['avantis', 'chamsys', 'obs', 'visca', 'touchdesigner', 'qlab']);

// --- Reconnect & Heartbeat Configs ---

const reconnectConfigSchema = z.object({
  maxAttempts: z.number().int().min(0).optional(),
  delayMs: z.number().int().min(100).optional(),
}).optional();

const heartbeatConfigSchema = z.object({
  enabled: z.boolean().optional(),
  intervalMs: z.number().int().min(1000).optional(),
  timeoutMs: z.number().int().min(1000).optional(),
}).optional();

// --- Base Device Schema ---

const baseDeviceSchema = z.object({
  type: deviceTypeSchema,
  prefix: prefixSchema,
  host: hostSchema,
  port: portSchema,
  name: z.string().optional(),
  emulate: z.boolean().optional(),
  reconnect: reconnectConfigSchema,
  heartbeat: heartbeatConfigSchema,
});

// --- Device-Specific Schemas ---

const avantisDeviceSchema = baseDeviceSchema.extend({
  type: z.literal('avantis'),
  midiBaseChannel: z.number().int().min(1).max(16).optional(),
  feedback: z.object({
    enabled: z.boolean().optional(),
    echoSuppressionMs: z.number().int().min(0).optional(),
  }).optional(),
});

const chamsysDeviceSchema = baseDeviceSchema.extend({
  type: z.literal('chamsys'),
});

const obsDeviceSchema = baseDeviceSchema.extend({
  type: z.literal('obs'),
  password: z.string().optional(),
});

const viscaDeviceSchema = baseDeviceSchema.extend({
  type: z.literal('visca'),
  cameraAddress: z.number().int().min(1).max(7).optional(),
});

const touchdesignerDeviceSchema = baseDeviceSchema.extend({
  type: z.literal('touchdesigner'),
});

const qlabDeviceSchema = baseDeviceSchema.extend({
  type: z.literal('qlab'),
  passcode: z.string().optional().default(''),
});

// --- Discriminated Union for Devices ---

const deviceSchema = z.discriminatedUnion('type', [
  avantisDeviceSchema,
  chamsysDeviceSchema,
  obsDeviceSchema,
  viscaDeviceSchema,
  touchdesignerDeviceSchema,
  qlabDeviceSchema,
]);

// --- OSC Config ---

const oscConfigSchema = z.object({
  listenAddress: hostSchema.default('0.0.0.0'),
  listenPort: portSchema.default(9000),
  replyPort: portSchema.optional(),
});

// --- Health Config ---

const healthConfigSchema = z.object({
  enabled: z.boolean().default(true),
  port: portSchema.default(8080),
});

// --- Logging Config ---

const loggingConfigSchema = z.object({
  verbose: z.boolean().default(false),
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error']).optional(),
  pretty: z.boolean().optional(),
});

// --- Probe Target (Systems Check) ---

const probeTargetSchema = z.object({
  name: z.string().optional(),
  host: hostSchema,
  port: portSchema,
  protocol: z.enum(['tcp', 'udp']).default('tcp'),
});

const systemsCheckConfigSchema = z.object({
  externalTargets: z.array(probeTargetSchema).default([]),
});

// --- UI Config ---

const uiConfigSchema = z.object({
  enabled: z.boolean().default(false),
  port: portSchema.default(3001),
});

// --- Macro Definitions ---

const macroActionSchema = z.object({
  address: z.string().startsWith('/'),
  args: z.array(z.union([z.number(), z.string()])).optional(),
  delayMs: z.number().int().min(0).optional(),
});

const macroDefSchema = z.object({
  address: z.string().startsWith('/'),
  name: z.string().optional(),
  actions: z.array(macroActionSchema),
});

// --- Full Hub Config Schema ---

export const hubConfigSchema = z.object({
  osc: oscConfigSchema.optional(),
  devices: z.array(deviceSchema).min(1),
  health: healthConfigSchema.optional(),
  logging: loggingConfigSchema.optional(),
  systemsCheck: systemsCheckConfigSchema.optional(),
  checklist: z.array(z.string()).optional(),
  ui: uiConfigSchema.optional(),
  macros: z.array(macroDefSchema).optional(),
}).refine(
  (config) => {
    // Check for duplicate prefixes (case-insensitive)
    const prefixes = config.devices.map(d => {
      let p = d.prefix;
      if (!p.startsWith('/')) p = '/' + p;
      return p.toLowerCase();
    });
    return new Set(prefixes).size === prefixes.length;
  },
  { message: 'Duplicate device prefix detected' }
);

// --- Legacy Config Schema (single Avantis) ---

export const legacyConfigSchema = z.object({
  osc: oscConfigSchema.optional(),
  midi: z.object({
    host: hostSchema.default('192.168.1.70'),
    port: portSchema.default(51325),
    baseChannel: z.number().int().min(1).max(16).default(12),
  }),
  feedback: z.object({
    enabled: z.boolean().default(true),
    echoSuppressionMs: z.number().int().min(0).default(100),
  }).optional(),
  logging: loggingConfigSchema.optional(),
});

// --- Type Exports ---

export type HubConfigInput = z.input<typeof hubConfigSchema>;
export type HubConfigOutput = z.output<typeof hubConfigSchema>;
export type LegacyConfigInput = z.input<typeof legacyConfigSchema>;
export type DeviceConfigInput = z.input<typeof deviceSchema>;

/**
 * Validate hub config format (multi-device)
 */
export function validateHubConfig(data: unknown): HubConfigOutput {
  return hubConfigSchema.parse(data);
}

/**
 * Validate legacy config format (single Avantis)
 */
export function validateLegacyConfig(data: unknown): z.output<typeof legacyConfigSchema> {
  return legacyConfigSchema.parse(data);
}

/**
 * Format Zod errors into readable messages
 */
export function formatZodError(error: z.ZodError<any>): string {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : 'config';
    return `  - ${path}: ${issue.message}`;
  }).join('\n');
}
