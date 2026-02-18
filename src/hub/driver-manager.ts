/**
 * Driver Manager
 *
 * Manages device driver registration, prefix-based routing, and lifecycle.
 * Extracted from ProductionHub to improve modularity.
 */

import { DeviceDriver, DeviceConfig, FeedbackEvent, HubContext } from '../drivers/device-driver';
import { DriverStats, createDriverStats, inferTransportType } from '../driver-stats';
import { DeviceHealthManager, DeviceHealth, ReconnectConfig, HeartbeatConfig } from '../health';
import { AvantisOSCServer } from '../osc-server';
import { DashboardWebSocket } from '../server/dashboard-ws';
import { getLogger } from '../logger';

const log = getLogger('DriverManager');

export interface DriverManagerDeps {
  oscServer: AvantisOSCServer;
  dashboardWs: DashboardWebSocket;
  verbose: boolean;
}

export class DriverManager {
  private drivers: Map<string, DeviceDriver> = new Map();
  private driverStats: Map<string, DriverStats> = new Map();
  private sortedPrefixes: string[] = [];
  private healthManagers: Map<string, DeviceHealthManager> = new Map();
  private oscServer: AvantisOSCServer;
  private dashboardWs: DashboardWebSocket;
  private verbose: boolean;

  // Callbacks wired by hub
  private onDriverReady?: () => void;
  private onDriverStatus?: (name: string, status: number) => void;

  constructor(deps: DriverManagerDeps) {
    this.oscServer = deps.oscServer;
    this.dashboardWs = deps.dashboardWs;
    this.verbose = deps.verbose;
  }

  /** Set callback for when all drivers are ready */
  setOnDriverReady(callback: () => void): void {
    this.onDriverReady = callback;
  }

  /** Set callback for driver status changes */
  setOnDriverStatus(callback: (name: string, status: number) => void): void {
    this.onDriverStatus = callback;
  }

  /** Register a device driver */
  addDriver(driver: DeviceDriver, config?: DeviceConfig): void {
    const prefix = driver.prefix.toLowerCase();
    if (this.drivers.has(prefix)) {
      throw new Error(`Duplicate driver prefix: ${prefix}`);
    }

    this.drivers.set(prefix, driver);
    this.sortedPrefixes = Array.from(this.drivers.keys())
      .sort((a, b) => b.length - a.length);

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
        log.debug({ driver: driver.name, prevState, newState }, 'Health state change');
      }
    });

    driver.on('feedback', (event: FeedbackEvent) => {
      const fullAddress = `${prefix}${event.address}`;
      this.oscServer.sendToClients(fullAddress, event.args);
      stats.lastMessageReceivedAt = Date.now();
      healthManager.markDataReceived();
      this.dashboardWs.broadcastOscMessage(fullAddress, event.args, 'out');

      // Broadcast device state for UI updates
      const driverAny = driver as any;
      if (typeof driverAny.getState === 'function') {
        const state = driverAny.getState();
        this.dashboardWs.broadcastDeviceState(prefix, config?.type ?? 'unknown', state);
      }

      if (this.verbose) {
        log.debug({ driver: driver.name, address: fullAddress }, 'Feedback');
      }
    });

    driver.on('error', (err: Error) => {
      stats.lastError = err.message;
      stats.lastErrorAt = Date.now();
      log.error({ driver: driver.name, error: err.message }, 'Driver error');
      this.dashboardWs.broadcastDriverState(driver.name, prefix, 'error', err.message);
    });

    driver.on('connected', () => {
      if (firstConnectSeen) stats.reconnectCount++;
      firstConnectSeen = true;
      stats.connected = true;
      stats.lastConnectedAt = Date.now();
      log.info({ driver: driver.name }, 'Driver connected');
      this.onDriverStatus?.(driver.name, 1);
      this.checkAllReady();
      this.dashboardWs.broadcastDriverState(driver.name, prefix, 'connected');
    });

    driver.on('disconnected', () => {
      stats.connected = false;
      stats.lastDisconnectedAt = Date.now();
      log.warn({ driver: driver.name }, 'Driver disconnected');
      this.onDriverStatus?.(driver.name, 0);
      this.dashboardWs.broadcastDriverState(driver.name, prefix, 'disconnected');
    });

    if (this.verbose) {
      log.debug({ driver: driver.name, prefix }, 'Registered driver');
    }
  }

  /** Route OSC to the matching driver */
  routeToDriver(address: string, args: any[]): boolean {
    const addrLower = address.toLowerCase();

    for (const prefix of this.sortedPrefixes) {
      if (addrLower.startsWith(prefix + '/') || addrLower === prefix) {
        const driver = this.drivers.get(prefix)!;
        // Preserve original case in remainder (scene names, etc.)
        const remainder = address.slice(prefix.length) || '/';
        if (this.verbose) {
          log.debug({ address, driver: driver.name, remainder }, 'Routing OSC');
        }
        driver.handleOSC(remainder, args);
        return true;
      }
    }
    return false;
  }

  /**
   * Route unprefixed device feedback to any driver that claims it.
   * Called when routeToDriver() fails — gives drivers a chance to
   * handle bare protocol addresses (e.g. /pb/1 from a ChamSys QuickQ).
   */
  routeFeedback(address: string, args: any[]): boolean {
    for (const driver of this.drivers.values()) {
      if (typeof driver.handleFeedback === 'function') {
        if (driver.handleFeedback(address, args)) {
          return true;
        }
      }
    }
    return false;
  }

  /** Route a fade tick to the correct driver */
  routeFadeTick(key: string, value: number): void {
    const colonIdx = key.indexOf(':');
    if (colonIdx === -1) {
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

  /** Connect all drivers */
  connectAll(): void {
    for (const driver of this.drivers.values()) {
      driver.connect();
    }
  }

  /** Disconnect all drivers */
  disconnectAll(): void {
    for (const driver of this.drivers.values()) {
      driver.disconnect();
    }
  }

  /** Shutdown all health managers */
  shutdownHealthManagers(): void {
    for (const hm of this.healthManagers.values()) {
      hm.shutdown();
    }
  }

  /** Check if all drivers are ready and notify */
  private checkAllReady(): void {
    if (this.drivers.size === 0) return;
    for (const driver of this.drivers.values()) {
      if (!driver.isConnected()) return;
    }
    log.info('All drivers connected — system ready');
    this.onDriverReady?.();
  }

  // --- Accessors ---

  getDriver(name: string): DeviceDriver | undefined {
    for (const driver of this.drivers.values()) {
      if (driver.name === name) return driver;
    }
    return undefined;
  }

  getDriverByPrefix(prefix: string): DeviceDriver | undefined {
    return this.drivers.get(prefix.toLowerCase());
  }

  getDriverNames(): string[] {
    return Array.from(this.drivers.values()).map(d => d.name);
  }

  getDrivers(): Map<string, DeviceDriver> {
    return this.drivers;
  }

  getDriverStats(): Map<string, DriverStats> {
    return this.driverStats;
  }

  getHealthManager(prefix: string): DeviceHealthManager | undefined {
    return this.healthManagers.get(prefix.toLowerCase());
  }

  getAllHealthManagers(): Map<string, DeviceHealthManager> {
    return this.healthManagers;
  }

  getDeviceHealth(): DeviceHealth[] {
    return Array.from(this.healthManagers.values()).map(hm => hm.getHealth());
  }

  getSortedPrefixes(): string[] {
    return this.sortedPrefixes;
  }
}
