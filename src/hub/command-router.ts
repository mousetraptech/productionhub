/**
 * Command Router
 *
 * Handles /hub/* OSC commands for the cue sequencer and macros.
 */

import { CueSequencer } from '../cue-sequencer';
import { MacroEngine } from '../macros';
import { AvantisOSCServer } from '../osc-server';
import { getLogger } from '../logger';

const log = getLogger('CommandRouter');

export interface CommandRouterDeps {
  cueSequencer: CueSequencer;
  macroEngine: MacroEngine;
  oscServer: AvantisOSCServer;
  verbose: boolean;
}

export class CommandRouter {
  private cueSequencer: CueSequencer;
  private macroEngine: MacroEngine;
  private oscServer: AvantisOSCServer;
  private verbose: boolean;

  constructor(deps: CommandRouterDeps) {
    this.cueSequencer = deps.cueSequencer;
    this.macroEngine = deps.macroEngine;
    this.oscServer = deps.oscServer;
    this.verbose = deps.verbose;
  }

  /**
   * Handle /hub/* OSC commands.
   * Returns true if the command was handled.
   */
  handle(addr: string, args: any[]): boolean {
    if (!addr.startsWith('/hub/')) return false;

    const extractString = (a: any): string =>
      typeof a === 'object' && a !== null && a.value !== undefined
        ? String(a.value)
        : String(a);

    if (addr === '/hub/go') {
      this.cueSequencer.go();
      return true;
    }

    if (addr.startsWith('/hub/go/')) {
      const cueId = addr.slice('/hub/go/'.length);
      if (cueId) {
        this.cueSequencer.goCue(cueId);
      }
      return true;
    }

    if (addr === '/hub/stop') {
      this.cueSequencer.stop();
      return true;
    }

    if (addr === '/hub/back') {
      this.cueSequencer.back();
      return true;
    }

    if (addr === '/hub/cuelist/load') {
      if (args.length === 0) {
        log.warn('/hub/cuelist/load requires a file path argument');
        return true;
      }
      const filePath = extractString(args[0]);
      try {
        const { loadCueListFromFile } = require('../cue-sequencer');
        const cueList = loadCueListFromFile(filePath);
        this.cueSequencer.loadCueList(cueList);
      } catch (err: any) {
        log.error({ error: err.message }, 'Failed to load cue list');
      }
      return true;
    }

    if (addr === '/hub/status') {
      const state = this.cueSequencer.getState();
      this.oscServer.sendToClients('/hub/status/loaded', [
        { type: 'i', value: state.loaded ? 1 : 0 },
      ]);
      this.oscServer.sendToClients('/hub/status/cuelist', [
        { type: 's', value: state.cueListName },
      ]);
      this.oscServer.sendToClients('/hub/status/playhead', [
        { type: 'i', value: state.playheadIndex },
      ]);
      this.oscServer.sendToClients('/hub/status/running', [
        { type: 'i', value: state.isRunning ? 1 : 0 },
      ]);
      this.oscServer.sendToClients('/hub/status/activecue', [
        { type: 's', value: state.activeCueId ?? '' },
      ]);
      return true;
    }

    // Check if it's a macro (e.g. /hub/panic, /hub/macro/*)
    if (this.macroEngine.execute(addr, args)) {
      return true;
    }

    if (this.verbose) {
      log.warn({ address: addr }, 'Unknown hub command');
    }
    return false;
  }
}
