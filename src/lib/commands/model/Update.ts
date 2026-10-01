import { Command } from '../../Command';
import type { JsonPatch } from '../../types';

/**
 * Input for updating a model instance using JsonPatch
 */
export interface UpdateModelInput {
  /**
   * Model type (e.g., "task", "project")
   */
  type: string;

  /**
   * JsonPatch operations to apply
   */
  patch: JsonPatch;

  /**
   * Model instance ID being updated (used in URL path)
   */
  id: string;
}

/**
 * Async operation response
 */
export interface UpdateModelOutput {
  /**
   * Confirmation message for the queued operation
   */
  message: string;
}

/**
 * Command to update a model instance using custom JsonPatch operations
 *
 * This operation is asynchronous - the request is queued to the Writer Worker
 * which applies the patches and notifies subscribed clients.
 *
 * @example
 * ```typescript
 * const client = new NexxusClient({ baseUrl: 'http://localhost:3000', appId: 'myapp', store });
 * // …after authenticating. The stored token is attached automatically.
 *
 * // Replace multiple fields
 * const command = new UpdateModelCommand({
 *   id: 'task_abc123',
 *   type: 'task',
 *   patch: {
 *     op: 'replace',
 *     path: ['status', 'priority'],
 *     value: ['completed', 'low']
 *   }
 * });
 * const result = await client.send(command);
 * console.log(result.message); // "Model update queued successfully"
 * ```
 *
 * @example
 * ```typescript
 * // Increment a counter
 * const command = new UpdateModelCommand({
 *   id: 'task_abc123',
 *   type: 'task',
 *   patch: {
 *     op: 'incr',
 *     path: ['viewCount'],
 *     value: [1]
 *   }
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Append to an array
 * const command = new UpdateModelCommand({
 *   id: 'task_abc123',
 *   type: 'task',
 *   patch: {
 *     op: 'append',
 *     path: ['tags'],
 *     value: [['urgent', 'backend']]
 *   }
 * });
 * ```
 */
export class UpdateModelCommand extends Command<UpdateModelInput, UpdateModelOutput> {
  constructor(input: UpdateModelInput) {
    super(input, { authEnabled: true });
  }

  public resolveRequest() {
    return {
      method: 'PUT' as const,
      path: `/model/${this.input.id}`,
      body: {
        type: this.input.type,
        patch: this.input.patch,
      },
    };
  }

  public parseResponse(response: any): UpdateModelOutput {
    return response as UpdateModelOutput;
  }
}
