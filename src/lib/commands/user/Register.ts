import { Command } from '../../Command';
import type { NexxusClientConfig } from '../../types';

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
   * Additional user details based on application's user detail schema
   */
  [key: string]: any;
}

/**
 * User registration response
 */
export interface RegisterUserOutput {
  /**
   * Success message
   */
  message: string;

  /**
   * Created user info
   */
  user: {
    /**
     * Unique user identifier
     */
    id: string;

    /**
     * User's username
     */
    username: string;
  };
}

/**
 * Command to register a new user with local authentication
 *
 * @example
 * ```typescript
 * const client = new NexxusClient({ baseUrl: 'http://localhost:3000', appId: 'myapp' });
 * const command = new RegisterUserCommand({
 *   username: 'john.doe@example.com',
 *   password: 'SecureP@ssw0rd'
 * });
 * const result = await client.send(command);
 * console.log('User ID:', result.user.id);
 * ```
 */
export class RegisterUserCommand extends Command<RegisterUserInput, RegisterUserOutput> {
  constructor(input: RegisterUserInput) {
    super(input, { authEnabled: false });
  }

  public resolveRequest(config: NexxusClientConfig) {
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
