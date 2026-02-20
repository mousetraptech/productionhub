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

export interface DeviceStates {
  avantis: AvantisState | null;
  chamsys: ChamSysState | null;
  obs: OBSState | null;
  visca: VISCAState | null;
  touchdesigner: TouchDesignerState | null;
}

export function useDeviceStates() {
  const [deviceStates, setDeviceStates] = useState<DeviceStates>({
    avantis: null,
    chamsys: null,
    obs: null,
    visca: null,
    touchdesigner: null,
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
            const deviceType = msg.deviceType as keyof DeviceStates;
            if (deviceType in deviceStates) {
              setDeviceStates(prev => ({
                ...prev,
                [deviceType]: msg.state,
              }));
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
