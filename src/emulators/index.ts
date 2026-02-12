/**
 * Emulator barrel exports and factory.
 *
 * Usage:
 *   import { createEmulator, DeviceEmulator } from './emulators';
 *   const emu = createEmulator(config, hubContext, verbose);
 */

export { DeviceEmulator, EmulatorLogEntry } from './device-emulator';
export { AvantisEmulator } from './avantis-emulator';
export { OBSEmulator } from './obs-emulator';
export { VISCAEmulator } from './visca-emulator';
export { ChamSysEmulator } from './chamsys-emulator';
export { TouchDesignerEmulator } from './touchdesigner-emulator';

import { DeviceConfig, HubContext } from '../drivers/device-driver';
import { DeviceEmulator } from './device-emulator';
import { AvantisEmulator } from './avantis-emulator';
import { OBSEmulator } from './obs-emulator';
import { VISCAEmulator } from './visca-emulator';
import { ChamSysEmulator } from './chamsys-emulator';
import { TouchDesignerEmulator } from './touchdesigner-emulator';

/**
 * Create an emulator for the given device config.
 * Mirrors createDriver() in index.ts but returns virtual drivers.
 */
export function createEmulator(
  deviceConfig: DeviceConfig,
  hubContext: HubContext,
  verbose: boolean,
): DeviceEmulator {
  switch (deviceConfig.type) {
    case 'avantis':
      return new AvantisEmulator(deviceConfig, hubContext, verbose);
    case 'obs':
      return new OBSEmulator(deviceConfig, hubContext, verbose);
    case 'visca':
      return new VISCAEmulator(deviceConfig, hubContext, verbose);
    case 'chamsys':
      return new ChamSysEmulator(deviceConfig, hubContext, verbose);
    case 'touchdesigner':
      return new TouchDesignerEmulator(deviceConfig, hubContext, verbose);
    default:
      throw new Error(`No emulator for device type: ${deviceConfig.type}`);
  }
}
