#!/usr/bin/env node

/**
 * Production Hub
 *
 * Multi-device production control via OSC.
 * Routes incoming OSC by prefix to device-specific drivers:
 *   /avantis/...  → Allen & Heath Avantis (MIDI TCP)
 *   /lights/...   → ChamSys QuickQ 20 (OSC relay)
 *   /obs/...      → OBS Studio (WebSocket v5)
 *   /cam{N}/...   → PTZ cameras (VISCA over IP)
 *
 * Backward compatible with legacy single-Avantis config.yml format.
 *
 * Usage:
 *   avantis-osc                      # Use config.yml in current directory
 *   avantis-osc --profile talent-show # Use config.talent-show.yml
 *   avantis-osc --config ./my.yml    # Use a specific config file
 *   avantis-osc --verbose            # Enable verbose logging
 *   avantis-osc --check              # Run systems check and exit
 *   avantis-osc --validate cues.txt  # Validate OSC addresses against config
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { loadConfig } from './config';
import { ProductionHub } from './hub';
import { AvantisDriver } from './drivers/avantis-driver';
import { ChamSysDriver } from './drivers/chamsys-driver';
import { OBSDriver } from './drivers/obs-driver';
import { VISCADriver } from './drivers/visca-driver';
import { TouchDesignerDriver } from './drivers/touchdesigner-driver';
import { QLabDriver } from './drivers/qlab-driver';
import { NDIRecorderDriver } from './drivers/ndi-recorder-driver';
import { DeviceConfig, DeviceDriver, HubContext } from './drivers/device-driver';
import { SystemsCheck } from './systems-check';

/** Default ports for the standalone production-emulator */
const EMULATOR_DEFAULTS: Record<string, { host: string; port: number }> = {
  avantis: { host: '127.0.0.1', port: 51325 },
  chamsys: { host: '127.0.0.1', port: 7000 },
  obs: { host: '127.0.0.1', port: 4455 },
  visca: { host: '127.0.0.1', port: 5678 },
  touchdesigner: { host: '127.0.0.1', port: 12000 },
  qlab: { host: '127.0.0.1', port: 53100 },
};

function printBanner(): void {
  console.log('');
  console.log('  Production Hub');
  console.log('  Multi-device OSC control for live production');
  console.log('');
}

function printOSCReference(): void {
  console.log('  OSC Address Reference:');
  console.log('  ─────────────────────────────────────────────');
  console.log('');
  console.log('  Avantis (prefix: /avantis)');
  console.log('    /avantis/ch/{1-64}/mix/fader    float 0.0-1.0');
  console.log('    /avantis/ch/{1-64}/mix/mute     int   0|1');
  console.log('    /avantis/ch/{1-64}/mix/pan      float 0.0-1.0');
  console.log('    /avantis/mix/{1-12}/mix/fader   float 0.0-1.0');
  console.log('    /avantis/dca/{1-16}/fader       float 0.0-1.0');
  console.log('    /avantis/main/mix/fader         float 0.0-1.0');
  console.log('    /avantis/scene/recall           int   0-127');
  console.log('    /avantis/ch/{n}/mix/fade        target duration [easing]');
  console.log('');
  console.log('  ChamSys QuickQ 20 (prefix: /lights)');
  console.log('    /lights/pb/{X}/{Y}              Go playback X button Y');
  console.log('    /lights/pb/{X}/{Y}/level        float 0.0-1.0');
  console.log('    /lights/exec/{X}                Execute cue X');
  console.log('    /lights/release/{X}             Release playback X');
  console.log('');
  console.log('  OBS Studio (prefix: /obs)');
  console.log('    /obs/scene/{name}               Switch program scene');
  console.log('    /obs/scene/preview/{name}       Switch preview scene');
  console.log('    /obs/stream/start|stop|toggle   Stream control');
  console.log('    /obs/record/start|stop|toggle   Record control');
  console.log('    /obs/transition/{name}          Set transition type');
  console.log('    /obs/transition/duration        int ms');
  console.log('');
  console.log('  PTZ Camera (prefix: /cam1, /cam2, ...)');
  console.log('    /cam1/preset/recall/{N}         Recall preset N');
  console.log('    /cam1/preset/store/{N}          Store preset N');
  console.log('    /cam1/home                      Home position');
  console.log('    /cam1/pantilt/speed             float pan, float tilt');
  console.log('    /cam1/zoom/speed                float -1.0 to 1.0');
  console.log('');
  console.log('  TouchDesigner (prefix: /td)');
  console.log('    /td/{anything}                  Relay to TD OSC In CHOP');
  console.log('');
  console.log('  Global');
  console.log('    /fade/stop                      Stop all active fades');
  console.log('    /system/check                   Run pre-show systems check');
  console.log('');
  console.log('  ─────────────────────────────────────────────');
  console.log('');
}

function parseArgs(argv: string[]): { configPath?: string; overrides: Record<string, any> } {
  const overrides: Record<string, any> = {};
  let configPath: string | undefined;

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--config':
      case '-c':
        configPath = argv[++i];
        break;
      case '--profile':
        {
          const profileName = argv[++i];
          if (!profileName) {
            console.error('[Error] --profile requires a name (e.g. --profile talent-show)');
            process.exit(1);
          }
          configPath = path.join(process.cwd(), `config.${profileName}.yml`);
        }
        break;
      case '--verbose':
      case '-v':
        overrides['logging.verbose'] = true;
        break;
      case '--port':
      case '-p':
        overrides['osc.listenPort'] = parseInt(argv[++i], 10);
        break;
      case '--check':
        overrides['runCheck'] = true;
        break;
      case '--validate':
        overrides['validateFile'] = argv[++i];
        if (!overrides['validateFile']) {
          console.error('[Error] --validate requires a file path (e.g. --validate cues.txt)');
          process.exit(1);
        }
        break;
      case '--emulate-all':
        overrides['emulateAll'] = true;
        break;
      case '--help':
      case '-h':
        printBanner();
        printOSCReference();
        console.log('  Options:');
        console.log('    --profile <name>      Load config.<name>.yml (e.g. --profile talent-show)');
        console.log('    --config, -c <path>   Path to config YAML file');
        console.log('    --port, -p <port>     OSC listen port (default 9000)');
        console.log('    --verbose, -v         Enable verbose logging');
        console.log('    --check               Run systems check and exit');
        console.log('    --validate <file>     Validate OSC addresses against config prefixes');
        console.log('    --emulate-all         Set all devices to emulate mode and auto-launch emulator');
        console.log('    --help, -h            Show this help');
        console.log('');
        process.exit(0);
    }
  }

  return { configPath, overrides };
}

/** Global addresses handled by the hub itself (not routed to drivers) */
const GLOBAL_ADDRESSES = ['/fade/stop', '/system/check'];

export interface CueValidationResult {
  matched: Array<{ address: string; driver: string }>;
  orphaned: string[];
}

/**
 * Match a list of OSC addresses against configured driver prefixes.
 * Pure function — no I/O, no process.exit.
 */
export function matchCueAddresses(
  addresses: string[],
  prefixes: Array<{ prefix: string }>,
): CueValidationResult {
  // Build sorted prefixes (longest first, lowercased)
  const sorted = prefixes
    .map(d => d.prefix.toLowerCase())
    .sort((a, b) => b.length - a.length);

  const matched: Array<{ address: string; driver: string }> = [];
  const orphaned: string[] = [];

  for (const address of addresses) {
    const addr = address.toLowerCase();

    // Check global addresses first
    if (GLOBAL_ADDRESSES.some(g => addr === g || addr.startsWith(g + '/'))) {
      matched.push({ address, driver: '(global)' });
      continue;
    }

    // Check against driver prefixes
    let found = false;
    for (const prefix of sorted) {
      if (addr.startsWith(prefix + '/') || addr === prefix) {
        const deviceEntry = prefixes.find(d => d.prefix.toLowerCase() === prefix);
        matched.push({ address, driver: deviceEntry?.prefix ?? prefix });
        found = true;
        break;
      }
    }

    if (!found) {
      orphaned.push(address);
    }
  }

  return { matched, orphaned };
}

/**
 * Validate a cue list file against configured driver prefixes.
 * Reads file, runs validation, prints report, exits.
 */
function validateCues(cueFile: string, config: { devices: { prefix: string }[] }): void {
  if (!fs.existsSync(cueFile)) {
    console.error(`[Error] Cue file not found: ${cueFile}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(cueFile, 'utf-8');
  const addresses = raw.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));

  if (addresses.length === 0) {
    console.error('[Error] Cue file is empty');
    process.exit(1);
  }

  const { matched, orphaned } = matchCueAddresses(addresses, config.devices);

  // Print report
  console.log('');
  console.log('  CUE VALIDATION REPORT');
  console.log('  ========================================');
  console.log('');

  if (matched.length > 0) {
    console.log(`  Matched (${matched.length}):`);
    for (const m of matched) {
      console.log(`    [OK]   ${m.address.padEnd(40)} → ${m.driver}`);
    }
    console.log('');
  }

  if (orphaned.length > 0) {
    console.log(`  Orphaned (${orphaned.length}):`);
    for (const o of orphaned) {
      console.log(`    [??]   ${o}`);
    }
    console.log('');
  }

  console.log(`  RESULT: ${orphaned.length === 0 ? 'PASS' : 'FAIL'} (${matched.length} matched, ${orphaned.length} orphaned)`);
  console.log('  ========================================');
  console.log('');

  process.exit(orphaned.length === 0 ? 0 : 1);
}

/** Create a device driver from a config entry */
function createDriver(deviceConfig: DeviceConfig, hubContext: HubContext, verbose: boolean): DeviceDriver {
  // Emulate mode: override host/port to point at the standalone production-emulator
  if (deviceConfig.emulate) {
    const defaults = EMULATOR_DEFAULTS[deviceConfig.type];
    if (defaults) {
      deviceConfig.host = defaults.host;
      deviceConfig.port = defaults.port;
    }
  }

  switch (deviceConfig.type) {
    case 'avantis':
      return new AvantisDriver(deviceConfig as any, hubContext, verbose);
    case 'chamsys':
      return new ChamSysDriver(deviceConfig as any, hubContext, verbose);
    case 'obs':
      return new OBSDriver(deviceConfig as any, hubContext, verbose);
    case 'visca':
      return new VISCADriver(deviceConfig as any, hubContext, verbose);
    case 'touchdesigner':
      return new TouchDesignerDriver(deviceConfig as any, hubContext, verbose);
    case 'qlab':
      return new QLabDriver(deviceConfig as any, hubContext, verbose);
    case 'ndi-recorder':
      return new NDIRecorderDriver(deviceConfig as any, hubContext, verbose);
    default:
      throw new Error(`Unknown device type: ${deviceConfig.type}`);
  }
}

/* ── Emulator auto-launcher ──────────────────────────────────────────── */

let emulatorProcess: ChildProcess | null = null;

function findEmulatorPath(): string | null {
  const candidates = [
    process.env.EMULATOR_PATH,
    path.join(process.cwd(), '..', 'production-emulator'),
    path.join(__dirname, '..', '..', 'production-emulator'),
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'server.js'))) {
      return candidate;
    }
  }
  return null;
}

async function launchEmulator(): Promise<void> {
  const emulatorPath = findEmulatorPath();
  if (!emulatorPath) {
    console.error('[Emulator] Cannot find production-emulator. Set EMULATOR_PATH or place it at ../production-emulator');
    process.exit(1);
  }

  console.log(`[Emulator] Launching from ${emulatorPath}`);
  emulatorProcess = spawn('node', ['server.js'], {
    cwd: emulatorPath,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  emulatorProcess.stdout?.on('data', (data: Buffer) => {
    for (const line of data.toString().split('\n').filter(Boolean)) {
      console.log(`[emulator] ${line}`);
    }
  });

  emulatorProcess.stderr?.on('data', (data: Buffer) => {
    for (const line of data.toString().split('\n').filter(Boolean)) {
      console.error(`[emulator] ${line}`);
    }
  });

  emulatorProcess.on('exit', (code) => {
    console.log(`[Emulator] Process exited with code ${code}`);
    emulatorProcess = null;
  });

  // Wait for HTTP port to respond
  const maxWait = 5000;
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      await fetch('http://127.0.0.1:8080');
      console.log('[Emulator] Ready on http://127.0.0.1:8080');
      return;
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  console.warn('[Emulator] Timeout waiting for emulator — continuing anyway');
}

function stopEmulator(): void {
  if (emulatorProcess) {
    emulatorProcess.kill();
    emulatorProcess = null;
  }
}

async function main(): Promise<void> {
  const { configPath, overrides } = parseArgs(process.argv);

  printBanner();

  // If an explicit config path was given (--config or --profile), verify it exists
  if (configPath && !fs.existsSync(configPath)) {
    console.error(`[Error] Config file not found: ${configPath}`);
    process.exit(1);
  }

  const config = loadConfig(configPath);

  // --validate: offline cue validation, no device connections needed
  if (overrides['validateFile']) {
    validateCues(overrides['validateFile'], config);
    return; // validateCues calls process.exit
  }

  // Apply CLI overrides
  if (overrides['osc.listenPort']) config.osc.listenPort = overrides['osc.listenPort'];
  if (overrides['logging.verbose']) config.logging = { verbose: true };

  const verbose = config.logging?.verbose ?? false;

  // --emulate-all: set all devices to emulate mode and launch the emulator
  const emulateAll = overrides['emulateAll'] === true;
  if (emulateAll) {
    for (const device of config.devices) {
      device.emulate = true;
    }
    await launchEmulator();
  }

  // Create hub
  const hub = new ProductionHub({
    osc: config.osc,
    health: config.health,
    logging: config.logging,
    systemsCheck: config.systemsCheck,
    checklist: config.checklist,
    ui: config.ui,
    macros: config.macros,
    brain: config.brain,
  });

  // Create and register drivers from config
  for (const deviceConf of config.devices) {
    const driver = createDriver(deviceConf, hub.hubContext, verbose);
    hub.addDriver(driver, deviceConf);
    const mode = deviceConf.emulate ? `-> emulator @ ${deviceConf.host}:${deviceConf.port}` : `-> ${deviceConf.host}:${deviceConf.port}`;
    console.log(`[Main] Registered ${deviceConf.type} on ${deviceConf.prefix} ${mode}`);
  }

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[Hub] Shutting down...');
    stopEmulator();
    hub.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    stopEmulator();
    hub.stop();
    process.exit(0);
  });

  hub.start();

  // --check: run systems check and exit
  if (overrides['runCheck']) {
    // Wait for drivers to attempt connections
    setTimeout(async () => {
      const report = await hub.runSystemsCheck();
      console.log(SystemsCheck.formatConsoleReport(report));
      hub.stop();
      process.exit(report.overall === 'pass' ? 0 : 1);
    }, 3000);
    return;
  }

  printOSCReference();

  // Auto systems check on startup (non-blocking)
  setTimeout(async () => {
    console.log('[Hub] Running startup systems check...');
    const report = await hub.runSystemsCheck();
    console.log(SystemsCheck.formatConsoleReport(report));
    if (report.overall === 'fail') {
      console.warn('[Hub] Startup check found issues — hub is running, but some targets are unreachable');
    }
  }, 3000);
}

// Only run main() when this file is the entry point (not when imported for testing)
if (require.main === module) {
  main();
}
