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
import { ActionRegistry } from './actions/registry';
import { CueEngine } from './cue-engine/engine';
import { TemplateLoader } from './shows/templates';
import { ShowPersistence } from './cue-engine/persistence';
import { ModWebSocket } from './server/websocket';
import { DeviceHealthManager, DeviceHealth, ReconnectConfig, HeartbeatConfig } from './health';
import { CueSequencer, CueSequencerState, CueList } from './cue-sequencer';
import { DashboardWebSocket } from './server/dashboard-ws';
import { MacroEngine, MacroDef, MacroConfig } from './macros';

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
  ui?: {
    enabled: boolean;
    port: number;
  };
  macros?: MacroDef[];
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
  private uiConfig: { enabled: boolean; port: number };
  private actionRegistry: ActionRegistry;
  private cueEngine: CueEngine;
  private templateLoader: TemplateLoader;
  private showPersistence: ShowPersistence;
  private modWebSocket?: ModWebSocket;
  private healthManagers: Map<string, DeviceHealthManager> = new Map();
  private cueSequencer: CueSequencer;
  private dashboardWs: DashboardWebSocket;
  private macroEngine: MacroEngine;

  /** HubContext passed to drivers so they can use the shared fade engine */
  readonly hubContext: HubContext;

  constructor(config: HubConfig) {
    this.verbose = config.logging?.verbose ?? false;
    this.healthConfig = {
      enabled: config.health?.enabled ?? false,
      port: config.health?.port ?? 8080,
    };
    this.externalTargets = config.systemsCheck?.externalTargets ?? [];

    this.uiConfig = {
      enabled: config.ui?.enabled ?? false,
      port: config.ui?.port ?? 3001,
    };

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

    // MOD UI: action registry, cue engine, templates, persistence
    this.actionRegistry = new ActionRegistry();
    this.actionRegistry.load();

    this.templateLoader = new TemplateLoader();
    this.templateLoader.load();

    this.showPersistence = new ShowPersistence();

    // Cue engine routes commands through the hub's OSC router
    this.cueEngine = new CueEngine(
      this.actionRegistry,
      (prefix: string, address: string, args: any[]) => {
        this.routeOSC(`${prefix}${address}`, args);
      },
    );

    // Cue sequencer: YAML-driven cue list with direct OSC addresses
    this.cueSequencer = new CueSequencer(
      (address: string, args: any[]) => this.routeOSC(address, args),
      this.verbose,
    );

    // Dashboard WebSocket for live updates
    this.dashboardWs = new DashboardWebSocket();

    // Wire cue sequencer events to dashboard
    this.cueSequencer.on('cue-fired', (index: number, cue: any) => {
      this.dashboardWs.broadcastCueEvent('cue-fired', {
        index,
        cueId: cue.id,
        cueName: cue.name,
      });
    });
    this.cueSequencer.on('cue-complete', (index: number, cue: any) => {
      this.dashboardWs.broadcastCueEvent('cue-complete', { index, cueId: cue.id });
    });
    this.cueSequencer.on('state', (state: CueSequencerState) => {
      this.dashboardWs.broadcastCueEvent('state', { state });
    });

    // Macro engine: config-defined group commands
    this.macroEngine = new MacroEngine(
      (address: string, args: any[]) => this.routeOSC(address, args),
      this.verbose,
    );

    // Load macros from config if provided
    if (config.macros && config.macros.length > 0) {
      this.macroEngine.loadMacros({ macros: config.macros });
    }

    // Register built-in /hub/panic macro
    this.registerPanicMacro();
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
    const transportType = config ? inferTransportType(config.type, config) : 'udp';
    const stats = createDriverStats(
      driver.name,
      prefix,
      transportType,
      config?.host ?? '',
      config?.port ?? 0,
    );
    this.driverStats.set(prefix, stats);
    let firstConnectSeen = false;

    // Create health manager for auto-reconnect and heartbeat monitoring
    const reconnectCfg: Partial<ReconnectConfig> | undefined = config?.reconnect;
    const heartbeatCfg: Partial<HeartbeatConfig> | undefined = config?.heartbeat;
    const healthManager = new DeviceHealthManager(
      driver,
      config?.type ?? 'unknown',
      transportType,
      reconnectCfg,
      heartbeatCfg,
      this.verbose,
    );
    this.healthManagers.set(prefix, healthManager);

    healthManager.on('stateChange', (newState: string, prevState: string) => {
      if (this.verbose) {
        console.log(`[Hub] ${driver.name} health: ${prevState} -> ${newState}`);
      }
    });

    // Wire up feedback: driver emits feedback, hub prepends prefix and sends to OSC clients
    driver.on('feedback', (event: FeedbackEvent) => {
      const fullAddress = `${prefix}${event.address}`;
      this.oscServer.sendToClients(fullAddress, event.args);
      stats.lastMessageReceivedAt = Date.now();
      healthManager.markDataReceived();
      this.dashboardWs.broadcastOscMessage(fullAddress, event.args, 'out');
      if (this.verbose) {
        console.log(`[Hub] Feedback ${driver.name}: ${fullAddress}`);
      }
    });

    driver.on('error', (err: Error) => {
      stats.lastError = err.message;
      stats.lastErrorAt = Date.now();
      console.error(`[Hub] ${driver.name} error: ${err.message}`);
      this.dashboardWs.broadcastDriverState(driver.name, prefix, 'error', err.message);
    });

    driver.on('connected', () => {
      if (firstConnectSeen) stats.reconnectCount++;
      firstConnectSeen = true;
      stats.connected = true;
      stats.lastConnectedAt = Date.now();
      console.log(`[Hub] ${driver.name} connected`);
      this.sendDriverStatus(driver.name, 1);
      this.checkAllReady();
      this.dashboardWs.broadcastDriverState(driver.name, prefix, 'connected');
    });

    driver.on('disconnected', () => {
      stats.connected = false;
      stats.lastDisconnectedAt = Date.now();
      console.warn(`[Hub] ${driver.name} disconnected`);
      this.sendDriverStatus(driver.name, 0);
      this.dashboardWs.broadcastDriverState(driver.name, prefix, 'disconnected');
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

    // Start MOD UI WebSocket server
    if (this.uiConfig.enabled) {
      this.actionRegistry.watch();
      this.modWebSocket = new ModWebSocket(
        { port: this.uiConfig.port },
        this.cueEngine,
        this.actionRegistry,
        this.templateLoader,
        this.showPersistence,
      );
      this.modWebSocket.start();
    }
  }

  /** Stop everything */
  stop(): void {
    console.log('[Hub] Stopping...');
    this.fadeEngine.stop();
    this.oscServer.stop();
    this.cueSequencer.shutdown();
    this.macroEngine.shutdown();
    for (const hm of this.healthManagers.values()) {
      hm.shutdown();
    }
    for (const driver of this.drivers.values()) {
      driver.disconnect();
    }
    this.dashboardWs.stop();
    if (this.healthServer) {
      this.healthServer.close();
      this.healthServer = undefined;
    }
    this.actionRegistry.stopWatching();
    if (this.modWebSocket) {
      this.modWebSocket.stop();
      this.modWebSocket = undefined;
    }
  }

  /** Get health status for all devices */
  getDeviceHealth(): DeviceHealth[] {
    return Array.from(this.healthManagers.values()).map(hm => hm.getHealth());
  }

  /** Get a health manager by prefix (for testing) */
  getHealthManager(prefix: string): DeviceHealthManager | undefined {
    return this.healthManagers.get(prefix.toLowerCase());
  }

  /** Get the cue sequencer (for API/testing) */
  getCueSequencer(): CueSequencer {
    return this.cueSequencer;
  }

  /** Get the macro engine (for API/testing) */
  getMacroEngine(): MacroEngine {
    return this.macroEngine;
  }

  /**
   * Register the built-in /hub/panic macro.
   * Panic stops all fades, stops cue sequencer, and stops all macro timers.
   * Additional device-specific actions can be added via config macros.
   */
  private registerPanicMacro(): void {
    // If a custom /hub/panic macro was loaded from config, leave it as-is
    if (this.macroEngine.hasMacro('/hub/panic')) return;

    // Register a default panic: cancel fades + stop cues
    this.macroEngine.loadMacros({
      macros: [{
        address: '/hub/panic',
        name: 'PANIC',
        actions: [
          { address: '/fade/stop' },        // cancel all fades
          { address: '/hub/stop' },          // stop cue sequencer
        ],
      }],
    });
  }

  /**
   * Handle /hub/* OSC commands for the cue sequencer.
   *
   *   /hub/go                → fire next cue
   *   /hub/go/{cueId}        → fire specific cue
   *   /hub/stop              → stop all pending actions
   *   /hub/back              → move playhead back
   *   /hub/cuelist/load      → load a cue list file (arg[0] = file path)
   *   /hub/status            → request current state (responds via OSC feedback)
   */
  private handleHubCommand(addr: string, args: any[]): void {
    // Normalize arg extraction: OSC args may be { type, value } objects
    const extractString = (a: any): string =>
      typeof a === 'object' && a !== null && a.value !== undefined
        ? String(a.value)
        : String(a);

    if (addr === '/hub/go') {
      this.cueSequencer.go();
      return;
    }

    if (addr.startsWith('/hub/go/')) {
      const cueId = addr.slice('/hub/go/'.length);
      if (cueId) {
        this.cueSequencer.goCue(cueId);
      }
      return;
    }

    if (addr === '/hub/stop') {
      this.cueSequencer.stop();
      return;
    }

    if (addr === '/hub/back') {
      this.cueSequencer.back();
      return;
    }

    if (addr === '/hub/cuelist/load') {
      if (args.length === 0) {
        console.warn('[Hub] /hub/cuelist/load requires a file path argument');
        return;
      }
      const filePath = extractString(args[0]);
      try {
        const { loadCueListFromFile } = require('./cue-sequencer');
        const cueList = loadCueListFromFile(filePath);
        this.cueSequencer.loadCueList(cueList);
      } catch (err: any) {
        console.error(`[Hub] Failed to load cue list: ${err.message}`);
      }
      return;
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
      return;
    }

    // Check if it's a macro (e.g. /hub/panic, /hub/macro/*)
    if (this.macroEngine.execute(addr, args)) {
      return;
    }

    if (this.verbose) {
      console.warn(`[Hub] Unknown hub command: ${addr}`);
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

    // Dashboard OSC monitor (throttled)
    this.dashboardWs.broadcastOscMessage(address, args, 'in');

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

    // Cue sequencer OSC commands: /hub/go, /hub/stop, /hub/back, /hub/status
    if (addr.startsWith('/hub/')) {
      this.handleHubCommand(addr, args);
      return;
    }

    // Macro matching — check before driver prefix matching
    if (this.macroEngine.execute(addr, args)) {
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

      if (req.method === 'GET' && req.url === '/api/health') {
        const deviceHealth = this.getDeviceHealth();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(deviceHealth, null, 2));
        return;
      }

      // Cue sequencer REST API
      if (req.method === 'GET' && req.url === '/api/cues') {
        const state = this.cueSequencer.getState();
        const cueList = this.cueSequencer.getCueList();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ state, cueList }, null, 2));
        return;
      }

      if (req.method === 'POST' && req.url === '/api/cues/go') {
        this.cueSequencer.go();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.cueSequencer.getState()));
        return;
      }

      if (req.method === 'POST' && req.url?.startsWith('/api/cues/go/')) {
        const cueId = req.url.slice('/api/cues/go/'.length);
        if (cueId) {
          this.cueSequencer.goCue(cueId);
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.cueSequencer.getState()));
        return;
      }

      if (req.method === 'POST' && req.url === '/api/cues/stop') {
        this.cueSequencer.stop();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.cueSequencer.getState()));
        return;
      }

      if (req.method === 'POST' && req.url === '/api/cues/back') {
        this.cueSequencer.back();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(this.cueSequencer.getState()));
        return;
      }

      // Macro REST API
      if (req.method === 'GET' && req.url === '/api/macros') {
        const macros = this.macroEngine.getMacros();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(macros, null, 2));
        return;
      }

      if (req.method === 'POST' && req.url?.startsWith('/api/macros/trigger/')) {
        const macroAddr = '/' + req.url.slice('/api/macros/trigger/'.length);
        const executed = this.macroEngine.execute(macroAddr, []);
        if (executed) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ triggered: macroAddr }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `No macro for: ${macroAddr}` }));
        }
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

    // Attach dashboard WebSocket to same HTTP server
    this.dashboardWs.attach(this.healthServer);

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
