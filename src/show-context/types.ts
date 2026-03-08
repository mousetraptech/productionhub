/**
 * Show Context Types
 *
 * Defines the schema for show session documents stored in MongoDB.
 * A show context is a named session boundary that wraps every show.
 * All telemetry, actions, and errors get tagged to a show_id.
 */

export type ShowContextState = 'idle' | 'active' | 'improperly_closed' | 'archived';

export interface DeviceSnapshot {
  avantis: { reachable: boolean; ip: string };
  chamsys: { reachable: boolean };
  obs: { reachable: boolean };
  ptz_cameras: { reachable: boolean };
}

export interface ShowDocument {
  show_id: string;
  name: string;
  date: string;           // ISO date (YYYY-MM-DD)
  started_at: string;     // ISO datetime
  ended_at: string | null;
  closed_properly: boolean;
  state: ShowContextState;
  operator: string;
  device_snapshot: DeviceSnapshot;
  notes: string;
}

export interface ShowContextStatus {
  state: ShowContextState;
  show: ShowDocument | null;
}
