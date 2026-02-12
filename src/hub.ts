/**
 * ProductionHub
 *
 * Central orchestrator for multi-device production control.
 * Owns the single OSC server and shared FadeEngine.
 * Routes incoming OSC messages to device drivers by prefix.
 * Collects feedback from drivers and relays to OSC clients.
 */

import * as http from 'http';
import { AvantisOSCServer } from './osc-server';
import { FadeEngine } from './fade-engine';
import { DeviceDriver, DeviceConfig, FeedbackEvent, HubContext, DriverFadeRequest } from './drivers/device-driver';
import { DriverStats, createDriverStats, inferTransportType } from './driver-stats';
import { SystemsCheck, ProbeTarget, SystemsCheckReport } from './systems-check';
import { getDashboardHTML } from './dashboard';
import { PreshowChecklist } from './preshow-checklist';
import { SmokeTest, SmokeTestResult } from './smoke-test';
import { DeviceEmulator } from './emulators';

export interface HubConfig {
  osc: {
    listenAddress: string;
    listenPort: number;
    replyPort?: number;
  };
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
}

export class ProductionHub {
  private oscServer: AvantisOSCServer;
  private fadeEngine: FadeEngine;
  private drivers: Map<string, DeviceDriver> = new Map();
  private driverStats: Map<string, DriverStats> = new Map();
  private sortedPrefixes: string[] = []; // sorted longest-first for matching
  private verbose: boolean;
  private healthServer?: http.Server;
  private healthConfig: { enabled: boolean; port: number };
  private externalTargets: ProbeTarget[];
  private checklist?: PreshowChecklist;
  private startedAt: number = 0;

  /** HubContext passed to drivers so they can use the shared fade engine */
  readonly hubContext: HubContext;

  constructor(config: HubConfig) {
    this.verbose = config.logging?.verbose ?? false;
    this.healthConfig = {
      enabled: config.health?.enabled ?? false,
      port: config.health?.port ?? 8080,
    };
    this.externalTargets = config.systemsCheck?.externalTargets ?? [];

    if (config.checklist && config.checklist.length > 0) {
      this.checklist = new PreshowChecklist(config.checklist);
    }

    this.oscServer = new AvantisOSCServer({
      localAddress: config.osc.listenAddress,
      localPort: config.osc.listenPort,
      replyPort: config.osc.replyPort,
    });

    this.fadeEngine = new FadeEngine();

    // Build the hub context that drivers use for fade integration
    this.hubContext = {
      startFade: (req: DriverFadeRequest) => this.fadeEngine.startFade(req),
      cancelFade: (key: string, snap?: boolean) => this.fadeEngine.cancelFade(key, snap),
      cancelAllFades: () => this.fadeEngine.cancelAll(),
      setCurrentValue: (key: string, val: number) => this.fadeEngine.setCurrentValue(key, val),
      getCurrentValue: (key: string) => this.fadeEngine.getCurrentValue(key),
    };
  }

  /** Register a device driver with the hub */
  addDriver(driver: DeviceDriver, config?: DeviceConfig): void {
    const prefix = driver.prefix.toLowerCase();
    if (this.drivers.has(prefix)) {
      throw new Error(`Duplicate driver prefix: ${prefix}`);
    }

    this.drivers.set(prefix, driver);
    this.sortedPrefixes = Array.from(this.drivers.keys())
      .sort((a, b) => b.length - a.length); // longest first

    // Create stats tracker for this driver
    const stats = createDriverStats(
      driver.name,
      prefix,
      config ? inferTransportType(config.type, config) : 'udp',
      config?.host ?? '',
      config?.port ?? 0,
    );
    this.driverStats.set(prefix, stats);
    let firstConnectSeen = false;

    // Wire up feedback: driver emits feedback, hub prepends prefix and sends to OSC clients
    driver.on('feedback', (event: FeedbackEvent) => {
      const fullAddress = `${prefix}${event.address}`;
      this.oscServer.sendToClients(fullAddress, event.args);
      stats.lastMessageReceivedAt = Date.now();
      if (this.verbose) {
        console.log(`[Hub] Feedback ${driver.name}: ${fullAddress}`);
      }
    });

    driver.on('error', (err: Error) => {
      stats.lastError = err.message;
      stats.lastErrorAt = Date.now();
      console.error(`[Hub] ${driver.name} error: ${err.message}`);
    });

    driver.on('connected', () => {
      if (firstConnectSeen) stats.reconnectCount++;
      firstConnectSeen = true;
      stats.connected = true;
      stats.lastConnectedAt = Date.now();
      console.log(`[Hub] ${driver.name} connected`);
      this.sendDriverStatus(driver.name, 1);
      this.checkAllReady();
    });

    driver.on('disconnected', () => {
      stats.connected = false;
      stats.lastDisconnectedAt = Date.now();
      console.warn(`[Hub] ${driver.name} disconnected`);
      this.sendDriverStatus(driver.name, 0);
    });

    if (this.verbose) {
      console.log(`[Hub] Registered driver "${driver.name}" on prefix "${prefix}"`);
    }
  }

  /** Start the hub: OSC server, fade engine, and all drivers */
  start(): void {
    console.log('[Hub] Starting Production Hub...');
    console.log(`[Hub] OSC: ${this.oscServer['options'].localAddress}:${this.oscServer['options'].localPort}`);
    console.log(`[Hub] Drivers: ${Array.from(this.drivers.values()).map(d => d.name).join(', ')}`);

    // Wire OSC incoming messages to prefix router via clean API
    this.oscServer.onRawMessage((address, args, _info) => {
      this.routeOSC(address, args);
    });

    // Wire fade engine ticks to the right driver
    this.fadeEngine.on('value', (key: string, value: number) => {
      this.routeFadeTick(key, value);
    });

    this.fadeEngine.on('fadeComplete', (key: string) => {
      if (this.verbose) {
        console.log(`[Hub] Fade complete: ${key}`);
      }
    });

    // Start everything
    this.oscServer.start();
    this.fadeEngine.start();
    this.startedAt = Date.now();

    for (const driver of this.drivers.values()) {
      driver.connect();
    }

    // Start health check HTTP server
    if (this.healthConfig.enabled) {
      this.startHealthServer();
    }
  }

  /** Stop everything */
  stop(): void {
    console.log('[Hub] Stopping...');
    this.fadeEngine.stop();
    this.oscServer.stop();
    for (const driver of this.drivers.values()) {
      driver.disconnect();
    }
    if (this.healthServer) {
      this.healthServer.close();
      this.healthServer = undefined;
    }
  }

  /**
   * Route an incoming OSC address+args to the correct driver.
   * Matches the longest prefix. Strips the prefix before passing to the driver.
   *
   * Special cases:
   *   /fade/stop     — cancel fades globally
   *   /system/check  — run pre-show systems check
   */
  routeOSC(address: string, args: any[]): void {
    const addr = address.toLowerCase();

    // Global fade stop
    if (addr === '/fade/stop') {
      if (args.length > 0) {
        const key = typeof args[0] === 'object' && args[0].value !== undefined
          ? String(args[0].value)
          : String(args[0]);
        this.fadeEngine.cancelFade(key, true);
        if (this.verbose) console.log(`[Hub] Fade stopped: ${key}`);
      } else {
        this.fadeEngine.cancelAll();
        if (this.verbose) console.log('[Hub] All fades stopped');
      }
      return;
    }

    // Systems check
    if (addr === '/system/check') {
      this.runSystemsCheck().then(report => {
        console.log(SystemsCheck.formatConsoleReport(report));
        this.sendCheckResultsViaOSC(report);
      });
      return;
    }

    // Find matching driver by longest prefix
    for (const prefix of this.sortedPrefixes) {
      if (addr.startsWith(prefix + '/') || addr === prefix) {
        const driver = this.drivers.get(prefix)!;
        const remainder = addr.slice(prefix.length) || '/';
        if (this.verbose) {
          console.log(`[Hub] Route ${address} -> ${driver.name} ${remainder}`);
        }
        driver.handleOSC(remainder, args);
        return;
      }
    }

    console.warn(`[Hub] No driver matched: ${address}`);
  }

  /** Run a full systems check — probes all drivers and external targets */
  async runSystemsCheck(): Promise<SystemsCheckReport> {
    const checker = new SystemsCheck(
      this.drivers,
      this.driverStats,
      this.externalTargets,
      () => this.oscServer.clientCount,
    );
    return checker.run();
  }

  /** Send systems check results back to OSC clients */
  private sendCheckResultsViaOSC(report: SystemsCheckReport): void {
    this.oscServer.sendToClients('/system/check/status', [
      { type: 's', value: report.overall },
    ]);

    for (const result of report.results) {
      const safeName = result.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const addr = result.type === 'driver'
        ? `/system/check/${safeName}`
        : `/system/check/ext/${safeName}`;
      this.oscServer.sendToClients(addr, [
        { type: 's', value: result.status },
      ]);
    }

    this.oscServer.sendToClients('/system/check/complete', [
      { type: 'i', value: 1 },
    ]);
  }

  /** Send driver connection status to all OSC clients */
  private sendDriverStatus(driverName: string, status: number): void {
    const safeName = driverName.replace(/[^a-zA-Z0-9_-]/g, '_');
    this.oscServer.sendToClients(`/system/driver/${safeName}/status`, [
      { type: 'i', value: status },
    ]);
  }

  /** Send /system/ready 1 if all drivers are connected */
  private checkAllReady(): void {
    if (this.drivers.size === 0) return;
    for (const driver of this.drivers.values()) {
      if (!driver.isConnected()) return;
    }
    this.oscServer.sendToClients('/system/ready', [
      { type: 'i', value: 1 },
    ]);
    console.log('[Hub] All drivers connected — system ready');
  }

  /**
   * Route a fade tick to the driver that owns this key.
   * Fade keys are namespaced by driver: "driverName:stripType/number/param"
   */
  private routeFadeTick(key: string, value: number): void {
    // Key format: "driverName:restOfKey" e.g. "avantis:input/1/fader"
    const colonIdx = key.indexOf(':');
    if (colonIdx === -1) {
      // Legacy key format without driver prefix — broadcast to all drivers
      for (const driver of this.drivers.values()) {
        driver.handleFadeTick(key, value);
      }
      return;
    }

    const driverName = key.slice(0, colonIdx);
    const driverKey = key.slice(colonIdx + 1);
    for (const driver of this.drivers.values()) {
      if (driver.name === driverName) {
        driver.handleFadeTick(driverKey, value);
        return;
      }
    }
  }

  /** Get the OSC server instance (for testing) */
  getOSCServer(): AvantisOSCServer {
    return this.oscServer;
  }

  /** Get a driver by name (for testing) */
  getDriver(name: string): DeviceDriver | undefined {
    for (const driver of this.drivers.values()) {
      if (driver.name === name) return driver;
    }
    return undefined;
  }

  /** Get all registered driver names */
  getDriverNames(): string[] {
    return Array.from(this.drivers.values()).map(d => d.name);
  }

  /** Get the driver stats map (for testing) */
  getDriverStats(): Map<string, DriverStats> {
    return this.driverStats;
  }

  /**
   * Health check HTTP server.
   *
   * GET /health        → 200 {"status":"ok",...}  or 503 {"status":"degraded",...}
   * GET /ping          → 200 "pong" (fast liveness check for watchdog)
   * GET /system/check  → 200|503 systems check JSON report
   *
   * The watchdog script hits /ping every N seconds.
   * Monitoring dashboards can poll /health for full status.
   */
  private startHealthServer(): void {
    this.healthServer = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/ping') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('pong');
        return;
      }

      if (req.method === 'GET' && req.url === '/health') {
        const status = this.getStatus();
        const httpCode = status.status === 'ok' ? 200 : 503;
        res.writeHead(httpCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(status, null, 2));
        return;
      }

      if (req.method === 'GET' && req.url === '/system/check') {
        this.runSystemsCheck().then(report => {
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

      if (req.method === 'GET' && req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(getDashboardHTML());
        return;
      }

      // Checklist endpoints
      if (req.method === 'GET' && req.url === '/checklist') {
        const state = this.checklist?.getState() ?? { items: [], total: 0, checked: 0, allDone: true };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state));
        return;
      }

      if (req.method === 'POST' && req.url?.startsWith('/checklist/toggle/')) {
        const id = parseInt(req.url.split('/').pop() ?? '', 10);
        if (!this.checklist || isNaN(id) || !this.checklist.toggle(id)) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Item not found' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.checklist.getState()));
        return;
      }

      if (req.method === 'POST' && req.url === '/checklist/reset') {
        if (this.checklist) this.checklist.reset();
        const state = this.checklist?.getState() ?? { items: [], total: 0, checked: 0, allDone: true };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(state));
        return;
      }

      // Smoke test endpoint: POST /smoke/{prefix}
      if (req.method === 'POST' && req.url?.startsWith('/smoke/')) {
        const rawPrefix = '/' + req.url.slice('/smoke/'.length);
        const prefix = rawPrefix.toLowerCase();
        const driver = this.drivers.get(prefix);

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
          this.routeOSC(`${prefix}${cmd.address}`, cmd.args);
          result.sent = true;
          console.log(`[Hub] Smoke test: ${result.command} → ${driver.name} (${cmd.label})`);
        } catch (err: any) {
          result.error = err.message ?? String(err);
          console.error(`[Hub] Smoke test failed: ${result.command} → ${err.message}`);
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      // Emulator endpoints
      if (req.method === 'GET' && req.url === '/emulators') {
        const result: Record<string, any> = {};
        for (const [prefix, driver] of this.drivers) {
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

      if (req.method === 'GET' && req.url === '/emulators/log') {
        const entries: Array<{ driver: string; timestamp: number; action: string; details: string }> = [];
        for (const [_prefix, driver] of this.drivers) {
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
        // Sort by timestamp ascending
        entries.sort((a, b) => a.timestamp - b.timestamp);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(entries, null, 2));
        return;
      }

      res.writeHead(404);
      res.end();
    });

    this.healthServer.listen(this.healthConfig.port, '0.0.0.0', () => {
      console.log(`[Hub] Dashboard: http://localhost:${this.healthConfig.port}/`);
    });

    this.healthServer.on('error', (err: NodeJS.ErrnoException) => {
      console.error(`[Hub] Health server error: ${err.message}`);
      // Non-fatal — hub continues even if health port is busy
    });
  }

  /** Build a status snapshot for the health endpoint */
  getStatus(): {
    status: 'ok' | 'degraded';
    uptime: number;
    uptimeHuman: string;
    oscPort: number;
    oscClients: number;
    oscClientList: Array<{ address: string; port: number; lastSeen: number }>;
    drivers: Array<{
      name: string;
      prefix: string;
      connected: boolean;
      transportType: string;
      host: string;
      port: number;
      reconnectCount: number;
      lastMessageReceivedAt: number | null;
      lastError: string | null;
      lastErrorAt: number | null;
    }>;
    fades: {
      activeCount: number;
    };
    memory: {
      rss: number;
      heapUsed: number;
      heapTotal: number;
    };
    pid: number;
  } {
    const uptimeMs = Date.now() - this.startedAt;
    const uptimeSec = Math.floor(uptimeMs / 1000);

    const driverStatuses = Array.from(this.drivers.entries()).map(([prefix, d]) => {
      const stats = this.driverStats.get(prefix);
      return {
        name: d.name,
        prefix: d.prefix,
        connected: d.isConnected(),
        transportType: stats?.transportType ?? 'udp',
        host: stats?.host ?? '',
        port: stats?.port ?? 0,
        reconnectCount: stats?.reconnectCount ?? 0,
        lastMessageReceivedAt: stats?.lastMessageReceivedAt ?? null,
        lastError: stats?.lastError ?? null,
        lastErrorAt: stats?.lastErrorAt ?? null,
      };
    });

    const allConnected = driverStatuses.length === 0 ||
      driverStatuses.every(d => d.connected);

    const mem = process.memoryUsage();

    // Human-readable uptime
    const days = Math.floor(uptimeSec / 86400);
    const hours = Math.floor((uptimeSec % 86400) / 3600);
    const mins = Math.floor((uptimeSec % 3600) / 60);
    const secs = uptimeSec % 60;
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (mins > 0) parts.push(`${mins}m`);
    parts.push(`${secs}s`);

    return {
      status: allConnected ? 'ok' : 'degraded',
      uptime: uptimeSec,
      uptimeHuman: parts.join(' '),
      oscPort: this.oscServer['options'].localPort,
      oscClients: this.oscServer.clientCount,
      oscClientList: this.oscServer.getClients(),
      drivers: driverStatuses,
      fades: {
        activeCount: this.fadeEngine.activeCount,
      },
      memory: {
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
      },
      pid: process.pid,
    };
  }
}
