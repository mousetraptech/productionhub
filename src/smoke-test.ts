/**
 * SmokeTest — Per-driver connectivity verification
 *
 * Sends a known-safe command through the hub's OSC router to each driver,
 * proving the full path: HTTP → routeOSC → driver.handleOSC → device.
 *
 * Each driver type has a default smoke command:
 *   avantis         → /main/mix/fader 0.0  (query main fader — desk echoes back)
 *   chamsys         → /pb/1/1/level 1.0    (set playback 1 fader to full)
 *   obs             → /transition/duration 500  (set transition to 500ms)
 *   visca           → /home                (home camera)
 *   touchdesigner   → /test 1              (pulse — TD receives on OSC In CHOP)
 */

export interface SmokeCommand {
  /** OSC address *after* prefix (what the driver's handleOSC receives) */
  address: string;
  /** OSC args */
  args: Array<{ type: string; value: any }>;
  /** Human-readable description for the dashboard */
  label: string;
}

export interface SmokeTestResult {
  prefix: string;
  driverName: string;
  connected: boolean;
  sent: boolean;
  command: string;
  label: string;
  error?: string;
}

/** Default smoke commands per driver type */
const SMOKE_COMMANDS: Record<string, SmokeCommand> = {
  avantis: {
    address: '/main/mix/fader',
    args: [{ type: 'f', value: 0.0 }],
    label: 'Set main fader → 0.0',
  },
  chamsys: {
    address: '/pb/1/1/level',
    args: [{ type: 'f', value: 1.0 }],
    label: 'Playback 1 fader → 100%',
  },
  obs: {
    address: '/transition/duration',
    args: [{ type: 'i', value: 500 }],
    label: 'Transition duration → 500ms',
  },
  visca: {
    address: '/home',
    args: [],
    label: 'Camera home',
  },
  touchdesigner: {
    address: '/test',
    args: [{ type: 'i', value: 1 }],
    label: 'Pulse /test 1',
  },
};

export class SmokeTest {
  /**
   * Get the smoke command for a driver type.
   * Returns undefined if no smoke command is defined for the type.
   */
  static getCommand(driverType: string): SmokeCommand | undefined {
    return SMOKE_COMMANDS[driverType];
  }

  /** Get all known driver types that have smoke commands */
  static get supportedTypes(): string[] {
    return Object.keys(SMOKE_COMMANDS);
  }
}
