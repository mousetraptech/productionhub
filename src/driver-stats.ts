/**
 * DriverStats — Lightweight per-driver telemetry
 *
 * Tracked by the hub from existing driver event listeners.
 * No modifications to driver implementations needed.
 */

export type TransportType = 'tcp' | 'websocket' | 'udp';

export interface DriverStats {
  name: string;
  prefix: string;
  transportType: TransportType;
  host: string;
  port: number;
  connected: boolean;
  reconnectCount: number;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  lastMessageReceivedAt: number | null;
  lastError: string | null;
  lastErrorAt: number | null;
}

export function createDriverStats(
  name: string,
  prefix: string,
  transportType: TransportType,
  host: string,
  port: number,
): DriverStats {
  return {
    name,
    prefix,
    transportType,
    host,
    port,
    connected: false,
    reconnectCount: 0,
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    lastMessageReceivedAt: null,
    lastError: null,
    lastErrorAt: null,
  };
}

/** Infer transport type from device type string */
export function inferTransportType(deviceType: string): TransportType {
  switch (deviceType) {
    case 'avantis': return 'tcp';
    case 'visca': return 'tcp';
    case 'obs': return 'websocket';
    case 'chamsys': return 'udp';
    case 'touchdesigner': return 'udp';
    default: return 'udp';
  }
}
