/**
 * Booth Brain Tool Definitions
 *
 * Each tool has a Claude-compatible schema and an execute() handler
 * that performs the action against Production Hub.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ActionRegistry } from '../actions/registry';
import { CueEngine } from '../cue-engine/engine';
import { ToolResult } from './types';

export type RouteOSCFn = (address: string, args: any[]) => void;

export interface ToolDeps {
  actionRegistry: ActionRegistry;
  cueEngine: CueEngine;
  routeOSC: RouteOSCFn;
  getDeviceStates: () => Record<string, any>;
}

/** Claude tool definitions sent in API requests */
export function getToolDefinitions(): Anthropic.Tool[] {
  return [
    {
      name: 'execute_action',
      description: 'Execute a named action from the action registry. Actions are pre-defined command bundles like "house-half" or "stream-start". Use get_actions first if unsure which action ID to use.',
      input_schema: {
        type: 'object' as const,
        properties: {
          action_id: {
            type: 'string',
            description: 'The action ID from the registry (e.g. "house-half", "stream-start", "cam-wide")',
          },
        },
        required: ['action_id'],
      },
    },
    {
      name: 'send_osc',
      description: 'Send a raw OSC command to any device. Use this for commands not covered by named actions. The address must include the device prefix (e.g. "/avantis/ch/5/mix/fader").',
      input_schema: {
        type: 'object' as const,
        properties: {
          address: {
            type: 'string',
            description: 'Full OSC address including device prefix (e.g. "/avantis/ch/5/mix/fade", "/lights/pb/1/1", "/obs/scene/Interview")',
          },
          args: {
            type: 'array',
            items: {},
            description: 'OSC arguments (numbers, strings). E.g. [0.8] for a fader value, [0.0, 3.0, "scurve"] for a fade.',
          },
        },
        required: ['address'],
      },
    },
    {
      name: 'fire_cue',
      description: 'Fire the next cue in the cue stack, or go to standby. Use "go" to fire the next cue, "standby" to return to the top of the show.',
      input_schema: {
        type: 'object' as const,
        properties: {
          command: {
            type: 'string',
            enum: ['go', 'standby'],
            description: '"go" fires the next cue. "standby" returns to the top of the show.',
          },
        },
        required: ['command'],
      },
    },
    {
      name: 'get_device_state',
      description: 'Get the current state of a device. Returns JSON with current settings (fader levels, scene, streaming status, etc.).',
      input_schema: {
        type: 'object' as const,
        properties: {
          device: {
            type: 'string',
            enum: ['avantis', 'obs', 'chamsys', 'visca', 'touchdesigner', 'all'],
            description: 'Device to query. Use "all" to get all device states.',
          },
        },
        required: ['device'],
      },
    },
    {
      name: 'get_show_state',
      description: 'Get the current show state: cue list, active cue index, fired cues. Use this to answer questions about cue position.',
      input_schema: {
        type: 'object' as const,
        properties: {},
      },
    },
    {
      name: 'get_actions',
      description: 'List all available actions from the action registry, grouped by category. Use this to discover what actions are available before executing one.',
      input_schema: {
        type: 'object' as const,
        properties: {
          category: {
            type: 'string',
            description: 'Optional: filter to a specific category (e.g. "House Lights", "Audio", "Camera")',
          },
        },
      },
    },
    {
      name: 'recall_scene',
      description: 'Recall an Avantis mixing scene by number. This changes the entire console state.',
      input_schema: {
        type: 'object' as const,
        properties: {
          scene_number: {
            type: 'number',
            description: 'The scene number to recall (1-based)',
          },
        },
        required: ['scene_number'],
      },
    },
    {
      name: 'camera_preset',
      description: 'Move a PTZ camera to a saved preset position.',
      input_schema: {
        type: 'object' as const,
        properties: {
          camera: {
            type: 'string',
            enum: ['cam1', 'cam2', 'cam3'],
            description: 'Which camera to move',
          },
          preset: {
            type: 'number',
            description: 'Preset number (1-based)',
          },
        },
        required: ['camera', 'preset'],
      },
    },
  ];
}

/** Execute a tool call and return the result */
export function executeTool(name: string, args: Record<string, any>, deps: ToolDeps): ToolResult {
  switch (name) {
    case 'execute_action': {
      const actionId = args.action_id as string;
      const action = deps.actionRegistry.getAction(actionId);
      if (!action) {
        return { success: false, label: `Unknown action: ${actionId}` };
      }
      // Execute by routing each command through the hub
      for (const cmd of action.commands) {
        const prefix = cmd.prefix ? `/${cmd.prefix}` : resolvePrefix(cmd.device);
        deps.routeOSC(`${prefix}${cmd.address}`, cmd.args ?? []);
      }
      return { success: true, label: `${action.category}: ${action.label}`, detail: action.description };
    }

    case 'send_osc': {
      const address = args.address as string;
      const oscArgs = (args.args as any[]) ?? [];
      deps.routeOSC(address, oscArgs);
      return { success: true, label: `OSC: ${address}`, detail: `args: ${JSON.stringify(oscArgs)}` };
    }

    case 'fire_cue': {
      const command = args.command as string;
      if (command === 'go') {
        deps.cueEngine.go();
        const state = deps.cueEngine.getState();
        const cueName = state.activeCueIndex !== null ? state.cues[state.activeCueIndex]?.name : 'none';
        return { success: true, label: `Fired cue: ${cueName}` };
      } else if (command === 'standby') {
        deps.cueEngine.standby();
        return { success: true, label: 'Returned to standby' };
      }
      return { success: false, label: `Unknown cue command: ${command}` };
    }

    case 'get_device_state': {
      const device = args.device as string;
      const states = deps.getDeviceStates();
      if (device === 'all') {
        return { success: true, label: 'All device states', detail: JSON.stringify(states, null, 2) };
      }
      const state = states[device];
      if (!state) {
        return { success: true, label: `${device}: no state available` };
      }
      return { success: true, label: `${device} state`, detail: JSON.stringify(state, null, 2) };
    }

    case 'get_show_state': {
      const state = deps.cueEngine.getState();
      return { success: true, label: 'Show state', detail: JSON.stringify(state, null, 2) };
    }

    case 'get_actions': {
      const category = args.category as string | undefined;
      const categories = deps.actionRegistry.getCategoryList();
      const filtered = category
        ? categories.filter(c => c.category.toLowerCase() === category.toLowerCase())
        : categories;
      const summary = filtered.map(c =>
        `${c.icon} ${c.category}: ${c.items.map(i => `${i.id} (${i.label})`).join(', ')}`
      ).join('\n');
      return { success: true, label: 'Available actions', detail: summary };
    }

    case 'recall_scene': {
      const sceneNumber = args.scene_number as number;
      deps.routeOSC('/avantis/scene/recall', [sceneNumber]);
      return { success: true, label: `Recalled Avantis scene ${sceneNumber}` };
    }

    case 'camera_preset': {
      const camera = args.camera as string;
      const preset = args.preset as number;
      deps.routeOSC(`/${camera}/preset/recall/${preset}`, []);
      return { success: true, label: `${camera} to preset ${preset}` };
    }

    default:
      return { success: false, label: `Unknown tool: ${name}` };
  }
}

function resolvePrefix(device: string): string {
  const defaults: Record<string, string> = {
    avantis: '/avantis',
    chamsys: '/lights',
    obs: '/obs',
    visca: '/cam1',
    touchdesigner: '/td',
  };
  return defaults[device] ?? `/${device}`;
}
