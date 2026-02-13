/**
 * Dashboard WebSocket Server
 *
 * Upgrades on the existing health HTTP server to provide
 * real-time updates to the web dashboard. Broadcasts:
 *   - Driver state changes (connect/disconnect/error)
 *   - Cue sequencer events (cue-fired, cue-complete, state)
 *   - OSC traffic monitor (sampled, not every message)
 *   - Health snapshots on connect
 *
 * Protocol: JSON messages with { type, ...payload }
 */

import { WebSocket, WebSocketServer } from 'ws';
import * as http from 'http';

export interface DashboardMessage {
  type: string;
  [key: string]: any;
}

export class DashboardWebSocket {
  private wss: WebSocketServer | null = null;
  private oscMonitorEnabled = true;
  private oscThrottleMs = 100;
  private lastOscBroadcast = 0;

  /** Attach to an existing HTTP server using upgrade */
  attach(server: http.Server): void {
    this.wss = new WebSocketServer({ server });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log(`[DashWS] Client connected (${this.wss!.clients.size} total)`);

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleClientMessage(ws, msg);
        } catch (err: any) {
          // Ignore malformed messages
        }
      });

      ws.on('close', () => {
        console.log(`[DashWS] Client disconnected (${this.wss?.clients.size ?? 0} total)`);
      });
    });

    this.wss.on('error', (err: Error) => {
      console.error(`[DashWS] WebSocket error: ${err.message}`);
    });

    console.log('[DashWS] WebSocket attached to health server');
  }

  /** Broadcast a driver state change */
  broadcastDriverState(driverName: string, prefix: string, state: string, detail?: string): void {
    this.broadcast({
      type: 'driver-state',
      driver: driverName,
      prefix,
      state,
      detail,
      timestamp: Date.now(),
    });
  }

  /** Broadcast a cue sequencer event */
  broadcastCueEvent(eventType: string, data: any): void {
    this.broadcast({
      type: 'cue-event',
      event: eventType,
      ...data,
      timestamp: Date.now(),
    });
  }

  /** Broadcast an OSC message (throttled for performance) */
  broadcastOscMessage(address: string, args: any[], direction: 'in' | 'out'): void {
    if (!this.oscMonitorEnabled) return;

    const now = Date.now();
    if (now - this.lastOscBroadcast < this.oscThrottleMs) return;
    this.lastOscBroadcast = now;

    this.broadcast({
      type: 'osc',
      address,
      args: args.map(a =>
        typeof a === 'object' && a !== null && a.value !== undefined
          ? a.value
          : a,
      ),
      direction,
      timestamp: now,
    });
  }

  /** Broadcast a generic message to all dashboard clients */
  broadcast(data: DashboardMessage): void {
    if (!this.wss) return;
    const payload = JSON.stringify(data);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  /** Get number of connected dashboard clients */
  get clientCount(): number {
    return this.wss?.clients.size ?? 0;
  }

  /** Shutdown */
  stop(): void {
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.close();
      }
      this.wss.close();
      this.wss = null;
    }
  }

  /** Handle messages from dashboard clients */
  private handleClientMessage(_ws: WebSocket, msg: any): void {
    switch (msg.type) {
      case 'osc-monitor':
        // Enable/disable OSC monitoring
        if (typeof msg.enabled === 'boolean') {
          this.oscMonitorEnabled = msg.enabled;
        }
        if (typeof msg.throttleMs === 'number' && msg.throttleMs >= 0) {
          this.oscThrottleMs = msg.throttleMs;
        }
        break;
    }
  }
}
