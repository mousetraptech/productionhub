import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as net from 'net';
import { EventEmitter } from 'events';
import { SystemsCheck, ProbeTarget, SystemsCheckReport, CheckResult } from '../systems-check';
import { DeviceDriver, HubContext, FeedbackEvent } from '../drivers/device-driver';
import { DriverStats, createDriverStats } from '../driver-stats';

// --- Mock driver ---

class MockDeviceDriver extends EventEmitter implements DeviceDriver {
  readonly name: string;
  readonly prefix: string;
  private _connected: boolean;

  constructor(name: string, prefix: string, connected: boolean) {
    super();
    this.name = name;
    this.prefix = prefix;
    this._connected = connected;
  }

  connect(): void {}
  disconnect(): void {}
  isConnected(): boolean { return this._connected; }
  handleOSC(_address: string, _args: any[]): void {}
  handleFadeTick(_key: string, _value: number): void {}
}

// --- TCP probe tests ---

describe('SystemsCheck.tcpProbe', () => {
  let server: net.Server;
  let serverPort: number;

  before((_, done) => {
    server = net.createServer(() => {});
    server.listen(0, '127.0.0.1', () => {
      serverPort = (server.address() as net.AddressInfo).port;
      done();
    });
  });

  after((_, done) => {
    server.close(done);
  });

  it('should return ok:true when a server is listening', async () => {
    const result = await SystemsCheck.tcpProbe('127.0.0.1', serverPort, 2000);
    assert.equal(result.ok, true);
    assert.ok(result.latencyMs >= 0);
    assert.equal(result.error, undefined);
  });

  it('should return ok:false with ECONNREFUSED when nothing is listening', async () => {
    const result = await SystemsCheck.tcpProbe('127.0.0.1', 19999, 2000);
    assert.equal(result.ok, false);
    assert.ok(result.error);
    assert.ok(result.error!.includes('ECONNREFUSED'));
  });

  it('should respect the timeout', async () => {
    // Use a non-routable address to trigger timeout
    const start = Date.now();
    const result = await SystemsCheck.tcpProbe('192.0.2.1', 9999, 500);
    const elapsed = Date.now() - start;
    assert.equal(result.ok, false);
    // Should complete close to timeout (within 200ms tolerance)
    assert.ok(elapsed < 1000, `Probe took ${elapsed}ms, expected ~500ms`);
  });
});

// --- Driver probe tests ---

describe('SystemsCheck driver probes', () => {
  it('should return pass for a connected driver', async () => {
    const driver = new MockDeviceDriver('avantis', '/avantis', true);
    const drivers = new Map<string, DeviceDriver>([['/avantis', driver]]);
    const stats = new Map<string, DriverStats>([
      ['/avantis', createDriverStats('avantis', '/avantis', 'tcp', '192.168.1.70', 51325)],
    ]);

    const checker = new SystemsCheck(drivers, stats, [], () => 1);
    const report = await checker.run();

    const driverResult = report.results.find(r => r.name === 'avantis');
    assert.ok(driverResult);
    assert.equal(driverResult.status, 'pass');
    assert.equal(driverResult.detail, 'Connected');
  });

  it('should return fail for a disconnected TCP driver with unreachable host', async () => {
    const driver = new MockDeviceDriver('visca', '/cam1', false);
    const drivers = new Map<string, DeviceDriver>([['/cam1', driver]]);
    const stats = new Map<string, DriverStats>([
      ['/cam1', createDriverStats('visca', '/cam1', 'tcp', '127.0.0.1', 19998)],
    ]);

    const checker = new SystemsCheck(drivers, stats, [], () => 1);
    const report = await checker.run();

    const driverResult = report.results.find(r => r.name === 'visca');
    assert.ok(driverResult);
    assert.equal(driverResult.status, 'fail');
    assert.ok(driverResult.detail.includes('Unreachable'));
  });

  it('should return warn for a disconnected TCP driver with reachable port', async () => {
    // Start a temporary server
    const server = net.createServer(() => {});
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    try {
      const driver = new MockDeviceDriver('obs', '/obs', false);
      const drivers = new Map<string, DeviceDriver>([['/obs', driver]]);
      const stats = new Map<string, DriverStats>([
        ['/obs', createDriverStats('obs', '/obs', 'websocket', '127.0.0.1', port)],
      ]);

      const checker = new SystemsCheck(drivers, stats, [], () => 1);
      const report = await checker.run();

      const driverResult = report.results.find(r => r.name === 'obs');
      assert.ok(driverResult);
      assert.equal(driverResult.status, 'warn');
      assert.ok(driverResult.detail.includes('reachable'));
      assert.ok(driverResult.detail.includes('not connected'));
    } finally {
      server.close();
    }
  });

  it('should return pass for a connected UDP driver', async () => {
    const driver = new MockDeviceDriver('chamsys', '/lights', true);
    const drivers = new Map<string, DeviceDriver>([['/lights', driver]]);
    const stats = new Map<string, DriverStats>([
      ['/lights', createDriverStats('chamsys', '/lights', 'udp', '192.168.1.71', 7000)],
    ]);

    const checker = new SystemsCheck(drivers, stats, [], () => 1);
    const report = await checker.run();

    const driverResult = report.results.find(r => r.name === 'chamsys');
    assert.ok(driverResult);
    assert.equal(driverResult.status, 'pass');
  });

  it('should return warn for a disconnected UDP driver', async () => {
    const driver = new MockDeviceDriver('chamsys', '/lights', false);
    const drivers = new Map<string, DeviceDriver>([['/lights', driver]]);
    const stats = new Map<string, DriverStats>([
      ['/lights', createDriverStats('chamsys', '/lights', 'udp', '192.168.1.71', 7000)],
    ]);

    const checker = new SystemsCheck(drivers, stats, [], () => 1);
    const report = await checker.run();

    const driverResult = report.results.find(r => r.name === 'chamsys');
    assert.ok(driverResult);
    assert.equal(driverResult.status, 'warn');
    assert.ok(driverResult.detail.includes('UDP'));
  });
});

// --- External probe tests ---

describe('SystemsCheck external probes', () => {
  it('should return pass for a reachable external target', async () => {
    const server = net.createServer(() => {});
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as net.AddressInfo).port;

    try {
      const targets: ProbeTarget[] = [
        { name: 'Test Server', host: '127.0.0.1', port, protocol: 'tcp' },
      ];

      const checker = new SystemsCheck(new Map(), new Map(), targets, () => 0);
      const report = await checker.run();

      const extResult = report.results.find(r => r.name === 'Test Server');
      assert.ok(extResult);
      assert.equal(extResult.status, 'pass');
      assert.ok(extResult.latencyMs !== undefined);
      assert.ok(extResult.detail.includes('Reachable'));
    } finally {
      server.close();
    }
  });

  it('should return fail for an unreachable external target', async () => {
    const targets: ProbeTarget[] = [
      { name: 'Dead Server', host: '127.0.0.1', port: 19997, protocol: 'tcp' },
    ];

    const checker = new SystemsCheck(new Map(), new Map(), targets, () => 0);
    const report = await checker.run();

    const extResult = report.results.find(r => r.name === 'Dead Server');
    assert.ok(extResult);
    assert.equal(extResult.status, 'fail');
    assert.ok(extResult.detail.includes('Unreachable'));
  });
});

// --- Full run tests ---

describe('SystemsCheck full run', () => {
  it('should report overall pass when all drivers connected', async () => {
    const d1 = new MockDeviceDriver('avantis', '/avantis', true);
    const d2 = new MockDeviceDriver('chamsys', '/lights', true);
    const drivers = new Map<string, DeviceDriver>([
      ['/avantis', d1],
      ['/lights', d2],
    ]);
    const stats = new Map<string, DriverStats>([
      ['/avantis', createDriverStats('avantis', '/avantis', 'tcp', '192.168.1.70', 51325)],
      ['/lights', createDriverStats('chamsys', '/lights', 'udp', '192.168.1.71', 7000)],
    ]);

    const checker = new SystemsCheck(drivers, stats, [], () => 2);
    const report = await checker.run();

    assert.equal(report.overall, 'pass');
    assert.equal(report.summary.pass, 3); // 2 drivers + 1 OSC clients
    assert.equal(report.summary.fail, 0);
  });

  it('should report overall fail when a driver is disconnected and unreachable', async () => {
    const d1 = new MockDeviceDriver('avantis', '/avantis', true);
    const d2 = new MockDeviceDriver('obs', '/obs', false);
    const drivers = new Map<string, DeviceDriver>([
      ['/avantis', d1],
      ['/obs', d2],
    ]);
    const stats = new Map<string, DriverStats>([
      ['/avantis', createDriverStats('avantis', '/avantis', 'tcp', '192.168.1.70', 51325)],
      ['/obs', createDriverStats('obs', '/obs', 'websocket', '127.0.0.1', 19996)],
    ]);

    const checker = new SystemsCheck(drivers, stats, [], () => 1);
    const report = await checker.run();

    assert.equal(report.overall, 'fail');
    assert.ok(report.summary.fail > 0);
  });

  it('should include warn for zero OSC clients', async () => {
    const checker = new SystemsCheck(new Map(), new Map(), [], () => 0);
    const report = await checker.run();

    const oscResult = report.results.find(r => r.type === 'osc');
    assert.ok(oscResult);
    assert.equal(oscResult.status, 'warn');
    assert.ok(oscResult.detail.includes('No OSC clients'));
  });

  it('should include pass for nonzero OSC clients', async () => {
    const checker = new SystemsCheck(new Map(), new Map(), [], () => 3);
    const report = await checker.run();

    const oscResult = report.results.find(r => r.type === 'osc');
    assert.ok(oscResult);
    assert.equal(oscResult.status, 'pass');
    assert.ok(oscResult.detail.includes('3 client(s)'));
  });

  it('should measure duration', async () => {
    const checker = new SystemsCheck(new Map(), new Map(), [], () => 0);
    const report = await checker.run();

    assert.ok(report.durationMs >= 0);
    assert.ok(report.timestamp);
  });

  it('should compute summary counts correctly', async () => {
    const d1 = new MockDeviceDriver('avantis', '/avantis', true);
    const d2 = new MockDeviceDriver('chamsys', '/lights', false);
    const drivers = new Map<string, DeviceDriver>([
      ['/avantis', d1],
      ['/lights', d2],
    ]);
    const stats = new Map<string, DriverStats>([
      ['/avantis', createDriverStats('avantis', '/avantis', 'tcp', '192.168.1.70', 51325)],
      ['/lights', createDriverStats('chamsys', '/lights', 'udp', '192.168.1.71', 7000)],
    ]);

    const checker = new SystemsCheck(drivers, stats, [], () => 1);
    const report = await checker.run();

    assert.equal(report.summary.total, 3); // OSC + 2 drivers
    assert.equal(report.summary.pass, 2); // OSC clients + avantis
    assert.equal(report.summary.warn, 1); // chamsys UDP not bound
    assert.equal(report.summary.fail, 0);
  });
});

// --- Console report formatting tests ---

describe('SystemsCheck.formatConsoleReport', () => {
  it('should include PASS/FAIL markers', () => {
    const report: SystemsCheckReport = {
      timestamp: '2026-02-09T18:30:00.000Z',
      durationMs: 45,
      overall: 'fail',
      results: [
        { name: 'avantis', type: 'driver', status: 'pass', transport: 'tcp', host: '192.168.1.70', port: 51325, detail: 'Connected' },
        { name: 'obs', type: 'driver', status: 'fail', transport: 'websocket', host: '127.0.0.1', port: 4455, detail: 'Unreachable: ECONNREFUSED' },
        { name: 'OSC Clients (QLab)', type: 'osc', status: 'warn', detail: 'No OSC clients connected' },
      ],
      summary: { pass: 1, fail: 1, warn: 1, total: 3 },
    };

    const output = SystemsCheck.formatConsoleReport(report);
    assert.ok(output.includes('[PASS]'));
    assert.ok(output.includes('[FAIL]'));
    assert.ok(output.includes('[WARN]'));
    assert.ok(output.includes('RESULT: FAIL'));
    assert.ok(output.includes('1 pass'));
    assert.ok(output.includes('1 fail'));
    assert.ok(output.includes('1 warn'));
    assert.ok(output.includes('45ms'));
  });

  it('should include host:port details', () => {
    const report: SystemsCheckReport = {
      timestamp: '2026-02-09T18:30:00.000Z',
      durationMs: 10,
      overall: 'pass',
      results: [
        { name: 'avantis', type: 'driver', status: 'pass', transport: 'tcp', host: '192.168.1.70', port: 51325, detail: 'Connected' },
      ],
      summary: { pass: 1, fail: 0, warn: 0, total: 1 },
    };

    const output = SystemsCheck.formatConsoleReport(report);
    assert.ok(output.includes('192.168.1.70:51325'));
  });

  it('should show RESULT: PASS for all-pass report', () => {
    const report: SystemsCheckReport = {
      timestamp: '2026-02-09T18:30:00.000Z',
      durationMs: 10,
      overall: 'pass',
      results: [
        { name: 'test', type: 'driver', status: 'pass', detail: 'Connected' },
      ],
      summary: { pass: 1, fail: 0, warn: 0, total: 1 },
    };

    const output = SystemsCheck.formatConsoleReport(report);
    assert.ok(output.includes('RESULT: PASS'));
  });
});
