import { Command } from '../../Command';

/**
 * The device fields a client may change.
 *
 * A partial update of the calling device, not a rename operation — `name`
 * simply happens to be the only field currently open to clients. As others are
 * added they join this type, and `name` becomes optional at that point.
 */
export interface UpdateDeviceInput {
  /**
   * Human-readable name, shown in the user's device list.
   *
   * This is how a device gets named after the fact — registration creates the
   * account's first device unnamed, and takes no device input.
   */
  name: string;
}

/**
 * Update confirmation.
 */
export interface UpdateDeviceOutput {
  message: string;
}

/**
 * Command to update the device this client's token was issued to.
 *
 * As with reading, there is no device parameter: the token names the device,
 * so a client can only ever change its own.
 *
 * @example
 * ```typescript
 * // Name the device created during registration.
 * await client.send(new UpdateDeviceCommand({ name: "Ann's Laptop" }));
 * ```
 */
export class UpdateDeviceCommand extends Command<UpdateDeviceInput, UpdateDeviceOutput> {
  constructor(input: UpdateDeviceInput) {
    super(input, { authEnabled: true });
  }

  public resolveRequest() {
    return {
      method: 'PUT' as const,
      path: '/device',
      body: this.input,
    };
  }

  public parseResponse(response: any): UpdateDeviceOutput {
    return response as UpdateDeviceOutput;
  }
}
