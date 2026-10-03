import { SessionCommand } from '../../SessionCommand';
import type { SessionTokens } from '../../types';

/**
 * Input for registering a new device
 */
export interface RegisterDeviceInput {
  /**
   * Human-readable name for the device, shown in the user's device list.
   * @example "John's iPhone"
   */
  name: string;
}

/**
 * Device registration response: a whole new session, bound to the device just
 * created. The caller's previous tokens still name the *previous* device, so
 * these replace them — the client does that automatically.
 */
export interface RegisterDeviceOutput extends SessionTokens {
  message: string;

  device: {
    /**
     * Unique device identifier
     */
    id: string;

    /**
     * ID of the user who owns this device. Absent on an application without
     * authentication, where a device has no owner.
     */
    userId?: string;

    /**
     * Human-readable device name
     */
    name: string;

    /**
     * Application ID this device belongs to
     */
    appId: string;
  };
}

/**
 * Command to register a new device.
 *
 * **This route always creates.** It is the "add another device" path, not part
 * of a normal bootstrap: on an application with authentication, registering or
 * logging in already binds a device, so calling this as well produces a second
 * device record for the same client.
 *
 * Where it *is* required is an application without authentication, which has
 * no other way to obtain its first session — and needs it only once: from then
 * on the device keeps its id and refreshes, rather than registering again.
 *
 * The session it returns replaces the stored one, and that is not optional.
 * Every device-scoped route reads the device out of the token, so keeping the
 * old token would leave the client silently addressing the device it had
 * before this call.
 *
 * To *reuse* a device, do nothing — the client replays the stored device id as
 * a hint when it authenticates.
 *
 * @example
 * ```typescript
 * // An application with no authentication: this is the bootstrap.
 * const client = new NexxusClient({ baseUrl: 'http://localhost:3000', appId: 'myapp', store });
 * await client.send(new RegisterDeviceCommand({ name: 'Kiosk 4' }));
 * await client.initTransport();
 * ```
 */
export class RegisterDeviceCommand extends SessionCommand<RegisterDeviceInput, RegisterDeviceOutput> {
  constructor(input: RegisterDeviceInput) {
    // A token is attached when there is one, but not required: an application
    // without authentication registers its first device without any.
    super(input, { authEnabled: true });
  }

  public resolveRequest() {
    return {
      method: 'POST' as const,
      path: '/device/register',
      body: this.input,
    };
  }

  public parseResponse(response: any): RegisterDeviceOutput {
    return response as RegisterDeviceOutput;
  }
}
