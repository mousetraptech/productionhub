/**
 * TouchDesigner Emulator
 *
 * Virtual TouchDesigner OSC endpoint. The real TouchDesigner driver
 * is a transparent UDP OSC relay — any address received is forwarded
 * as-is to TD. This emulator mirrors that by tracking all received
 * addresses and their last values in a parameter map.
 *
 * Any OSC address is accepted and stored.
 */

import { DeviceConfig, HubContext } from '../drivers/device-driver';
import { DeviceEmulator } from './device-emulator';

export class TouchDesignerEmulator extends DeviceEmulator {
  readonly name: string;
  readonly prefix: string;

  private parameters: Map<string, any> = new Map();
  private lastMessage: { address: string; args: any[] } | null = null;
  private messageCount: number = 0;

  constructor(config: DeviceConfig, hubContext: HubContext, verbose = false) {
    super(config, hubContext, verbose);
    this.name = config.name ?? 'touchdesigner';
    this.prefix = config.prefix;
  }

  handleOSC(address: string, args: any[]): void {
    this.lastMessage = { address, args };
    this.messageCount++;

    // Store the first arg value for each address
    if (args.length > 0) {
      const val = typeof args[0] === 'object' && args[0].value !== undefined
        ? args[0].value
        : args[0];
      this.parameters.set(address, val);
    } else {
      this.parameters.set(address, null);
    }

    this.log('OSC', `${address} [${this.formatArgs(args)}]`);
  }

  /** TouchDesigner doesn't use the fade engine */
  protected onFadeTick(_key: string, _value: number): void {
    // No-op
  }

  getState(): Record<string, any> {
    const params: Record<string, any> = {};
    for (const [key, val] of this.parameters) {
      params[key] = val;
    }

    return {
      parameters: params,
      lastMessage: this.lastMessage,
      messageCount: this.messageCount,
    };
  }

  // --- Helpers ---

  private formatArgs(args: any[]): string {
    return args.map(a => {
      if (typeof a === 'object' && a.value !== undefined) return a.value;
      return a;
    }).join(', ');
  }
}
