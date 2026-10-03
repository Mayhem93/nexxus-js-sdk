import { Command } from '../../Command';

/**
 * Input for deleting a model instance
 */
export interface DeleteModelInput {
  /**
   * Unique identifier of the model instance
   * @example "task_abc123"
   */
  id: string;

  /**
   * Model type (e.g., "task", "project")
   * @example "task"
   */
  type: string;
}

/**
 * Async operation response
 */
export interface DeleteModelOutput {
  /**
   * Confirmation message for the queued operation
   */
  message: string;
}

/**
 * Command to delete a model instance by ID
 *
 * This operation is asynchronous - the request is queued to the Writer Worker
 * which removes the data and notifies subscribed clients.
 *
 * @example
 * ```typescript
 * const client = new NexxusClient({ baseUrl: 'http://localhost:3000', appId: 'myapp', store });
 * // …after authenticating. The stored token is attached automatically.
 * const command = new DeleteModelCommand({
 *   id: 'task_abc123',
 *   type: 'task'
 * });
 * const result = await client.send(command);
 * console.log(result.message); // "Model deletion queued successfully"
 * ```
 */
export class DeleteModelCommand extends Command<DeleteModelInput, DeleteModelOutput> {
  constructor(input: DeleteModelInput) {
    super(input, { authEnabled: true });
  }

  public resolveRequest() {
    return {
      method: 'DELETE' as const,
      path: `/model/${this.input.id}`,
      body: {
        type: this.input.type,
      },
    };
  }

  public parseResponse(response: any): DeleteModelOutput {
    return response as DeleteModelOutput;
  }
}
