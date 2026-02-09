/**
 * OBS WebSocket v5 Device Driver
 *
 * Translates OSC commands into OBS WebSocket v5 JSON-RPC requests.
 * Handles authentication (SHA256 challenge-response) and reconnection.
 *
 * OSC namespace (after prefix stripping):
 *   /scene/{name}              SetCurrentProgramScene
 *   /scene/preview/{name}      SetCurrentPreviewScene
 *   /stream/start              StartStream
 *   /stream/stop               StopStream
 *   /stream/toggle             ToggleStream
 *   /record/start              StartRecord
 *   /record/stop               StopRecord
 *   /record/toggle             ToggleRecord
 *   /source/{name}/visible     SetSceneItemEnabled (int 0|1)
 *   /transition/{name}         SetCurrentSceneTransition
 *   /transition/duration       SetCurrentSceneTransitionDuration (int ms)
 *   /virtualcam/start          StartVirtualCam
 *   /virtualcam/stop           StopVirtualCam
 *
 * Feedback events (OBS → OSC clients):
 *   /scene/current             string (current program scene name)
 *   /stream/status             int 0|1
 *   /record/status             int 0|1
 */

import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { DeviceDriver, DeviceConfig, HubContext, FeedbackEvent, OscArg } from './device-driver';
import { getInt } from './osc-args';
import { ReconnectQueue } from './reconnect-queue';

export interface OBSConfig extends DeviceConfig {
  type: 'obs';
  password?: string;
}

// WebSocket is loaded dynamically to avoid hard dependency at import time
let WebSocket: any;

export class OBSDriver extends EventEmitter implements DeviceDriver {
  readonly name: string;
  readonly prefix: string;

  private host: string;
  private port: number;
  private password: string;
  private ws: any = null;
  private connected: boolean = false;
  private identified: boolean = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private requestId: number = 0;
  private pendingRequests: Map<string, { resolve: (data: any) => void; timer: ReturnType<typeof setTimeout> }> = new Map();
  private reconnectQueue = new ReconnectQueue<{ address: string; args: any[] }>();
  private verbose: boolean;

  constructor(config: OBSConfig, _hubContext: HubContext, verbose = false) {
    super();
    this.name = config.name ?? 'obs';
    this.prefix = config.prefix;
    this.host = config.host;
    this.port = config.port;
    this.password = config.password ?? '';
    this.verbose = verbose;
  }

  connect(): void {
    this.loadWebSocket();
    this.doConnect();
  }

  private loadWebSocket(): void {
    if (!WebSocket) {
      try {
        WebSocket = require('ws');
      } catch {
        throw new Error('[OBS] "ws" package not installed. Run: npm install ws');
      }
    }
  }

  private doConnect(): void {
    const url = `ws://${this.host}:${this.port}`;
    if (this.verbose) {
      console.log(`[OBS] Connecting to ${url}`);
    }

    try {
      this.ws = new WebSocket(url);
    } catch (err: any) {
      console.error(`[OBS] WebSocket creation failed: ${err.message}`);
      this.scheduleReconnect();
      return;
    }

    this.ws.on('open', () => {
      this.connected = true;
      if (this.verbose) console.log('[OBS] WebSocket connected');
    });

    this.ws.on('message', (data: any) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleWSMessage(msg);
      } catch (err: any) {
        console.error(`[OBS] Parse error: ${err.message}`);
      }
    });

    this.ws.on('close', () => {
      this.connected = false;
      this.identified = false;
      this.emit('disconnected');
      if (this.verbose) console.log('[OBS] WebSocket closed');
      this.scheduleReconnect();
    });

    this.ws.on('error', (err: Error) => {
      console.error(`[OBS] WebSocket error: ${err.message}`);
      this.emit('error', err);
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.verbose) console.log('[OBS] Attempting reconnect...');
      this.doConnect();
    }, 5000);
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    this.identified = false;
  }

  isConnected(): boolean {
    return this.connected && this.identified;
  }

  /**
   * Handle incoming OSC (prefix already stripped).
   */
  handleOSC(address: string, args: any[]): void {
    if (!this.isConnected()) {
      this.reconnectQueue.push({ address, args });
      if (this.verbose) console.warn(`[OBS] Not connected, queued message (${this.reconnectQueue.size} in queue)`);
      return;
    }

    const addr = address.toLowerCase().replace(/\/$/, '');
    const parts = addr.split('/').filter(Boolean);

    if (parts.length === 0) return;

    switch (parts[0]) {
      case 'scene':
        this.handleSceneCommand(parts.slice(1), args);
        break;
      case 'stream':
        this.handleStreamCommand(parts.slice(1));
        break;
      case 'record':
        this.handleRecordCommand(parts.slice(1));
        break;
      case 'transition':
        this.handleTransitionCommand(parts.slice(1), args);
        break;
      case 'virtualcam':
        this.handleVirtualCamCommand(parts.slice(1));
        break;
      case 'source':
        this.handleSourceCommand(parts.slice(1), args);
        break;
      default:
        if (this.verbose) console.warn(`[OBS] Unrecognized: ${address}`);
    }
  }

  /** OBS doesn't use the fade engine */
  handleFadeTick(_key: string, _value: number): void {
    // No-op
  }

  /** Replay queued messages after reconnect */
  private flushQueue(): void {
    const queued = this.reconnectQueue.flush();
    if (queued.length === 0) return;
    console.log(`[OBS] Replaying ${queued.length} queued message(s)`);
    for (const msg of queued) {
      this.handleOSC(msg.address, msg.args);
    }
  }

  // --- Command handlers ---

  private handleSceneCommand(parts: string[], args: any[]): void {
    if (parts.length === 0) return;

    if (parts[0] === 'preview' && parts.length >= 2) {
      const sceneName = decodeURIComponent(parts.slice(1).join('/'));
      this.sendRequest('SetCurrentPreviewScene', { sceneName });
    } else {
      // /scene/{name} — use the raw parts to preserve case
      const sceneName = decodeURIComponent(parts.join('/'));
      this.sendRequest('SetCurrentProgramScene', { sceneName });
    }
  }

  private handleStreamCommand(parts: string[]): void {
    if (parts.length === 0) return;
    switch (parts[0]) {
      case 'start':  this.sendRequest('StartStream'); break;
      case 'stop':   this.sendRequest('StopStream'); break;
      case 'toggle': this.sendRequest('ToggleStream'); break;
    }
  }

  private handleRecordCommand(parts: string[]): void {
    if (parts.length === 0) return;
    switch (parts[0]) {
      case 'start':  this.sendRequest('StartRecord'); break;
      case 'stop':   this.sendRequest('StopRecord'); break;
      case 'toggle': this.sendRequest('ToggleRecord'); break;
    }
  }

  private handleTransitionCommand(parts: string[], args: any[]): void {
    if (parts.length === 0) return;
    if (parts[0] === 'duration') {
      const ms = getInt(args);
      this.sendRequest('SetCurrentSceneTransitionDuration', { transitionDuration: ms });
    } else {
      const name = decodeURIComponent(parts.join('/'));
      this.sendRequest('SetCurrentSceneTransition', { transitionName: name });
    }
  }

  private handleVirtualCamCommand(parts: string[]): void {
    if (parts.length === 0) return;
    switch (parts[0]) {
      case 'start': this.sendRequest('StartVirtualCam'); break;
      case 'stop':  this.sendRequest('StopVirtualCam'); break;
    }
  }

  private handleSourceCommand(parts: string[], args: any[]): void {
    // /source/{name}/visible {0|1}
    if (parts.length < 2) return;
    const lastPart = parts[parts.length - 1];
    if (lastPart === 'visible') {
      const sourceName = decodeURIComponent(parts.slice(0, -1).join('/'));
      const enabled = getInt(args) >= 1;
      // Note: SetSceneItemEnabled requires sceneName + sceneItemId.
      // Getting the sceneItemId requires a GetSceneItemId call first.
      // For simplicity, we'll use a two-step approach.
      this.setSourceVisibility(sourceName, enabled);
    }
  }

  /**
   * 3-step source visibility toggle:
   *   1. GetCurrentProgramScene → sceneName
   *   2. GetSceneItemId → sceneItemId for the source in that scene
   *   3. SetSceneItemEnabled → toggle visibility
   */
  private async setSourceVisibility(sourceName: string, enabled: boolean): Promise<void> {
    try {
      // Step 1: Get current program scene
      const sceneResp = await this.sendRequestAsync('GetCurrentProgramScene');
      if (!sceneResp?.requestStatus?.result) {
        console.error(`[OBS] Failed to get current scene: ${sceneResp?.requestStatus?.comment ?? 'timeout'}`);
        return;
      }
      const sceneName = sceneResp.responseData?.currentProgramSceneName;
      if (!sceneName) {
        console.error('[OBS] No current scene name in response');
        return;
      }

      // Step 2: Get scene item ID for the source
      const itemResp = await this.sendRequestAsync('GetSceneItemId', {
        sceneName,
        sourceName,
      });
      if (!itemResp?.requestStatus?.result) {
        console.error(`[OBS] Source "${sourceName}" not found in scene "${sceneName}": ${itemResp?.requestStatus?.comment ?? 'timeout'}`);
        return;
      }
      const sceneItemId = itemResp.responseData?.sceneItemId;
      if (sceneItemId === undefined) {
        console.error('[OBS] No sceneItemId in response');
        return;
      }

      // Step 3: Set scene item enabled/disabled
      this.sendRequest('SetSceneItemEnabled', {
        sceneName,
        sceneItemId,
        sceneItemEnabled: enabled,
      });

      if (this.verbose) {
        console.log(`[OBS] Source "${sourceName}" in "${sceneName}" → ${enabled ? 'visible' : 'hidden'}`);
      }
    } catch (err: any) {
      console.error(`[OBS] Source visibility error: ${err.message}`);
    }
  }

  // --- WebSocket protocol ---

  private handleWSMessage(msg: any): void {
    const op = msg.op;

    switch (op) {
      case 0: // Hello
        this.handleHello(msg.d);
        break;
      case 2: // Identified
        this.identified = true;
        this.emit('connected');
        if (this.verbose) console.log('[OBS] Identified successfully');
        this.flushQueue();
        break;
      case 5: // Event
        this.handleEvent(msg.d);
        break;
      case 7: // RequestResponse
        this.handleRequestResponse(msg.d);
        break;
    }
  }

  /**
   * OBS WebSocket v5 Hello + Identify handshake.
   * If authentication is required, generates the auth response.
   */
  private handleHello(data: any): void {
    const identifyMsg: any = {
      op: 1, // Identify
      d: {
        rpcVersion: 1,
        eventSubscriptions: 0x01ff, // Subscribe to most events
      },
    };

    if (data.authentication) {
      const { challenge, salt } = data.authentication;
      const secret = crypto.createHash('sha256')
        .update(this.password + salt)
        .digest('base64');
      const authResponse = crypto.createHash('sha256')
        .update(secret + challenge)
        .digest('base64');
      identifyMsg.d.authentication = authResponse;
    }

    this.wsSend(identifyMsg);
  }

  private handleEvent(data: any): void {
    const eventType = data?.eventType;
    if (!eventType) return;

    switch (eventType) {
      case 'CurrentProgramSceneChanged':
        this.emitFeedback('/scene/current', [
          { type: 's', value: data.eventData?.sceneName ?? '' },
        ]);
        break;
      case 'StreamStateChanged':
        this.emitFeedback('/stream/status', [
          { type: 'i', value: data.eventData?.outputActive ? 1 : 0 },
        ]);
        break;
      case 'RecordStateChanged':
        this.emitFeedback('/record/status', [
          { type: 'i', value: data.eventData?.outputActive ? 1 : 0 },
        ]);
        break;
    }
  }

  /** Resolve a pending async request (op 7 response) */
  private handleRequestResponse(data: any): void {
    const reqId = data?.requestId;
    const pending = reqId ? this.pendingRequests.get(reqId) : undefined;
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingRequests.delete(reqId);
      pending.resolve(data);
    }
    if (this.verbose && !data?.requestStatus?.result) {
      console.warn(`[OBS] Request failed: ${data?.requestStatus?.comment}`);
    }
  }

  /**
   * Send a request and wait for the response (up to 5 seconds).
   * Returns the response data (op 7 d-field) or null on timeout.
   */
  private sendRequestAsync(requestType: string, requestData?: any): Promise<any | null> {
    return new Promise((resolve) => {
      this.requestId++;
      const reqId = `req-${this.requestId}`;
      const timer = setTimeout(() => {
        this.pendingRequests.delete(reqId);
        if (this.verbose) console.warn(`[OBS] Request timeout: ${requestType}`);
        resolve(null);
      }, 5000);

      this.pendingRequests.set(reqId, { resolve, timer });

      const msg: any = {
        op: 6,
        d: { requestType, requestId: reqId },
      };
      if (requestData) {
        msg.d.requestData = requestData;
      }
      this.wsSend(msg);

      if (this.verbose) {
        console.log(`[OBS] -> ${requestType} ${requestData ? JSON.stringify(requestData) : ''}`);
      }
    });
  }

  private sendRequest(requestType: string, requestData?: any): void {
    this.requestId++;
    const msg: any = {
      op: 6, // Request
      d: {
        requestType,
        requestId: `req-${this.requestId}`,
      },
    };
    if (requestData) {
      msg.d.requestData = requestData;
    }
    this.wsSend(msg);

    if (this.verbose) {
      console.log(`[OBS] -> ${requestType} ${requestData ? JSON.stringify(requestData) : ''}`);
    }
  }

  private wsSend(msg: any): void {
    if (!this.ws || !this.connected) return;
    try {
      this.ws.send(JSON.stringify(msg));
    } catch (err: any) {
      console.error(`[OBS] Send error: ${err.message}`);
    }
  }

  private emitFeedback(address: string, args: OscArg[]): void {
    this.emit('feedback', { address, args } as FeedbackEvent);
  }

}
