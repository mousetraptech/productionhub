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
 */

import * as fs from 'fs';
import * as path from 'path';
import { loadConfig } from './config';
import { ProductionHub } from './hub';
import { AvantisDriver } from './drivers/avantis-driver';
import { ChamSysDriver } from './drivers/chamsys-driver';
import { OBSDriver } from './drivers/obs-driver';
import { VISCADriver } from './drivers/visca-driver';
import { TouchDesignerDriver } from './drivers/touchdesigner-driver';
import { DeviceConfig, DeviceDriver, HubContext } from './drivers/device-driver';
import { SystemsCheck } from './systems-check';

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
        console.log('    --help, -h            Show this help');
        console.log('');
        process.exit(0);
    }
  }

  return { configPath, overrides };
}

/** Create a device driver from a config entry */
function createDriver(deviceConfig: DeviceConfig, hubContext: HubContext, verbose: boolean): DeviceDriver {
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
    default:
      throw new Error(`Unknown device type: ${deviceConfig.type}`);
  }
}

function main(): void {
  const { configPath, overrides } = parseArgs(process.argv);

  printBanner();

  // If an explicit config path was given (--config or --profile), verify it exists
  if (configPath && !fs.existsSync(configPath)) {
    console.error(`[Error] Config file not found: ${configPath}`);
    process.exit(1);
  }

  const config = loadConfig(configPath);

  // Apply CLI overrides
  if (overrides['osc.listenPort']) config.osc.listenPort = overrides['osc.listenPort'];
  if (overrides['logging.verbose']) config.logging = { verbose: true };

  const verbose = config.logging?.verbose ?? false;

  // Create hub
  const hub = new ProductionHub({
    osc: config.osc,
    health: config.health,
    logging: config.logging,
    systemsCheck: config.systemsCheck,
  });

  // Create and register drivers from config
  for (const deviceConf of config.devices) {
    const driver = createDriver(deviceConf, hub.hubContext, verbose);
    hub.addDriver(driver, deviceConf);
    console.log(`[Main] Registered ${deviceConf.type} on ${deviceConf.prefix} -> ${deviceConf.host}:${deviceConf.port}`);
  }

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[Hub] Shutting down...');
    hub.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
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

  if (!overrides['runCheck']) {
    printOSCReference();
  }
}

main();
