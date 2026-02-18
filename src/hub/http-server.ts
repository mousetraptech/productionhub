/**
 * Hub HTTP Server
 *
 * Handles all HTTP endpoints for the Production Hub:
 * - Health checks (/ping, /health, /api/health)
 * - Cue sequencer API (/api/cues/*)
 * - Macro API (/api/macros/*)
 * - Systems check (/system/check)
 * - Dashboard (/), checklist, smoke tests, emulators
 */

import * as http from 'http';
import { SystemsCheck, SystemsCheckReport } from '../systems-check';
import { getDashboardHTML } from '../dashboard';
import { PreshowChecklist } from '../preshow-checklist';
import { SmokeTest, SmokeTestResult } from '../smoke-test';
import { DeviceEmulator } from '../emulators';
import { CueSequencer } from '../cue-sequencer';
import { MacroEngine } from '../macros';
import { DashboardWebSocket } from '../server/dashboard-ws';
import { DeviceDriver } from '../drivers/device-driver';
import { getLogger } from '../logger';

const log = getLogger('HttpServer');

export interface HttpServerDeps {
  getStatus: () => any;
  getDeviceHealth: () => any[];
  getCueSequencer: () => CueSequencer;
  getMacroEngine: () => MacroEngine;
  getChecklist: () => PreshowChecklist | undefined;
  getDrivers: () => Map<string, DeviceDriver>;
  runSystemsCheck: () => Promise<SystemsCheckReport>;
  routeOSC: (address: string, args: any[]) => void;
  dashboardWs: DashboardWebSocket;
}

export class HubHttpServer {
  private server?: http.Server;
  private deps: HttpServerDeps;

  constructor(deps: HttpServerDeps) {
    this.deps = deps;
  }

  start(port: number): void {
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    this.deps.dashboardWs.attach(this.server);

    this.server.listen(port, '0.0.0.0', () => {
      log.info({ port }, 'Dashboard server started');
    });

    this.server.on('error', (err: NodeJS.ErrnoException) => {
      log.error({ error: err.message }, 'HTTP server error');
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = undefined;
    }
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const { method, url } = req;

    // Ping/health endpoints
    if (method === 'GET' && url === '/ping') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('pong');
      return;
    }

    if (method === 'GET' && url === '/health') {
      const status = this.deps.getStatus();
      const httpCode = status.status === 'ok' ? 200 : 503;
      res.writeHead(httpCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status, null, 2));
      return;
    }

    if (method === 'GET' && url === '/api/health') {
      const deviceHealth = this.deps.getDeviceHealth();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(deviceHealth, null, 2));
      return;
    }

    // Cue sequencer API
    if (method === 'GET' && url === '/api/cues') {
      const seq = this.deps.getCueSequencer();
      const state = seq.getState();
      const cueList = seq.getCueList();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ state, cueList }, null, 2));
      return;
    }

    if (method === 'POST' && url === '/api/cues/go') {
      const seq = this.deps.getCueSequencer();
      seq.go();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(seq.getState()));
      return;
    }

    if (method === 'POST' && url?.startsWith('/api/cues/go/')) {
      const cueId = url.slice('/api/cues/go/'.length);
      const seq = this.deps.getCueSequencer();
      if (cueId) {
        seq.goCue(cueId);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(seq.getState()));
      return;
    }

    if (method === 'POST' && url === '/api/cues/stop') {
      const seq = this.deps.getCueSequencer();
      seq.stop();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(seq.getState()));
      return;
    }

    if (method === 'POST' && url === '/api/cues/back') {
      const seq = this.deps.getCueSequencer();
      seq.back();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(seq.getState()));
      return;
    }

    // Macro API
    if (method === 'GET' && url === '/api/macros') {
      const macros = this.deps.getMacroEngine().getMacros();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(macros, null, 2));
      return;
    }

    if (method === 'POST' && url?.startsWith('/api/macros/trigger/')) {
      const macroAddr = '/' + url.slice('/api/macros/trigger/'.length);
      const executed = this.deps.getMacroEngine().execute(macroAddr, []);
      if (executed) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ triggered: macroAddr }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `No macro for: ${macroAddr}` }));
      }
      return;
    }

    // Systems check
    if (method === 'GET' && url === '/system/check') {
      this.deps.runSystemsCheck().then(report => {
        console.log(SystemsCheck.formatConsoleReport(report));
        const httpCode = report.overall === 'pass' ? 200 : 503;
        res.writeHead(httpCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(report, null, 2));
      }).catch(err => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
      return;
    }

    // Dashboard
    if (method === 'GET' && url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(getDashboardHTML());
      return;
    }

    // Checklist endpoints
    if (method === 'GET' && url === '/checklist') {
      const checklist = this.deps.getChecklist();
      const state = checklist?.getState() ?? { items: [], total: 0, checked: 0, allDone: true };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
      return;
    }

    if (method === 'POST' && url?.startsWith('/checklist/toggle/')) {
      const checklist = this.deps.getChecklist();
      const id = parseInt(url.split('/').pop() ?? '', 10);
      if (!checklist || isNaN(id) || !checklist.toggle(id)) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Item not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(checklist.getState()));
      return;
    }

    if (method === 'POST' && url === '/checklist/reset') {
      const checklist = this.deps.getChecklist();
      if (checklist) checklist.reset();
      const state = checklist?.getState() ?? { items: [], total: 0, checked: 0, allDone: true };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(state));
      return;
    }

    // Smoke test endpoint
    if (method === 'POST' && url?.startsWith('/smoke/')) {
      const rawPrefix = '/' + url.slice('/smoke/'.length);
      const prefix = rawPrefix.toLowerCase();
      const driver = this.deps.getDrivers().get(prefix);

      if (!driver) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `No driver for prefix: ${rawPrefix}` }));
        return;
      }

      const cmd = SmokeTest.getCommand(driver.name);
      if (!cmd) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `No smoke command for driver type: ${driver.name}` }));
        return;
      }

      const result: SmokeTestResult = {
        prefix,
        driverName: driver.name,
        connected: driver.isConnected(),
        sent: false,
        command: `${prefix}${cmd.address}`,
        label: cmd.label,
      };

      try {
        this.deps.routeOSC(`${prefix}${cmd.address}`, cmd.args);
        result.sent = true;
        log.info({ command: result.command, driver: driver.name, label: cmd.label }, 'Smoke test sent');
      } catch (err: any) {
        result.error = err.message ?? String(err);
        log.error({ command: result.command, error: err.message }, 'Smoke test failed');
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
      return;
    }

    // Emulator endpoints
    if (method === 'GET' && url === '/emulators') {
      const result: Record<string, any> = {};
      for (const [prefix, driver] of this.deps.getDrivers()) {
        if (driver instanceof DeviceEmulator) {
          result[prefix] = {
            name: driver.name,
            emulated: true,
            state: driver.getState(),
          };
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result, null, 2));
      return;
    }

    if (method === 'GET' && url === '/emulators/log') {
      const entries: Array<{ driver: string; timestamp: number; action: string; details: string }> = [];
      for (const [_prefix, driver] of this.deps.getDrivers()) {
        if (driver instanceof DeviceEmulator) {
          for (const entry of driver.getLog()) {
            entries.push({
              driver: driver.name,
              timestamp: entry.timestamp,
              action: entry.action,
              details: entry.details,
            });
          }
        }
      }
      entries.sort((a, b) => a.timestamp - b.timestamp);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(entries, null, 2));
      return;
    }

    res.writeHead(404);
    res.end();
  }

  getServer(): http.Server | undefined {
    return this.server;
  }
}
