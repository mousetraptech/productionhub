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
import { ShowContextService } from '../show-context';

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
  private nodeAgentUrl?: string;
  private showContext?: ShowContextService;

  constructor(
    config: ModWebSocketConfig,
    cueEngine: CueEngine,
    actionRegistry: ActionRegistry,
    templateLoader: TemplateLoader,
    persistence: ShowPersistence,
    routeOSC: RouteOSCFn,
    brainService?: BrainService,
    deckPersistence?: DeckPersistence,
    nodeAgentUrl?: string,
    showContext?: ShowContextService,
  ) {
    this.config = config;
    this.cueEngine = cueEngine;
    this.actionRegistry = actionRegistry;
    this.templateLoader = templateLoader;
    this.persistence = persistence;
    this.routeOSC = routeOSC;
    this.brainService = brainService;
    this.deckPersistence = deckPersistence ?? new DeckPersistence();
    this.nodeAgentUrl = nodeAgentUrl;
    this.showContext = showContext;
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

      // Send show context status
      if (this.showContext) {
        this.showContext.getStatus().then(status => {
          this.send(ws, { type: 'show-context', ...status });
        }).catch(() => {});
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
        this.handleDeckFire(msg);
        break;
      }

      // --- Show Context ---

      case 'show-start': {
        this.handleShowStart(msg);
        break;
      }

      case 'show-end': {
        this.handleShowEnd(msg);
        break;
      }

      case 'show-status': {
        if (this.showContext) {
          this.showContext.getStatus().then(status => {
            this.broadcast({ type: 'show-context', ...status });
          }).catch(() => {});
        }
        break;
      }

      default:
        console.warn(`[ModWS] Unknown message type: ${msg.type}`);
    }
  }

  /** Handle deck-fire with optional prompt */
  private async handleDeckFire(msg: any): Promise<void> {
    const fireActions = msg.actions ?? [];
    const fireMode = msg.mode ?? 'parallel';
    const gap = msg.seriesGap ?? 1000;

    let sessionName: string | undefined;

    // If the button has a prompt config and we have a node-agent URL, ask the user first
    if (msg.prompt && this.nodeAgentUrl) {
      try {
        const res = await fetch(`${this.nodeAgentUrl}/api/v1/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'text_input',
            title: 'Recording',
            message: msg.prompt.message,
            default: msg.prompt.default ?? '',
          }),
        });
        if (!res.ok) {
          console.warn(`[ModWS] Node-agent prompt failed: ${res.status}`);
          this.broadcast({ type: 'deck-fire-cancelled', buttonId: msg.buttonId });
          return;
        }
        const body = await res.json() as { cancelled?: boolean; result?: string };
        if (body.cancelled) {
          this.broadcast({ type: 'deck-fire-cancelled', buttonId: msg.buttonId });
          return;
        }
        // Format as YYYYMMDD <result>
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        sessionName = `${yyyy}${mm}${dd} ${body.result}`;
        console.log(`[ModWS] Prompt result → sessionName: ${sessionName}`);
      } catch (err: any) {
        console.error(`[ModWS] Node-agent prompt error: ${err.message}`);
        this.broadcast({ type: 'deck-fire-cancelled', buttonId: msg.buttonId });
        return;
      }
    }

    try {
      await fireDeckButton(fireActions, fireMode, gap, (actionId, osc) => {
        if (osc) {
          const args = [...osc.args];
          // Append session name to /start commands on the recorder
          if (sessionName && osc.address.endsWith('/start')) {
            args.push(sessionName);
          }
          this.routeOSC(osc.address, args);
        } else {
          const action = this.actionRegistry.getAction(actionId);
          if (action) {
            for (const cmd of action.commands) {
              const prefix = cmd.prefix ? `/${cmd.prefix}` : this.resolveDevicePrefix(cmd.device);
              if (prefix) {
                const args = [...(cmd.args ?? [])];
                if (sessionName && cmd.address === '/start') {
                  args.push(sessionName);
                }
                this.routeOSC(`${prefix}${cmd.address}`, args);
              }
            }
          }
        }
      });
    } catch (err: any) {
      console.error(`[ModWS] deck-fire error: ${err.message}`);
    }

    this.broadcast({ type: 'deck-fired', buttonId: msg.buttonId });
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

  /** Handle show-start with prompt for show name */
  private async handleShowStart(msg: any): Promise<void> {
    if (!this.showContext) {
      console.warn('[ModWS] Show context not available (no MongoDB configured)');
      return;
    }

    let showName = msg.name;

    // If no name provided and we have node-agent, prompt for it
    if (!showName && this.nodeAgentUrl) {
      try {
        const res = await fetch(`${this.nodeAgentUrl}/api/v1/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'text_input',
            title: 'Start Show',
            message: 'Show name?',
            default: '',
          }),
        });
        if (!res.ok) {
          console.warn(`[ModWS] Node-agent prompt failed: ${res.status}`);
          return;
        }
        const body = await res.json() as { cancelled?: boolean; result?: string };
        if (body.cancelled || !body.result?.trim()) {
          this.broadcast({ type: 'show-start-cancelled' });
          return;
        }
        showName = body.result.trim();
      } catch (err: any) {
        console.error(`[ModWS] Show name prompt error: ${err.message}`);
        return;
      }
    }

    if (!showName) {
      showName = `Show ${new Date().toLocaleTimeString()}`;
    }

    // Apply YYYYMMDD prefix
    const d = new Date();
    const datePrefix = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    if (!showName.match(/^\d{8}\s/)) {
      showName = `${datePrefix} ${showName}`;
    }

    try {
      const show = await this.showContext.startShow(showName);
      const status = await this.showContext.getStatus();
      this.broadcast({ type: 'show-context', ...status });
      console.log(`[ModWS] Show started: ${show.name} (${show.show_id})`);
    } catch (err: any) {
      console.error(`[ModWS] Failed to start show: ${err.message}`);
    }
  }

  /** Handle show-end with confirmation prompt */
  private async handleShowEnd(msg: any): Promise<void> {
    if (!this.showContext) return;

    const active = await this.showContext.getActiveShow();
    if (!active) {
      console.warn('[ModWS] No active show to end');
      return;
    }

    // Confirm before closing (spec requires confirm-before-close)
    if (!msg.confirmed && this.nodeAgentUrl) {
      try {
        const res = await fetch(`${this.nodeAgentUrl}/api/v1/prompt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: 'text_input',
            title: 'End Show',
            message: `End "${active.displayName}"? Type YES to confirm.`,
            default: '',
          }),
        });
        if (!res.ok) return;
        const body = await res.json() as { cancelled?: boolean; result?: string };
        if (body.cancelled || body.result?.toUpperCase() !== 'YES') {
          this.broadcast({ type: 'show-end-cancelled' });
          return;
        }
      } catch (err: any) {
        console.error(`[ModWS] Show end confirm error: ${err.message}`);
        return;
      }
    }

    try {
      await this.showContext.endShow();
      const status = await this.showContext.getStatus();
      this.broadcast({ type: 'show-context', ...status });
      console.log(`[ModWS] Show ended: ${active.name}`);
    } catch (err: any) {
      console.error(`[ModWS] Failed to end show: ${err.message}`);
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
      'ndi-recorder': '/recorder',
    };
    return defaults[device] ?? null;
  }
}
