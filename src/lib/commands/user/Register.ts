import { SessionCommand } from '../../SessionCommand';
import type { SessionResponse } from '../../types';

/**
 * Input for registering a new user with local authentication
 */
export interface RegisterUserInput {
  /**
   * Unique username (typically email address)
   */
  username: string;

  /**
   * Password for local authentication (automatically hashed)
   */
  password: string;

  /**
   * User type/role as defined in application schema
   * @default "default"
   */
  userType?: string;

  /**
   * Additional user details based on the application's user detail schema.
   *
   * The schema is closed: a field it does not declare is a `400`, not a
   * silently stored extra. Keys beginning with `$` are reserved for auth
   * strategies and are rejected.
   */
  [key: string]: any;
}

/**
 * Registration response — the same session shape a login returns.
 */
export type RegisterUserOutput = SessionResponse;

/**
 * Command to register a user with local authentication.
 *
 * Registration signs you in: this returns a session on a new device, so there
 * is no follow-up login call. Doing one anyway would resolve a *second* device
 * for the same client.
 *
 * If the username already exists and the password is that account's, it signs
 * in to that account instead: `accountCreated` is `false`, the user type and
 * details sent are ignored, and the account gains a new device. Any other
 * password — or an account created through an OAuth provider, which has none —
 * fails with `UserAlreadyExistsException` (`409`).
 *
 * So sign a returning user in with {@link AuthLocalCommand} instead: it reuses
 * the device this client has stored, where every registration adds one.
 *
 * Two registrations for the same username at the same moment end with a single
 * account. One still waiting after a few seconds fails with
 * `ServiceUnavailableException` (`503`); retrying it works.
 *
 * The device is created unnamed. Naming it is a separate call to the device
 * route afterwards — the register endpoint has no device input.
 *
 * @example
 * ```typescript
 * const client = new NexxusClient({ baseUrl: 'http://localhost:3000', appId: 'myapp', store });
 * const result = await client.send(new RegisterUserCommand({
 *   username: 'john.doe@example.com',
 *   password: 'SecureP@ssw0rd'
 * }));
 * console.log('User ID:', result.user.id);  // already signed in
 * console.log(result.accountCreated);       // false if the account already existed
 * ```
 */
export class RegisterUserCommand extends SessionCommand<RegisterUserInput, RegisterUserOutput> {
  constructor(input: RegisterUserInput) {
    super(input, { authEnabled: false });
  }

  /**
   * Takes nothing from the client's identity. Registration always creates a
   * new device and accepts no say in it, so there is no stored id to attach and
   * nothing to negotiate — the id travels the other way, out of the response
   * and into later logins.
   */
  public resolveRequest() {
    return {
      method: 'POST' as const,
      path: '/user/register',
      body: this.input,
    };
  }

  public parseResponse(response: any): RegisterUserOutput {
    return response as RegisterUserOutput;
  }
}
