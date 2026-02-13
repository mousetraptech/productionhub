import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import * as http from 'http';
import { WebSocket } from 'ws';
import { setTimeout as delay } from 'node:timers/promises';
import { DashboardWebSocket } from '../server/dashboard-ws';

function createTestServer(): { server: http.Server; dashWs: DashboardWebSocket; port: number } {
  const server = http.createServer((_req, res) => {
    res.writeHead(200);
    res.end('ok');
  });
  const dashWs = new DashboardWebSocket();
  dashWs.attach(server);

  // Use port 0 for random available port
  server.listen(0);
  const addr = server.address() as { port: number };
  return { server, dashWs, port: addr.port };
}

async function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

async function nextMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for message')), 2000);
    ws.once('message', (data: Buffer) => {
      clearTimeout(timeout);
      resolve(JSON.parse(data.toString()));
    });
  });
}

function cleanup(server: http.Server, dashWs: DashboardWebSocket, ...clients: WebSocket[]) {
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.close();
  }
  dashWs.stop();
  server.close();
}

describe('DashboardWebSocket', () => {
  let server: http.Server;
  let dashWs: DashboardWebSocket;
  let port: number;

  beforeEach(() => {
    const t = createTestServer();
    server = t.server;
    dashWs = t.dashWs;
    port = t.port;
  });

  afterEach(() => {
    dashWs.stop();
    server.close();
  });

  describe('Connection', () => {
    it('should accept WebSocket connections', async () => {
      const client = await connectClient(port);
      assert.strictEqual(client.readyState, WebSocket.OPEN);
      assert.strictEqual(dashWs.clientCount, 1);
      client.close();
      await delay(50);
    });

    it('should track multiple clients', async () => {
      const c1 = await connectClient(port);
      const c2 = await connectClient(port);
      assert.strictEqual(dashWs.clientCount, 2);
      c1.close();
      c2.close();
      await delay(50);
    });

    it('should update count when client disconnects', async () => {
      const client = await connectClient(port);
      assert.strictEqual(dashWs.clientCount, 1);
      client.close();
      await delay(100);
      assert.strictEqual(dashWs.clientCount, 0);
    });
  });

  describe('Broadcasting', () => {
    it('should broadcast driver state changes to clients', async () => {
      const client = await connectClient(port);
      const msgPromise = nextMessage(client);

      dashWs.broadcastDriverState('avantis', '/avantis', 'connected');

      const msg = await msgPromise;
      assert.strictEqual(msg.type, 'driver-state');
      assert.strictEqual(msg.driver, 'avantis');
      assert.strictEqual(msg.prefix, '/avantis');
      assert.strictEqual(msg.state, 'connected');
      assert.ok(msg.timestamp);

      client.close();
      await delay(50);
    });

    it('should broadcast driver state with detail', async () => {
      const client = await connectClient(port);
      const msgPromise = nextMessage(client);

      dashWs.broadcastDriverState('obs', '/obs', 'error', 'ECONNREFUSED');

      const msg = await msgPromise;
      assert.strictEqual(msg.state, 'error');
      assert.strictEqual(msg.detail, 'ECONNREFUSED');

      client.close();
      await delay(50);
    });

    it('should broadcast cue events to clients', async () => {
      const client = await connectClient(port);
      const msgPromise = nextMessage(client);

      dashWs.broadcastCueEvent('cue-fired', { index: 0, cueId: 'cue1', cueName: 'First Cue' });

      const msg = await msgPromise;
      assert.strictEqual(msg.type, 'cue-event');
      assert.strictEqual(msg.event, 'cue-fired');
      assert.strictEqual(msg.index, 0);
      assert.strictEqual(msg.cueId, 'cue1');
      assert.ok(msg.timestamp);

      client.close();
      await delay(50);
    });

    it('should broadcast OSC messages to clients', async () => {
      const client = await connectClient(port);
      const msgPromise = nextMessage(client);

      dashWs.broadcastOscMessage('/avantis/dca/1/fader', [{ type: 'f', value: 0.75 }], 'in');

      const msg = await msgPromise;
      assert.strictEqual(msg.type, 'osc');
      assert.strictEqual(msg.address, '/avantis/dca/1/fader');
      assert.deepStrictEqual(msg.args, [0.75]);
      assert.strictEqual(msg.direction, 'in');

      client.close();
      await delay(50);
    });

    it('should broadcast to multiple clients', async () => {
      const c1 = await connectClient(port);
      const c2 = await connectClient(port);

      const p1 = nextMessage(c1);
      const p2 = nextMessage(c2);

      dashWs.broadcastDriverState('test', '/test', 'connected');

      const [m1, m2] = await Promise.all([p1, p2]);
      assert.strictEqual(m1.type, 'driver-state');
      assert.strictEqual(m2.type, 'driver-state');

      c1.close();
      c2.close();
      await delay(50);
    });

    it('should extract values from OSC arg objects', async () => {
      const client = await connectClient(port);
      const msgPromise = nextMessage(client);

      dashWs.broadcastOscMessage('/test', [
        { type: 'i', value: 42 },
        { type: 's', value: 'hello' },
        0.5,
      ], 'out');

      const msg = await msgPromise;
      assert.deepStrictEqual(msg.args, [42, 'hello', 0.5]);

      client.close();
      await delay(50);
    });
  });

  describe('OSC throttling', () => {
    it('should throttle rapid OSC messages', async () => {
      const client = await connectClient(port);
      const messages: any[] = [];
      client.on('message', (data: Buffer) => {
        messages.push(JSON.parse(data.toString()));
      });

      // Send many OSC messages rapidly
      for (let i = 0; i < 10; i++) {
        dashWs.broadcastOscMessage('/test/' + i, [i], 'in');
      }

      await delay(200);

      // Should have throttled — not all 10 messages sent
      const oscMessages = messages.filter(m => m.type === 'osc');
      assert.ok(oscMessages.length < 10, `Got ${oscMessages.length} messages, expected less than 10`);
      assert.ok(oscMessages.length >= 1, 'Should have at least 1 message');

      client.close();
      await delay(50);
    });
  });

  describe('Client messages', () => {
    it('should handle osc-monitor enable/disable', async () => {
      const client = await connectClient(port);
      await delay(50);

      // Disable OSC monitoring
      client.send(JSON.stringify({ type: 'osc-monitor', enabled: false }));
      await delay(50);

      // Send an OSC message — should not be received
      const messages: any[] = [];
      client.on('message', (data: Buffer) => {
        messages.push(JSON.parse(data.toString()));
      });

      dashWs.broadcastOscMessage('/test', [1], 'in');
      await delay(100);

      const oscMessages = messages.filter(m => m.type === 'osc');
      assert.strictEqual(oscMessages.length, 0);

      // Re-enable
      client.send(JSON.stringify({ type: 'osc-monitor', enabled: true }));
      await delay(150); // Allow throttle to reset

      dashWs.broadcastOscMessage('/test2', [2], 'in');
      await delay(100);

      const oscMessages2 = messages.filter(m => m.type === 'osc');
      assert.strictEqual(oscMessages2.length, 1);

      client.close();
      await delay(50);
    });
  });

  describe('Generic broadcast', () => {
    it('should broadcast arbitrary messages', async () => {
      const client = await connectClient(port);
      const msgPromise = nextMessage(client);

      dashWs.broadcast({ type: 'custom', data: 'hello' });

      const msg = await msgPromise;
      assert.strictEqual(msg.type, 'custom');
      assert.strictEqual(msg.data, 'hello');

      client.close();
      await delay(50);
    });
  });

  describe('Shutdown', () => {
    it('should close all connections on stop', async () => {
      const client = await connectClient(port);
      assert.strictEqual(dashWs.clientCount, 1);

      dashWs.stop();
      await delay(100);

      assert.strictEqual(dashWs.clientCount, 0);
      // Client should be closed
      assert.ok(client.readyState >= WebSocket.CLOSING);
    });

    it('should report 0 clients after stop', () => {
      dashWs.stop();
      assert.strictEqual(dashWs.clientCount, 0);
    });
  });
});
