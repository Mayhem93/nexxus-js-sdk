import { Command } from '../../Command';
import type { NexxusClientConfig, PatchOperation } from '../../types';

/**
 * Input for updating user profile using JsonPatch
 */
export interface UpdateUserInput {
  patch: {
    /**
   * Patch operation type
   */
    op: PatchOperation;

    /**
     * Array of field paths to modify (supports dot notation for nested fields)
     */
    path: string[];

    /**
     * Array of values corresponding to each path
     */
    value: any[];
  }
}

/**
 * User update response
 */
export interface UpdateUserOutput {
  /**
   * Update confirmation message
   */
  message: string;
}

/**
 * Command to update authenticated user's profile using JsonPatch
 *
 * **Forbidden paths (cannot be updated):**
 * - `userType`
 * - `authProviders`
 * - `devices`
 * - `createdAt`
 * - `updatedAt`
 *
 * @example
 * ```typescript
 * const client = new NexxusClient({ baseUrl: 'http://localhost:3000', appId: 'myapp' });
 * client.setAuthToken('your-jwt-token');
 * const command = new UpdateUserCommand({
 *   patch: {
 *     op: 'replace',
 *     path: ['details.firstName', 'details.lastName'],
 *     value: ['Jonathan', 'Doe Jr.']
 *   }
 * });
 * const result = await client.send(command);
 * console.log(result.message);
 */
export class UpdateUserCommand extends Command<UpdateUserInput, UpdateUserOutput> {
  constructor(input: UpdateUserInput) {
    super(input, { authEnabled: true });
  }

  public resolveRequest(config: NexxusClientConfig) {
    return {
      method: 'PUT' as const,
      path: '/user/',
      body: this.input,
    };
  }

  public parseResponse(response: any): UpdateUserOutput {
    return response as UpdateUserOutput;
  }
}
