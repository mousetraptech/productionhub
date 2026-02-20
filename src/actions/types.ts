/**
 * Action Registry Types
 *
 * Actions are the translation layer between MOD-friendly labels
 * ("House to Half") and OSC command bundles sent to devices.
 */

export interface ActionCommand {
  device: string;       // device type: avantis, chamsys, obs, visca, touchdesigner
  prefix?: string;      // optional prefix override (e.g. "cam1" for visca)
  address: string;      // OSC address relative to device prefix
  args?: any[];         // OSC arguments
}

export interface Action {
  id: string;
  label: string;
  category: string;
  icon: string;
  color: string;
  description: string;
  commands: ActionCommand[];
}

export interface ActionCategory {
  category: string;
  icon: string;
  color: string;
  items: Array<{
    id: string;
    label: string;
    desc: string;
    commands: Array<{ device: string; prefix?: string; address: string }>;
  }>;
}
