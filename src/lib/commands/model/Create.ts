import { Command } from '../../Command';

/**
 * Input for creating a new model instance
 */
export interface CreateModelInput {
  /**
   * Model type defined in the application schema
   * @example "task"
   */
  type: string;

  /**
   * Custom model data fields based on application schema
   */
  [key: string]: any;
}

/**
 * Async operation response
 */
export interface CreateModelOutput {
  /**
   * Confirmation message for the queued operation
   */
  message: string;
}

/**
 * Command to create a new app model instance
 *
 * This operation is asynchronous - the request is queued to the Writer Worker
 * which persists the data and notifies subscribed clients.
 *
 * The `userId` field is automatically added from the authenticated user.
 * System fields (`id`, `createdAt`, `updatedAt`, `appId`) are added automatically.
 *
 * @example
 * ```typescript
 * const client = new NexxusClient({ baseUrl: 'http://localhost:3000', appId: 'myapp', store });
 * // …after authenticating. The stored token is attached automatically.
 * const command = new CreateModelCommand({
 *   type: 'task',
 *   title: 'Complete documentation',
 *   description: 'Write OpenAPI specs for all routes',
 *   status: 'todo',
 *   priority: 'high',
 *   dueDate: '2026-02-15T00:00:00.000Z'
 * });
 * const result = await client.send(command);
 * console.log(result.message); // "Model creation queued successfully"
 * ```
 */
export class CreateModelCommand extends Command<CreateModelInput, CreateModelOutput> {
  constructor(input: CreateModelInput) {
    super(input, { authEnabled: true });
  }

  public resolveRequest() {
    return {
      method: 'POST' as const,
      path: '/model/',
      body: this.input,
    };
  }

  public parseResponse(response: any): CreateModelOutput {
    return response as CreateModelOutput;
  }
}
