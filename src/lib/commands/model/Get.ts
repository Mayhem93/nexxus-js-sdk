import { Command } from '../../Command';
import type { AppModel } from '../../types';

/**
 * Input for getting a model instance
 */
export interface GetModelInput {
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
 * Model instance response
 */
export interface GetModelOutput {
  /**
   * Model instance data
   */
  data: AppModel;
}

/**
 * Command to retrieve a specific model instance by ID
 *
 * This operation is synchronous and reads directly from the database.
 *
 * @example
 * ```typescript
 * const client = new NexxusClient({ baseUrl: 'http://localhost:3000', appId: 'myapp', store });
 * // …after authenticating. The stored token is attached automatically.
 * const command = new GetModelCommand({
 *   id: 'task_abc123',
 *   type: 'task'
 * });
 * const result = await client.send(command);
 * console.log('Task:', result.data.title);
 * ```
 */
export class GetModelCommand extends Command<GetModelInput, GetModelOutput> {
  constructor(input: GetModelInput) {
    super(input, { authEnabled: true });
  }

  public resolveRequest() {
    return {
      method: 'GET' as const,
      path: `/model/${this.input.id}?type=${encodeURIComponent(this.input.type)}`,
    };
  }

  public parseResponse(response: any): GetModelOutput {
    return response as GetModelOutput;
  }
}
