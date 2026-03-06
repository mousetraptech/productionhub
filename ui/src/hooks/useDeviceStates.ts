import { useState, useEffect, useRef } from 'react';

// Connect to the dashboard WebSocket (health server) for device states
const DASHBOARD_WS_URL = `ws://${window.location.hostname}:8081`;
const RECONNECT_DELAY = 2000;

export interface AvantisStrip {
  fader: number;
  mute: boolean;
  pan: number;
}

export interface AvantisState {
  currentScene: number;
  strips: Record<string, AvantisStrip>;
}

export interface ChamSysPlayback {
  level: number;
  active: boolean;
  flash?: boolean;
  cue?: number;
}

export interface ChamSysState {
  playbacks: Record<string, ChamSysPlayback>;
  lastExec: number;
  lastRelease: number;
  masterLevel?: number;
  scene?: number;
}

export interface OBSState {
  scenes: string[];
  currentScene: string;
  previewScene: string;
  streaming: boolean;
  recording: boolean;
  virtualCam: boolean;
  currentTransition: string;
  transitionDuration: number;
  sources: Record<string, boolean>;
}

export interface VISCAState {
  currentPreset: number;
  panSpeed: number;
  tiltSpeed: number;
  zoomSpeed: number;
  zoomPosition: number;
  power: boolean;
  focusMode: 'auto' | 'manual';
  storedPresets: number[];
}

export interface TouchDesignerState {
  parameters: Record<string, any>;
  lastMessage: { address: string; args: any[] } | null;
  messageCount: number;
}

export interface RecorderSource {
  id: string;
  name: string;
  frames: number;
  vuDb: number;
}

export interface RecorderState {
  state: 'stopped' | 'recording' | 'archiving';
  sources: RecorderSource[];
  archiveProgress: number;
}

export interface QLabCue {
  uniqueID: string;
  number: string;
  name: string;
  type: string;
}

export interface QLabState {
  connected: boolean;
  playhead: string;
  runningCues: string[];
  runningCount: number;
  cues: QLabCue[];
}

export interface DeviceStates {
  avantis: AvantisState | null;
  chamsys: ChamSysState | null;
  obs: OBSState | null;
  visca: VISCAState | null;
  touchdesigner: TouchDesignerState | null;
  'ndi-recorder': RecorderState | null;
  qlab: Record<string, QLabState>;
}

export function useDeviceStates() {
  const [deviceStates, setDeviceStates] = useState<DeviceStates>({
    avantis: null,
    chamsys: null,
    obs: null,
    visca: null,
    touchdesigner: null,
    'ndi-recorder': null,
    qlab: {},
  });
  const [connected, setConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(DASHBOARD_WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = undefined;
        }
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'device-state') {
            const deviceType = msg.deviceType;
            if (deviceType === 'qlab') {
              // QLab instances keyed by prefix (e.g. "/sfx", "/show")
              const prefix = msg.prefix as string;
              setDeviceStates(prev => ({
                ...prev,
                qlab: { ...prev.qlab, [prefix]: msg.state as QLabState },
              }));
            } else {
              const key = deviceType as keyof Omit<DeviceStates, 'qlab'>;
              if (key in deviceStates) {
                setDeviceStates(prev => ({
                  ...prev,
                  [key]: msg.state,
                }));
              }
            }
          }
        } catch {
          // ignore parse errors
        }
      };

      ws.onclose = () => {
        if (wsRef.current === ws) {
          wsRef.current = null;
          setConnected(false);
          reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return { deviceStates, connected };
}
