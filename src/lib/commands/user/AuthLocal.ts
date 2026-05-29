import { Command } from '../../Command';
import type { NexxusClientConfig } from '../../types';

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
}

/**
 * Authentication response
 */
export interface LoginLocalOutput {
  /**
   * JWT authentication token (valid for 7 days by default)
   */
  token: string;

  /**
   * Authenticated user info
   */
  user: {
    /**
     * User ID
     */
    id: string;

    /**
     * Username/email
     */
    username: string;
  };
}

/**
 * Command to authenticate with username and password
 *
 * @example
 * ```typescript
 * const client = new NexxusClient({ baseUrl: 'http://localhost:3000', appId: 'myapp' });
 * const command = new LoginLocalCommand({
 *   username: 'john.doe@example.com',
 *   password: 'SecureP@ssw0rd'
 * });
 * const result = await client.send(command);
 * client.setAuthToken(result.token);
 * console.log('Logged in as:', result.user.username);
 * ```
 */
export class AuthLocalCommand extends Command<LoginLocalInput, LoginLocalOutput> {
  constructor(input: LoginLocalInput) {
    super(input, { authEnabled: false });
  }

  public resolveRequest(config: NexxusClientConfig) {
    return {
      method: 'POST' as const,
      path: '/auth/local',
      body: this.input,
    };
  }

  public parseResponse(response: any): LoginLocalOutput {
    return response as LoginLocalOutput;
  }
}
