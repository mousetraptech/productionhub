/**
 * Status Reporter
 *
 * Builds status snapshots for health endpoints and diagnostics.
 */

import { AvantisOSCServer } from '../osc-server';
import { FadeEngine } from '../fade-engine';
import { DriverStats } from '../driver-stats';
import { DeviceDriver } from '../drivers/device-driver';

export interface StatusSnapshot {
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
}

export interface StatusReporterDeps {
  getDrivers: () => Map<string, DeviceDriver>;
  getDriverStats: () => Map<string, DriverStats>;
  oscServer: AvantisOSCServer;
  fadeEngine: FadeEngine;
  getStartedAt: () => number;
}

export class StatusReporter {
  private deps: StatusReporterDeps;

  constructor(deps: StatusReporterDeps) {
    this.deps = deps;
  }

  getStatus(): StatusSnapshot {
    const startedAt = this.deps.getStartedAt();
    const uptimeMs = Date.now() - startedAt;
    const uptimeSec = Math.floor(uptimeMs / 1000);

    const drivers = this.deps.getDrivers();
    const driverStats = this.deps.getDriverStats();

    const driverStatuses = Array.from(drivers.entries()).map(([prefix, d]) => {
      const stats = driverStats.get(prefix);
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
      oscPort: (this.deps.oscServer as any)['options'].localPort,
      oscClients: this.deps.oscServer.clientCount,
      oscClientList: this.deps.oscServer.getClients(),
      drivers: driverStatuses,
      fades: {
        activeCount: this.deps.fadeEngine.activeCount,
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
