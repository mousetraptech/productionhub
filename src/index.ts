#!/usr/bin/env node

/**
 * Avantis OSC Bridge
 *
 * Provides an OSC interface for the Allen & Heath Avantis mixer.
 * Receives OSC messages over UDP and translates them to MIDI TCP
 * messages that the Avantis understands.
 *
 * Usage:
 *   avantis-osc                      # Use config.yml in current directory
 *   avantis-osc --config ./my.yml    # Use a specific config file
 *   avantis-osc --verbose            # Enable verbose logging
 *   avantis-osc --host 10.0.0.50     # Override Avantis IP
 *   avantis-osc --port 9001          # Override OSC listen port
 */

import { loadConfig } from './config';
import { AvantisBridge } from './bridge';

function printBanner(): void {
  console.log('');
  console.log('  Avantis OSC Bridge');
  console.log('  Allen & Heath Avantis MIDI TCP <-> OSC');
  console.log('');
}

function printOSCReference(): void {
  console.log('  OSC Address Reference:');
  console.log('  ─────────────────────────────────────────────');
  console.log('  /ch/{1-64}/mix/fader    float 0.0-1.0   Input fader');
  console.log('  /ch/{1-64}/mix/mute     int   0|1       Input mute');
  console.log('  /ch/{1-64}/mix/pan      float 0.0-1.0   Input pan');
  console.log('  /mix/{1-12}/mix/fader   float 0.0-1.0   Mix/Aux fader');
  console.log('  /mix/{1-12}/mix/mute    int   0|1       Mix/Aux mute');
  console.log('  /fxsend/{1-4}/mix/fader float 0.0-1.0   FX Send fader');
  console.log('  /fxrtn/{1-8}/mix/fader  float 0.0-1.0   FX Return fader');
  console.log('  /dca/{1-16}/fader       float 0.0-1.0   DCA fader');
  console.log('  /dca/{1-16}/mute        int   0|1       DCA mute');
  console.log('  /grp/{1-16}/mix/fader   float 0.0-1.0   Group fader');
  console.log('  /mtx/{1-6}/mix/fader    float 0.0-1.0   Matrix fader');
  console.log('  /main/mix/fader         float 0.0-1.0   Main LR fader');
  console.log('  /main/mix/mute          int   0|1       Main LR mute');
  console.log('  /scene/recall           int   0-127     Scene recall');
  console.log('');
  console.log('  Timed fades (interpolated at 50Hz by bridge):');
  console.log('  /ch/{n}/mix/fade        target duration [easing]');
  console.log('  /mix/{n}/mix/fade       target duration [easing]');
  console.log('  /dca/{n}/fade           target duration [easing]');
  console.log('  /main/mix/fade          target duration [easing]');
  console.log('  /fade/stop              (stop all fades)');
  console.log('  Easing: linear, scurve (default), easein, easeout');
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
      case '--host':
        overrides['midi.host'] = argv[++i];
        break;
      case '--port':
      case '-p':
        overrides['osc.listenPort'] = parseInt(argv[++i], 10);
        break;
      case '--midi-port':
        overrides['midi.port'] = parseInt(argv[++i], 10);
        break;
      case '--midi-channel':
        overrides['midi.baseChannel'] = parseInt(argv[++i], 10);
        break;
      case '--verbose':
      case '-v':
        overrides['logging.verbose'] = true;
        break;
      case '--help':
      case '-h':
        printBanner();
        printOSCReference();
        console.log('  Options:');
        console.log('    --config, -c <path>   Path to config YAML file');
        console.log('    --host <ip>           Avantis IP address');
        console.log('    --port, -p <port>     OSC listen port (default 9000)');
        console.log('    --midi-port <port>    MIDI TCP port (default 51325)');
        console.log('    --midi-channel <ch>   Base MIDI channel 1-16 (default 12)');
        console.log('    --verbose, -v         Enable verbose logging');
        console.log('    --help, -h            Show this help');
        console.log('');
        process.exit(0);
    }
  }

  return { configPath, overrides };
}

function main(): void {
  const { configPath, overrides } = parseArgs(process.argv);

  printBanner();
  const config = loadConfig(configPath);

  // Apply CLI overrides
  if (overrides['midi.host']) config.midi.host = overrides['midi.host'];
  if (overrides['osc.listenPort']) config.osc.listenPort = overrides['osc.listenPort'];
  if (overrides['midi.port']) config.midi.port = overrides['midi.port'];
  if (overrides['midi.baseChannel']) config.midi.baseChannel = overrides['midi.baseChannel'];
  if (overrides['logging.verbose']) config.logging = { verbose: true };

  printOSCReference();

  const bridge = new AvantisBridge(config);

  process.on('SIGINT', () => {
    console.log('\n[Bridge] Shutting down...');
    bridge.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    bridge.stop();
    process.exit(0);
  });

  bridge.start();
}

main();
