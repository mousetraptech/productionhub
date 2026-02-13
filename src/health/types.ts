/**
 * Device Health Types
 *
 * Connection state machine and health reporting for all device drivers.
 */

/** Connection states for device drivers */
export type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'error';

/** Per-device reconnect config */
export interface ReconnectConfig {
  enabled: boolean;       // default: true
  maxAttempts: number;    // 0 = unlimited
  backoffMs: number;      // initial backoff delay
  maxBackoffMs: number;   // backoff cap
}

/** Per-device heartbeat config */
export interface HeartbeatConfig {
  enabled: boolean;
  intervalMs: number;
}

/** Health snapshot for a single device */
export interface DeviceHealth {
  name: string;
  type: string;
  prefix: string;
  state: ConnectionState;
  lastSeen: Date | null;
  reconnectAttempts: number;
  latencyMs: number | null;
}

/** Default reconnect settings */
export const DEFAULT_RECONNECT: ReconnectConfig = {
  enabled: true,
  maxAttempts: 0,
  backoffMs: 1000,
  maxBackoffMs: 30000,
};

/** Default heartbeat settings */
export const DEFAULT_HEARTBEAT: HeartbeatConfig = {
  enabled: true,
  intervalMs: 5000,
};
