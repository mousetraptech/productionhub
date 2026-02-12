/**
 * WebSocket Server for MOD UI
 *
 * Provides real-time communication between the React frontend
 * and the Production Hub backend. Broadcasts state changes to
 * all connected clients (multiple MODs/observers).
 */

import { WebSocket, WebSocketServer } from 'ws';
import { CueEngine } from '../cue-engine/engine';
import { ActionRegistry } from '../actions/registry';
import { TemplateLoader } from '../shows/templates';
import { ShowPersistence } from '../cue-engine/persistence';
import { ShowState } from '../cue-engine/types';
import { Cue } from '../cue-engine/types';

export interface ModWebSocketConfig {
  port: number;
}

export class ModWebSocket {
  private wss: WebSocketServer | null = null;
  private config: ModWebSocketConfig;
  private cueEngine: CueEngine;
  private actionRegistry: ActionRegistry;
  private templateLoader: TemplateLoader;
  private persistence: ShowPersistence;

  constructor(
    config: ModWebSocketConfig,
    cueEngine: CueEngine,
    actionRegistry: ActionRegistry,
    templateLoader: TemplateLoader,
    persistence: ShowPersistence,
  ) {
    this.config = config;
    this.cueEngine = cueEngine;
    this.actionRegistry = actionRegistry;
    this.templateLoader = templateLoader;
    this.persistence = persistence;
  }

  /** Start the WebSocket server */
  start(): void {
    this.wss = new WebSocketServer({ port: this.config.port });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log(`[ModWS] Client connected (${this.wss!.clients.size} total)`);

      // Send initial state
      this.send(ws, { type: 'state', show: this.cueEngine.getState() });
      this.send(ws, { type: 'actions', categories: this.actionRegistry.getCategoryList() });
      this.send(ws, { type: 'templates', templates: this.templateLoader.getAll() });

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleMessage(msg);
        } catch (err: any) {
          console.error(`[ModWS] Invalid message: ${err.message}`);
        }
      });

      ws.on('close', () => {
        console.log(`[ModWS] Client disconnected (${this.wss!.clients.size} total)`);
      });
    });

    // Forward cue engine state changes to all clients
    this.cueEngine.on('state', (state: ShowState) => {
      this.broadcast({ type: 'state', show: state });
    });

    this.cueEngine.on('cue-fired', (cueIndex: number, cue: Cue) => {
      this.broadcast({ type: 'cue-fired', cueIndex, cue });
    });

    this.wss.on('listening', () => {
      console.log(`[ModWS] MOD interface: ws://localhost:${this.config.port}`);
    });

    this.wss.on('error', (err: Error) => {
      console.error(`[ModWS] Server error: ${err.message}`);
    });
  }

  /** Stop the WebSocket server */
  stop(): void {
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.close();
      }
      this.wss.close();
      this.wss = null;
    }
  }

  /** Handle an incoming message from a client */
  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'get-actions':
        this.broadcast({ type: 'actions', categories: this.actionRegistry.getCategoryList() });
        break;

      case 'get-templates':
        this.broadcast({ type: 'templates', templates: this.templateLoader.getAll() });
        break;

      case 'load-template': {
        const template = this.templateLoader.getTemplate(msg.templateId);
        if (template) {
          this.cueEngine.loadTemplate(template.name, template.cues);
        }
        break;
      }

      case 'go':
        this.cueEngine.go();
        break;

      case 'reset':
        this.cueEngine.reset();
        break;

      case 'add-cue':
        this.cueEngine.addCue(msg.cue ?? {}, msg.atIndex);
        break;

      case 'remove-cue':
        this.cueEngine.removeCue(msg.cueId);
        break;

      case 'move-cue':
        this.cueEngine.moveCue(msg.cueId, msg.direction);
        break;

      case 'rename-cue':
        this.cueEngine.updateCue(msg.cueId, { name: msg.name });
        break;

      case 'add-action-to-cue':
        this.cueEngine.addActionToCue(msg.cueId, msg.actionId);
        break;

      case 'remove-action-from-cue':
        this.cueEngine.removeActionFromCue(msg.cueId, msg.actionIndex);
        break;

      case 'save-show':
        this.persistence.save(msg.name, this.cueEngine.getState());
        break;

      case 'load-show': {
        const state = this.persistence.load(msg.name);
        if (state) this.cueEngine.loadState(state);
        break;
      }

      default:
        console.warn(`[ModWS] Unknown message type: ${msg.type}`);
    }
  }

  /** Send a message to a single client */
  private send(ws: WebSocket, data: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  /** Broadcast a message to all connected clients */
  private broadcast(data: any): void {
    if (!this.wss) return;
    const payload = JSON.stringify(data);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
}
