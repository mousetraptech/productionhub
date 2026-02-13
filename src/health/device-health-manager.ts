/**
 * Device Health Manager
 *
 * Manages connection state, auto-reconnection with exponential backoff,
 * and heartbeat monitoring for a single device driver.
 *
 * Listens to the driver's existing connected/disconnected/error events
 * and layerson state machine logic, reconnect scheduling, and heartbeat probing.
 *
 * Does NOT modify the driver — uses the same event-based integration pattern
 * the hub already uses.
 */

import { EventEmitter } from 'events';
import { DeviceDriver } from '../drivers/device-driver';
import { TransportType } from '../driver-stats';
import {
  ConnectionState,
  DeviceHealth,
  ReconnectConfig,
  HeartbeatConfig,
  DEFAULT_RECONNECT,
  DEFAULT_HEARTBEAT,
} from './types';

export class DeviceHealthManager extends EventEmitter {
  readonly driverName: string;
  readonly driverType: string;
  readonly prefix: string;
  readonly transportType: TransportType;

  private driver: DeviceDriver;
  private _state: ConnectionState = 'disconnected';
  private reconnectConfig: ReconnectConfig;
  private heartbeatConfig: HeartbeatConfig;
  private _reconnectAttempts = 0;
  private _lastSeen: number | null = null;
  private _latencyMs: number | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatPendingSince: number | null = null;
  private _shutdown = false;
  private verbose: boolean;

  constructor(
    driver: DeviceDriver,
    driverType: string,
    transportType: TransportType,
    reconnectConfig?: Partial<ReconnectConfig>,
    heartbeatConfig?: Partial<HeartbeatConfig>,
    verbose = false,
  ) {
    super();
    this.driver = driver;
    this.driverName = driver.name;
    this.driverType = driverType;
    this.prefix = driver.prefix;
    this.transportType = transportType;
    this.verbose = verbose;

    this.reconnectConfig = { ...DEFAULT_RECONNECT, ...reconnectConfig };
    this.heartbeatConfig = { ...DEFAULT_HEARTBEAT, ...heartbeatConfig };

    // Wire driver events
    this.driver.on('connected', () => this.onDriverConnected());
    this.driver.on('disconnected', () => this.onDriverDisconnected());
    this.driver.on('error', (err: Error) => this.onDriverError(err));

    // Track incoming feedback as "last seen"
    this.driver.on('feedback', () => {
      this._lastSeen = Date.now();
    });
  }

  /** Current connection state */
  get state(): ConnectionState {
    return this._state;
  }

  /** Number of reconnect attempts since last successful connection */
  get reconnectAttempts(): number {
    return this._reconnectAttempts;
  }

  /** Timestamp of last received data */
  get lastSeen(): number | null {
    return this._lastSeen;
  }

  /** Last measured latency in ms */
  get latencyMs(): number | null {
    return this._latencyMs;
  }

  /** Build a DeviceHealth snapshot */
  getHealth(): DeviceHealth {
    return {
      name: this.driverName,
      type: this.driverType,
      prefix: this.prefix,
      state: this._state,
      lastSeen: this._lastSeen ? new Date(this._lastSeen) : null,
      reconnectAttempts: this._reconnectAttempts,
      latencyMs: this._latencyMs,
    };
  }

  /** Initiate connection (sets state to 'connecting') */
  connect(): void {
    this.setState('connecting');
    this.driver.connect();
  }

  /** Stop all timers and disconnect */
  shutdown(): void {
    this._shutdown = true;
    this.clearReconnectTimer();
    this.clearHeartbeatTimer();
    this.driver.disconnect();
    this.setState('disconnected');
  }

  /** Mark data received from driver (for heartbeat liveness) */
  markDataReceived(): void {
    this._lastSeen = Date.now();
  }

  // --- State transitions ---

  private setState(newState: ConnectionState): void {
    if (this._state === newState) return;
    const prev = this._state;
    this._state = newState;
    if (this.verbose) {
      console.log(`[Health:${this.driverName}] ${prev} -> ${newState}`);
    }
    this.emit('stateChange', newState, prev);
  }

  private onDriverConnected(): void {
    this._reconnectAttempts = 0;
    this._lastSeen = Date.now();
    this.clearReconnectTimer();
    this.setState('connected');
    this.startHeartbeat();
  }

  private onDriverDisconnected(): void {
    this.clearHeartbeatTimer();

    if (this._state === 'disconnected') return; // already disconnected

    this.setState('disconnected');
    this.scheduleReconnect();
  }

  private onDriverError(err: Error): void {
    if (this.verbose) {
      console.error(`[Health:${this.driverName}] Error: ${err.message}`);
    }

    // If we're not connected, this error occurred during a connect attempt
    if (this._state === 'connecting' || this._state === 'reconnecting') {
      this.setState('error');
      this.scheduleReconnect();
    }
  }

  // --- Auto-reconnect with exponential backoff ---

  private scheduleReconnect(): void {
    if (this._shutdown) return;
    if (!this.reconnectConfig.enabled) return;
    if (this.reconnectTimer) return;

    const maxAttempts = this.reconnectConfig.maxAttempts;
    if (maxAttempts > 0 && this._reconnectAttempts >= maxAttempts) {
      if (this.verbose) {
        console.log(`[Health:${this.driverName}] Max reconnect attempts (${maxAttempts}) reached`);
      }
      this.setState('error');
      return;
    }

    const backoff = this.calculateBackoff();
    this._reconnectAttempts++;

    if (this.verbose) {
      console.log(
        `[Health:${this.driverName}] Reconnect attempt ${this._reconnectAttempts} in ${backoff}ms`
      );
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.setState('reconnecting');
      this.driver.connect();
    }, backoff);
  }

  /** Calculate exponential backoff delay: base * 2^(attempt-1), capped at max */
  calculateBackoff(): number {
    const { backoffMs, maxBackoffMs } = this.reconnectConfig;
    const delay = backoffMs * Math.pow(2, Math.max(0, this._reconnectAttempts - 1));
    return Math.min(delay, maxBackoffMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // --- Heartbeat / keepalive ---

  private startHeartbeat(): void {
    if (!this.heartbeatConfig.enabled) return;
    this.clearHeartbeatTimer();

    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeat();
    }, this.heartbeatConfig.intervalMs);
  }

  private checkHeartbeat(): void {
    if (this._state !== 'connected') return;

    // For TCP/WebSocket: if we haven't received data within 2x heartbeat interval,
    // consider the connection dead
    if (this.transportType === 'tcp' || this.transportType === 'websocket') {
      const timeout = this.heartbeatConfig.intervalMs * 3;
      if (this._lastSeen !== null && (Date.now() - this._lastSeen) > timeout) {
        console.warn(
          `[Health:${this.driverName}] Heartbeat timeout — no data for ${timeout}ms, triggering reconnect`
        );
        this.clearHeartbeatTimer();
        this.driver.disconnect();
        // disconnect event from driver will trigger reconnect
        return;
      }
    }

    // For UDP: we can't really detect dead connections, just update latency
    // UDP drivers (ChamSys, TouchDesigner) are "assumed connected"
    if (this.transportType === 'udp') {
      // No action — UDP is fire-and-forget
    }

    this.emit('heartbeat', this.driverName);
  }

  private clearHeartbeatTimer(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }
}
