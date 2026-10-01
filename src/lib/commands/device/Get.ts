import { Command } from '../../Command';
import type { Device } from '../../types';

/**
 * Input for reading the calling device (no parameters — the device comes from
 * the token).
 */
export type GetDeviceInput = Record<string, never>;

/**
 * The calling device.
 */
export type GetDeviceOutput = Device;

/**
 * Command to read the device this client's token was issued to.
 *
 * There is no device parameter and no way to address another device: the id is
 * a signed claim inside the token, which is what makes "read any device by
 * guessing its id" impossible.
 *
 * Fails with `NotFoundException` if the device record is gone — reaped, or a
 * token outliving it. Register a device and use the token it returns.
 *
 * @example
 * ```typescript
 * const device = await client.send(new GetDeviceCommand({}));
 * console.log(device.name, device.status);
 * ```
 */
export class GetDeviceCommand extends Command<GetDeviceInput, GetDeviceOutput> {
  constructor(input: GetDeviceInput) {
    super(input, { authEnabled: true });
  }

  public resolveRequest() {
    return {
      method: 'GET' as const,
      path: '/device',
    };
  }

  public parseResponse(response: any): GetDeviceOutput {
    return response as GetDeviceOutput;
  }
}
