/**
 * SystemsCheck — Pre-show active probe of all booth devices
 *
 * Probes registered hub drivers and configurable external targets.
 * Reports pass/fail/warn for each device with latency and details.
 *
 * Triggered via:
 *   - OSC: /system/check
 *   - HTTP: GET /system/check
 *   - CLI: --check
 */

import * as net from 'net';
import { DeviceDriver } from './drivers/device-driver';
import { DriverStats } from './driver-stats';

export interface ProbeTarget {
  name: string;
  host: string;
  port: number;
  protocol: 'tcp' | 'udp';
}

export interface CheckResult {
  name: string;
  type: 'driver' | 'external' | 'osc';
  status: 'pass' | 'fail' | 'warn';
  transport?: string;
  host?: string;
  port?: number;
  latencyMs?: number;
  detail: string;
}

export interface SystemsCheckReport {
  timestamp: string;
  durationMs: number;
  overall: 'pass' | 'fail';
  results: CheckResult[];
  summary: { pass: number; fail: number; warn: number; total: number };
}

export class SystemsCheck {
  private drivers: Map<string, DeviceDriver>;
  private driverStats: Map<string, DriverStats>;
  private externalTargets: ProbeTarget[];
  private oscClientsFn: () => number;

  constructor(
    drivers: Map<string, DeviceDriver>,
    driverStats: Map<string, DriverStats>,
    externalTargets: ProbeTarget[],
    oscClientsFn: () => number,
  ) {
    this.drivers = drivers;
    this.driverStats = driverStats;
    this.externalTargets = externalTargets;
    this.oscClientsFn = oscClientsFn;
  }

  async run(): Promise<SystemsCheckReport> {
    const startTime = Date.now();
    const results: CheckResult[] = [];

    // 1. Check OSC client count (QLab connected?)
    const clientCount = this.oscClientsFn();
    results.push({
      name: 'OSC Clients (QLab)',
      type: 'osc',
      status: clientCount > 0 ? 'pass' : 'warn',
      detail: clientCount > 0
        ? `${clientCount} client(s) connected`
        : 'No OSC clients connected — is QLab sending?',
    });

    // 2. Probe all registered drivers (in parallel)
    const driverProbes = Array.from(this.drivers.entries()).map(
      ([prefix, driver]) => this.probeDriver(prefix, driver),
    );
    results.push(...await Promise.all(driverProbes));

    // 3. Probe external targets (in parallel)
    const externalProbes = this.externalTargets.map(t => this.probeExternal(t));
    results.push(...await Promise.all(externalProbes));

    const durationMs = Date.now() - startTime;
    const summary = {
      pass: results.filter(r => r.status === 'pass').length,
      fail: results.filter(r => r.status === 'fail').length,
      warn: results.filter(r => r.status === 'warn').length,
      total: results.length,
    };

    return {
      timestamp: new Date().toISOString(),
      durationMs,
      overall: summary.fail > 0 ? 'fail' : 'pass',
      results,
      summary,
    };
  }

  private async probeDriver(prefix: string, driver: DeviceDriver): Promise<CheckResult> {
    const stats = this.driverStats.get(prefix);
    const result: CheckResult = {
      name: driver.name,
      type: 'driver',
      transport: stats?.transportType,
      host: stats?.host,
      port: stats?.port,
      status: 'pass',
      detail: '',
    };

    if (driver.isConnected()) {
      result.status = 'pass';
      result.detail = 'Connected';
      return result;
    }

    // Driver reports not connected — attempt an independent TCP probe
    if (stats && (stats.transportType === 'tcp' || stats.transportType === 'websocket')) {
      if (stats.host) {
        const probe = await SystemsCheck.tcpProbe(stats.host, stats.port, 2000);
        if (probe.ok) {
          result.status = 'warn';
          result.latencyMs = probe.latencyMs;
          result.detail = `Port reachable (${probe.latencyMs}ms) but driver not connected`;
        } else {
          result.status = 'fail';
          result.detail = `Unreachable: ${probe.error}`;
        }
      } else {
        result.status = 'fail';
        result.detail = 'Not connected (no host configured)';
      }
    } else if (stats && stats.transportType === 'udp') {
      result.status = 'warn';
      result.detail = 'UDP relay socket not bound';
    } else {
      result.status = 'fail';
      result.detail = 'Not connected';
    }

    return result;
  }

  private async probeExternal(target: ProbeTarget): Promise<CheckResult> {
    const result: CheckResult = {
      name: target.name,
      type: 'external',
      host: target.host,
      port: target.port,
      status: 'pass',
      detail: '',
    };

    const probe = await SystemsCheck.tcpProbe(target.host, target.port, 3000);
    if (probe.ok) {
      result.status = 'pass';
      result.latencyMs = probe.latencyMs;
      result.detail = `Reachable (${probe.latencyMs}ms)`;
    } else {
      result.status = 'fail';
      result.detail = `Unreachable: ${probe.error}`;
    }

    return result;
  }

  /** TCP connect probe with timeout — static for testability */
  static tcpProbe(
    host: string,
    port: number,
    timeoutMs = 2000,
  ): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    return new Promise((resolve) => {
      const start = Date.now();
      const socket = new net.Socket();

      const timer = setTimeout(() => {
        socket.destroy();
        resolve({ ok: false, latencyMs: Date.now() - start, error: 'timeout' });
      }, timeoutMs);

      socket.on('connect', () => {
        clearTimeout(timer);
        const latencyMs = Date.now() - start;
        socket.destroy();
        resolve({ ok: true, latencyMs });
      });

      socket.on('error', (err: Error) => {
        clearTimeout(timer);
        socket.destroy();
        resolve({ ok: false, latencyMs: Date.now() - start, error: err.message });
      });

      socket.connect(port, host);
    });
  }

  /** Format a systems check report for console output */
  static formatConsoleReport(report: SystemsCheckReport): string {
    const lines: string[] = [];
    const ts = report.timestamp.replace('T', ' ').replace(/\.\d+Z$/, '');
    const divider = '========================================';

    lines.push('');
    lines.push(divider);
    lines.push(`  SYSTEMS CHECK — ${ts}`);
    lines.push(divider);
    lines.push('');

    for (const r of report.results) {
      const tag = r.status === 'pass' ? '[PASS]'
        : r.status === 'fail' ? '[FAIL]'
        : '[WARN]';

      const nameCol = r.transport
        ? `${r.name} (${r.transport})`
        : r.name;

      const hostCol = r.host && r.port
        ? `${r.host}:${r.port}`
        : '';

      lines.push(
        `  ${tag.padEnd(8)} ${nameCol.padEnd(28)} ${r.detail.padEnd(30)} ${hostCol}`,
      );
    }

    lines.push('');
    const resultLabel = report.overall === 'pass' ? 'PASS' : 'FAIL';
    lines.push(
      `  RESULT: ${resultLabel} (${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.warn} warn)`,
    );
    lines.push(`  Completed in ${report.durationMs}ms`);
    lines.push(divider);
    lines.push('');

    return lines.join('\n');
  }
}
