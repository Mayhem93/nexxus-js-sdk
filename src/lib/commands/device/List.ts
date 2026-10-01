import { Command } from '../../Command';
import type { Device } from '../../types';

/**
 * Input for listing the authenticated user's devices (no parameters).
 */
export type ListDevicesInput = Record<string, never>;

/**
 * Command to list every device registered to the user the token names.
 *
 * Requires a token that names a user — on an application without
 * authentication there is no owner to list devices for, and this returns
 * `InvalidAuthMethodException`.
 *
 * A device whose record no longer exists is omitted rather than failing the
 * request, so the array can be shorter than the user's stored device count.
 * That is not an error.
 *
 * @example
 * ```typescript
 * const devices = await client.send(new ListDevicesCommand({}));
 * const current = (await client.getIdentity()).deviceId;
 *
 * for (const device of devices) {
 *   console.log(device.name, device.id === current ? '(this one)' : '');
 * }
 * ```
 */
export class ListDevicesCommand extends Command<ListDevicesInput, Device[]> {
  constructor(input: ListDevicesInput) {
    super(input, { authEnabled: true });
  }

  public resolveRequest() {
    return {
      method: 'GET' as const,
      path: '/device/list',
    };
  }

  /**
   * Unwrapped from its `{ devices }` envelope, which carries nothing else —
   * same treatment `CountCommand` gives `{ data: { count } }`.
   */
  public parseResponse(response: any): Device[] {
    return (response as { devices: Device[] }).devices;
  }
}
