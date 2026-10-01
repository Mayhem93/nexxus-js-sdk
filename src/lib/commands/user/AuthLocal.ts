import type { CommandContext } from '../../Command';
import { SessionCommand } from '../../SessionCommand';
import type { DeviceInfo, SessionResponse } from '../../types';

/**
 * Input for local authentication
 */
export interface LoginLocalInput {
  /**
   * User's username/email
   */
  username: string;

  /**
   * User's password
   */
  password: string;

  /**
   * Information about the device this login is coming from.
   *
   * Optional, and only consulted if the login ends up creating a device —
   * which happens when the client has no stored device id, or the one it has
   * no longer resolves. The id itself is not yours to set: the client attaches
   * it from its identity store.
   */
  device?: DeviceInfo;
}

/**
 * Authentication response — a token, the device it is bound to, and the user
 * it names. Identical in shape to what {@link RegisterUserCommand} returns, so
 * both can share a response handler.
 */
export type LoginLocalOutput = SessionResponse;

/**
 * Command to authenticate with username and password.
 *
 * The stored device id is attached by the command itself — a caller never
 * passes one, and so can never forget to. Without it, every login after a
 * token expires creates a new device record.
 *
 * Any `device` information the caller supplies rides along beside it. That
 * takes no part in matching an existing device; it only describes the one
 * created if the stored id resolves to nothing.
 *
 * @example
 * ```typescript
 * const client = new NexxusClient({ baseUrl: 'http://localhost:3000', appId: 'myapp', store });
 * const result = await client.send(new AuthLocalCommand({
 *   username: 'john.doe@example.com',
 *   password: 'SecureP@ssw0rd'
 * }));
 * // The token and device are already persisted; nothing to wire up by hand.
 * console.log('Logged in as:', result.user.username, 'on device', result.device.id);
 * ```
 */
export class AuthLocalCommand extends SessionCommand<LoginLocalInput, LoginLocalOutput> {
  constructor(input: LoginLocalInput) {
    super(input, { authEnabled: false });
  }

  public resolveRequest(context: CommandContext) {
    const { device, ...credentials } = this.input;
    const { deviceId } = context.identity;
    // The caller's device information, with the stored id layered on top. The
    // id goes last so nothing reaching this through the input can displace it.
    const resolved = { ...device, ...(deviceId !== undefined && { id: deviceId }) };

    return {
      method: 'POST' as const,
      path: '/auth/local',
      body: {
        ...credentials,
        // Omitted entirely when there is nothing to say — a first run has no
        // stored device, and device information is optional.
        ...(Object.keys(resolved).length > 0 && { device: resolved }),
      },
    };
  }

  public parseResponse(response: any): LoginLocalOutput {
    return response as LoginLocalOutput;
  }
}
