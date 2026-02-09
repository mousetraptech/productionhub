/**
 * Shared OSC argument parsing utilities.
 *
 * OSC args arrive in two forms:
 *   - Raw values: number, string
 *   - Typed objects: { type: 'f'|'i'|'s', value: any }
 *
 * These helpers normalize both forms consistently across all drivers.
 */

/** Extract a float from args[0] (or args[index]) */
export function getFloat(args: any[], index = 0): number {
  if (!args || args.length <= index) return 0;
  const arg = args[index];
  const val = typeof arg === 'object' && arg.value !== undefined ? arg.value : arg;
  return typeof val === 'number' ? val : parseFloat(val) || 0;
}

/** Extract an integer from args[0] (or args[index]) */
export function getInt(args: any[], index = 0): number {
  if (!args || args.length <= index) return 0;
  const arg = args[index];
  const val = typeof arg === 'object' && arg.value !== undefined ? arg.value : arg;
  return typeof val === 'number' ? Math.round(val) : parseInt(val, 10) || 0;
}

/** Extract a string from args[0] (or args[index]) */
export function getString(args: any[], index = 0): string {
  if (!args || args.length <= index) return '';
  const arg = args[index];
  const val = typeof arg === 'object' && arg.value !== undefined ? arg.value : arg;
  return String(val);
}

/** Extract a boolean from args[0] — truthy if int >= 1 */
export function getBool(args: any[], index = 0): boolean {
  return getInt(args, index) >= 1;
}

/**
 * Normalize an array of OSC args into typed { type, value } objects.
 * Used by relay drivers (ChamSys, TouchDesigner) before forwarding.
 */
export function normalizeArgs(args: any[]): Array<{ type: string; value: any }> {
  return args.map((arg: any) => {
    if (typeof arg === 'object' && arg.type !== undefined && arg.value !== undefined) {
      return arg;
    }
    if (typeof arg === 'number') {
      return Number.isInteger(arg)
        ? { type: 'i', value: arg }
        : { type: 'f', value: arg };
    }
    return { type: 's', value: String(arg) };
  });
}
