import { Command } from '../../Command';

/**
 * Fields the server sets on every model it creates. The command refuses a body
 * containing any of them before it's sent.
 */
const SERVER_SET_FIELDS = ['id', 'createdAt', 'updatedAt', 'version', 'appId', 'userId'] as const;

/**
 * Input for creating a new model instance. The fields the server sets are
 * typed `never`, so a body carrying one doesn't compile.
 */
export interface CreateModelInput extends Partial<Record<(typeof SERVER_SET_FIELDS)[number], never>> {
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
 * A write the message queue doesn't confirm fails with
 * `ServiceUnavailableException` (`503`) and can be retried. One that was
 * accepted but fails to apply is retried for a few seconds, so its event can
 * arrive late; if it keeps failing, it's dropped and no event is published.
 *
 * The server sets `id`, `createdAt`, `updatedAt`, `version`, `appId` and
 * `userId` itself — `userId` to the authenticated user. A body containing any
 * of them throws here, before it's sent.
 *
 * The server refuses a field the model's schema doesn't declare, or a value of
 * the wrong type, with `InvalidParametersException` (`400`); the reason is in
 * the message. A body over the deployment's size limit (64 KiB unless it sets
 * another) fails with `PayloadTooLargeException` (`413`).
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
 * console.log(result.message); // "Model created successfully!"
 * ```
 */
export class CreateModelCommand extends Command<CreateModelInput, CreateModelOutput> {
  constructor(input: CreateModelInput) {
    super(input, { authEnabled: true });

    // Present means sent: JSON leaves out a field that is `undefined`.
    const sent = SERVER_SET_FIELDS.filter(field => input[field] !== undefined);

    if (sent.length > 0) {
      throw new Error(`Field(s) "${sent.join('", "')}" are set by the server and can't be sent`);
    }
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
