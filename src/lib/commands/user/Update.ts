import { Command } from '../../Command';
import type { JsonPatch } from '../../types';

/**
 * Input for updating user profile using JsonPatch
 */
export interface UpdateUserInput {
  patch: JsonPatch;
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
 * Command to update authenticated user's profile using JsonPatch.
 *
 * **Paths the server refuses** (`400`):
 * - `userType`, `authProviders`, `devices`, `createdAt`, `updatedAt`
 * - anything under a `details.$…` key — those namespaces belong to auth
 *   strategies. Prefix-matched, so a strategy added later is covered too.
 *
 * Patching `password` hashes it server-side, and on an account that had none
 * (one created through an OAuth provider) also adds `local` to
 * `authProviders`.
 *
 * **The change is not visible through `GetUserCommand` until the client
 * authenticates again.** `/user/me` reads the token, not the database, and the
 * token was minted before this patch.
 *
 * @example
 * ```typescript
 * const result = await client.send(new UpdateUserCommand({
 *   patch: {
 *     op: 'replace',
 *     path: ['details.firstName', 'details.lastName'],
 *     value: ['Jonathan', 'Doe Jr.']
 *   }
 * }));
 * console.log(result.message);
 * ```
 */
export class UpdateUserCommand extends Command<UpdateUserInput, UpdateUserOutput> {
  constructor(input: UpdateUserInput) {
    super(input, { authEnabled: true });
  }

  public resolveRequest() {
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
