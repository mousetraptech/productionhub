/**
 * ProductionHub
 *
 * Central orchestrator for multi-device production control.
 * Owns the single OSC server and shared FadeEngine.
 * Routes incoming OSC messages to device drivers by prefix.
 * Collects feedback from drivers and relays to OSC clients.
 */

import { AvantisOSCServer } from './osc-server';
import { FadeEngine } from './fade-engine';
import { DeviceDriver, DeviceConfig, HubContext, DriverFadeRequest } from './drivers/device-driver';
import { DriverStats } from './driver-stats';
import { SystemsCheck, ProbeTarget, SystemsCheckReport } from './systems-check';
import { PreshowChecklist } from './preshow-checklist';
import { ActionRegistry } from './actions/registry';
import { CueEngine } from './cue-engine/engine';
import { TemplateLoader } from './shows/templates';
import { ShowPersistence } from './cue-engine/persistence';
import { ModWebSocket } from './server/websocket';
import { DeviceHealthManager, DeviceHealth } from './health';
import { CueSequencer, CueSequencerState } from './cue-sequencer';
import { DashboardWebSocket } from './server/dashboard-ws';
import { MacroEngine, MacroDef } from './macros';
import { DriverManager, HubHttpServer, CommandRouter, StatusReporter, StatusSnapshot } from './hub/index';
import { BrainService } from './brain/brain-service';
import { BrainConfig } from './brain/types';
import { DeckPersistence } from './deck/persistence';
import { getLogger } from './logger';

const log = getLogger('Hub');

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
  brain?: BrainConfig;
}

export class ProductionHub {
  private oscServer: AvantisOSCServer;
  private fadeEngine: FadeEngine;
  private verbose: boolean;
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
  private cueSequencer: CueSequencer;
  private dashboardWs: DashboardWebSocket;
  private macroEngine: MacroEngine;
  private brainService?: BrainService;

  // Extracted modules
  private driverManager: DriverManager;
  private httpServer: HubHttpServer;
  private commandRouter: CommandRouter;
  private statusReporter: StatusReporter;

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

    // Dashboard WebSocket for live updates
    this.dashboardWs = new DashboardWebSocket();

    // Driver manager
    this.driverManager = new DriverManager({
      oscServer: this.oscServer,
      dashboardWs: this.dashboardWs,
      verbose: this.verbose,
    });

    // Wire driver manager callbacks
    this.driverManager.setOnDriverReady(() => {
      this.oscServer.sendToClients('/system/ready', [{ type: 'i', value: 1 }]);
      log.info('All drivers connected — system ready');
    });

    this.driverManager.setOnDriverStatus((name, status) => {
      this.sendDriverStatus(name, status);
    });

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

    // Booth Brain AI assistant
    if (config.brain?.enabled) {
      this.brainService = new BrainService(
        config.brain,
        this.actionRegistry,
        this.cueEngine,
        (address, args) => this.routeOSC(address, args),
        () => this.getDeviceStatesSnapshot(),
      );
    }

    // Command router for /hub/* commands
    this.commandRouter = new CommandRouter({
      cueSequencer: this.cueSequencer,
      macroEngine: this.macroEngine,
      oscServer: this.oscServer,
      verbose: this.verbose,
    });

    // Status reporter for health endpoints
    this.statusReporter = new StatusReporter({
      getDrivers: () => this.driverManager.getDrivers(),
      getDriverStats: () => this.driverManager.getDriverStats(),
      oscServer: this.oscServer,
      fadeEngine: this.fadeEngine,
      getStartedAt: () => this.startedAt,
    });

    // HTTP server for health/API endpoints
    this.httpServer = new HubHttpServer({
      getStatus: () => this.statusReporter.getStatus(),
      getDeviceHealth: () => this.driverManager.getDeviceHealth(),
      getCueSequencer: () => this.cueSequencer,
      getMacroEngine: () => this.macroEngine,
      getChecklist: () => this.checklist,
      getDrivers: () => this.driverManager.getDrivers(),
      runSystemsCheck: () => this.runSystemsCheck(),
      routeOSC: (address, args) => this.routeOSC(address, args),
      getDevices: () => Array.from(this.driverManager.getDrivers().values()).map(d => ({ type: d.name, prefix: d.prefix })),
      dashboardWs: this.dashboardWs,
    });
  }

  /** Register a device driver with the hub */
  addDriver(driver: DeviceDriver, config?: DeviceConfig): void {
    this.driverManager.addDriver(driver, config);
  }

  /** Start the hub: OSC server, fade engine, and all drivers */
  start(): void {
    log.info('Starting Production Hub...');
    log.info({ address: this.oscServer['options'].localAddress, port: this.oscServer['options'].localPort }, 'OSC server');
    log.info({ drivers: this.driverManager.getDriverNames() }, 'Registered drivers');

    // Catch OSC server errors (malformed packets etc.) so they don't crash the process
    this.oscServer.on('error', (err: Error) => {
      log.warn({ err: err.message }, 'OSC server error (non-fatal)');
    });

    // Wire OSC incoming messages to prefix router
    this.oscServer.onRawMessage((address, args, info) => {
      if (this.verbose) {
        const argStr = args.map((a: any) => a?.value ?? a).join(', ');
        log.debug({ address, args: argStr, from: `${info?.address}:${info?.port}` }, 'OSC in');
      }
      this.routeOSC(address, args);
    });

    // Wire fade engine ticks to the right driver
    this.fadeEngine.on('value', (key: string, value: number) => {
      this.driverManager.routeFadeTick(key, value);
    });

    this.fadeEngine.on('fadeComplete', (key: string) => {
      if (this.verbose) {
        log.debug({ key }, 'Fade complete');
      }
    });

    // Start everything
    this.oscServer.start();
    this.fadeEngine.start();
    this.startedAt = Date.now();

    this.driverManager.connectAll();

    // Start health check HTTP server
    if (this.healthConfig.enabled) {
      this.httpServer.start(this.healthConfig.port);
    }

    // Start MOD UI WebSocket server
    if (this.uiConfig.enabled) {
      this.actionRegistry.watch();
      const deckPersistence = new DeckPersistence();
      this.modWebSocket = new ModWebSocket(
        { port: this.uiConfig.port },
        this.cueEngine,
        this.actionRegistry,
        this.templateLoader,
        this.showPersistence,
        (address, args) => this.routeOSC(address, args),
        this.brainService,
        deckPersistence,
      );
      this.modWebSocket.start();
    }
  }

  /** Stop everything */
  stop(): void {
    log.info('Stopping...');
    this.fadeEngine.stop();
    this.oscServer.stop();
    this.cueSequencer.shutdown();
    this.macroEngine.shutdown();
    this.driverManager.shutdownHealthManagers();
    this.driverManager.disconnectAll();
    this.dashboardWs.stop();
    this.httpServer.stop();
    this.actionRegistry.stopWatching();
    if (this.modWebSocket) {
      this.modWebSocket.stop();
      this.modWebSocket = undefined;
    }
  }

  /** Get health status for all devices */
  getDeviceHealth(): DeviceHealth[] {
    return this.driverManager.getDeviceHealth();
  }

  /** Get a health manager by prefix (for testing) */
  getHealthManager(prefix: string): DeviceHealthManager | undefined {
    return this.driverManager.getHealthManager(prefix);
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
   */
  private registerPanicMacro(): void {
    if (this.macroEngine.hasMacro('/hub/panic')) return;

    this.macroEngine.loadMacros({
      macros: [{
        address: '/hub/panic',
        name: 'PANIC',
        actions: [
          { address: '/fade/stop' },
          { address: '/hub/stop' },
        ],
      }],
    });
  }

  /**
   * Route an incoming OSC address+args to the correct driver.
   */
  routeOSC(address: string, args: any[]): void {
    const addr = address.toLowerCase();

    // Dashboard OSC monitor
    this.dashboardWs.broadcastOscMessage(address, args, 'in');

    // Global fade stop
    if (addr === '/fade/stop') {
      if (args.length > 0) {
        const key = typeof args[0] === 'object' && args[0].value !== undefined
          ? String(args[0].value)
          : String(args[0]);
        this.fadeEngine.cancelFade(key, true);
        if (this.verbose) log.debug({ key }, 'Fade stopped');
      } else {
        this.fadeEngine.cancelAll();
        if (this.verbose) log.debug('All fades stopped');
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

    // Hub commands (/hub/go, /hub/stop, etc.)
    if (this.commandRouter.handle(addr, args)) {
      return;
    }

    // Macro matching
    if (this.macroEngine.execute(addr, args)) {
      return;
    }

    // Driver routing (pass original address to preserve case for scene names, etc.)
    if (this.driverManager.routeToDriver(address, args)) {
      return;
    }

    // Unprefixed device feedback (e.g. bare /pb/1 from a ChamSys QuickQ)
    if (this.driverManager.routeFeedback(address, args)) {
      return;
    }

    log.warn({ address }, 'No driver matched');
  }

  /** Run a full systems check */
  async runSystemsCheck(): Promise<SystemsCheckReport> {
    const checker = new SystemsCheck(
      this.driverManager.getDrivers(),
      this.driverManager.getDriverStats(),
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

  /** Get the OSC server instance (for testing) */
  getOSCServer(): AvantisOSCServer {
    return this.oscServer;
  }

  /** Get a driver by name (for testing) */
  getDriver(name: string): DeviceDriver | undefined {
    return this.driverManager.getDriver(name);
  }

  /** Get all registered driver names */
  getDriverNames(): string[] {
    return this.driverManager.getDriverNames();
  }

  /** Get the driver stats map (for testing) */
  getDriverStats(): Map<string, DriverStats> {
    return this.driverManager.getDriverStats();
  }

  /** Get a snapshot of all device states for Brain context */
  private getDeviceStatesSnapshot(): Record<string, any> {
    const states: Record<string, any> = {};
    for (const driver of this.driverManager.getDrivers().values()) {
      if ('getState' in driver && typeof (driver as any).getState === 'function') {
        states[driver.name] = (driver as any).getState();
      }
    }
    return states;
  }

  /** Build a status snapshot for the health endpoint */
  getStatus(): StatusSnapshot {
    return this.statusReporter.getStatus();
  }
}
