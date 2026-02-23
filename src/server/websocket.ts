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
import { BrainService } from '../brain/brain-service';
import { DeckPersistence } from '../deck/persistence';
import { fireDeckButton } from '../deck/fire';

export type RouteOSCFn = (address: string, args: any[]) => void;

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
  private routeOSC: RouteOSCFn;
  private brainService?: BrainService;
  private deckPersistence: DeckPersistence;

  constructor(
    config: ModWebSocketConfig,
    cueEngine: CueEngine,
    actionRegistry: ActionRegistry,
    templateLoader: TemplateLoader,
    persistence: ShowPersistence,
    routeOSC: RouteOSCFn,
    brainService?: BrainService,
    deckPersistence?: DeckPersistence,
  ) {
    this.config = config;
    this.cueEngine = cueEngine;
    this.actionRegistry = actionRegistry;
    this.templateLoader = templateLoader;
    this.persistence = persistence;
    this.routeOSC = routeOSC;
    this.brainService = brainService;
    this.deckPersistence = deckPersistence ?? new DeckPersistence();
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
      this.send(ws, { type: 'shows-list', shows: this.persistence.list() });
      this.send(ws, { type: 'last-show', name: this.persistence.getLastUsed() });

      if (this.brainService) {
        this.send(ws, { type: 'chat-mode', mode: this.brainService.getMode() });
      }

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
          this.persistence.setLastUsed(template.name);
        }
        break;
      }

      case 'go':
        this.cueEngine.go();
        break;

      case 'standby':
        this.cueEngine.standby();
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
        this.cueEngine.addActionToCue(msg.cueId, msg.actionId, msg.delay, msg.osc);
        break;

      case 'remove-action-from-cue':
        this.cueEngine.removeActionFromCue(msg.cueId, msg.actionIndex);
        break;

      case 'save-show':
        this.persistence.save(msg.name, this.cueEngine.getState());
        this.persistence.setLastUsed(msg.name);
        this.broadcast({ type: 'shows-list', shows: this.persistence.list() });
        break;

      case 'load-show': {
        const state = this.persistence.load(msg.name);
        if (state) {
          this.cueEngine.loadState(state);
          this.persistence.setLastUsed(msg.name);
        }
        break;
      }

      case 'list-shows':
        this.broadcast({ type: 'shows-list', shows: this.persistence.list() });
        break;

      case 'delete-show':
        this.persistence.delete(msg.name);
        this.broadcast({ type: 'shows-list', shows: this.persistence.list() });
        break;

      case 'update-action-in-cue':
        this.cueEngine.updateActionInCue(msg.cueId, msg.actionIndex, { osc: msg.osc, delay: msg.delay });
        break;

      case 'osc':
        if (typeof msg.address === 'string') {
          this.routeOSC(msg.address, Array.isArray(msg.args) ? msg.args : []);
        }
        break;

      case 'chat-message': {
        if (!this.brainService) {
          this.broadcast({ type: 'chat-error', requestId: msg.requestId ?? 'unknown', error: 'Brain is not enabled' });
          break;
        }
        const requestId = msg.requestId ?? `req-${Date.now()}`;
        this.brainService.handleMessage({ requestId, text: msg.text })
          .then(result => {
            if ('error' in result) {
              this.broadcast({ type: 'chat-error', ...result });
            } else if ('results' in result) {
              this.broadcast({ type: 'chat-executed', ...result });
            } else {
              this.broadcast({ type: 'chat-response', ...result });
            }
          })
          .catch(err => {
            this.broadcast({ type: 'chat-error', requestId, error: err.message });
          });
        break;
      }

      case 'chat-confirm': {
        if (!this.brainService) break;
        const result = this.brainService.confirmActions(msg.requestId);
        if ('error' in result) {
          this.broadcast({ type: 'chat-error', ...result });
        } else {
          this.broadcast({ type: 'chat-executed', ...result });
        }
        break;
      }

      case 'chat-reject': {
        if (!this.brainService) break;
        this.brainService.rejectActions(msg.requestId);
        this.broadcast({ type: 'chat-response', requestId: msg.requestId, text: 'Action cancelled.' });
        break;
      }

      case 'chat-set-mode': {
        if (!this.brainService) break;
        const mode = msg.mode;
        if (mode === 'confirm' || mode === 'trusted') {
          this.brainService.setMode(mode);
          this.broadcast({ type: 'chat-mode', mode });
        }
        break;
      }

      case 'deck-list':
        this.broadcast({ type: 'deck-profiles', profiles: this.deckPersistence.list() });
        break;

      case 'deck-load': {
        const profile = this.deckPersistence.load(msg.name);
        if (profile) {
          this.broadcast({ type: 'deck-state', name: msg.name, grid: profile.grid });
        }
        break;
      }

      case 'deck-save':
        this.deckPersistence.save(msg.name, { name: msg.name, grid: msg.grid });
        this.broadcast({ type: 'deck-saved', name: msg.name });
        break;

      case 'deck-delete':
        this.deckPersistence.delete(msg.name);
        this.broadcast({ type: 'deck-profiles', profiles: this.deckPersistence.list() });
        break;

      case 'deck-fire': {
        const fireActions = msg.actions ?? [];
        const fireMode = msg.mode ?? 'parallel';
        const gap = msg.seriesGap ?? 1000;

        fireDeckButton(fireActions, fireMode, gap, (actionId, osc) => {
          if (osc) {
            this.routeOSC(osc.address, osc.args);
          } else {
            const action = this.actionRegistry.getAction(actionId);
            if (action) {
              for (const cmd of action.commands) {
                const prefix = cmd.prefix ? `/${cmd.prefix}` : this.resolveDevicePrefix(cmd.device);
                if (prefix) this.routeOSC(`${prefix}${cmd.address}`, cmd.args ?? []);
              }
            }
          }
        }).catch(err => {
          console.error(`[ModWS] deck-fire error: ${err.message}`);
        });

        this.broadcast({ type: 'deck-fired', buttonId: msg.buttonId });
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

  /** Map device type to its configured prefix (same as CueEngine) */
  private resolveDevicePrefix(device: string): string | null {
    const defaults: Record<string, string> = {
      avantis: '/avantis',
      chamsys: '/lights',
      obs: '/obs',
      visca: '/cam1',
      touchdesigner: '/td',
    };
    return defaults[device] ?? null;
  }
}
