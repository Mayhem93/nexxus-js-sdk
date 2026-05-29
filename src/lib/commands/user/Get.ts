import { Command } from '../../Command';
import type { NexxusClientConfig } from '../../types';

/**
 * Input for getting current user (no parameters needed)
 */
export type GetUserInput = Record<string, never>;

/**
 * User profile response
 */
export interface GetUserOutput {
  /**
   * Unique user identifier
   */
  id: string;

  /**
   * User's username (email)
   */
  username: string;

  /**
   * User type/role
   */
  userType: string;

  /**
   * List of enabled authentication providers for this user
   */
  authProviders: string[];

  /**
   * User-specific details based on application's user detail schema
   */
  details: Record<string, any>;

  /**
   * Application ID this user belongs to
   */
  appId: string;
}

/**
 * Command to get current authenticated user's profile
 *
 * @example
 * ```typescript
 * const client = new NexxusClient({ baseUrl: 'http://localhost:3000', appId: 'myapp' });
 * client.setAuthToken('your-jwt-token');
 * const command = new GetUserCommand({});
 * const user = await client.send(command);
 * console.log('User:', user.username);
 * ```
 */
export class GetUserCommand extends Command<GetUserInput, GetUserOutput> {
  constructor(input: GetUserInput) {
    super(input, { authEnabled: true });
  }

  public resolveRequest(config: NexxusClientConfig) {
    return {
      method: 'GET' as const,
      path: '/user/me',
    };
  }

  public parseResponse(response: any): GetUserOutput {
    return response as GetUserOutput;
  }
}
