import { Command } from '../../Command';
import { Channel, type ReadonlyChannel } from '../../Channel';
import type { NexxusClientConfig, AppModel } from '../../types';

/**
 * FilterQuery DSL operators for advanced filtering
 */
export interface FilterQuery {
  /**
   * Equality operator
   */
  eq?: any;

  /**
   * Not equal operator
   */
  ne?: any;

  /**
   * Greater than operator
   */
  gt?: any;

  /**
   * Greater than or equal operator
   */
  gte?: any;

  /**
   * Less than operator
   */
  lt?: any;

  /**
   * Less than or equal operator
   */
  lte?: any;

  /**
   * In array operator
   */
  in?: any[];

  /**
   * AND logical operator
   */
  $and?: FilterQuery[];

  /**
   * OR logical operator
   */
  $or?: FilterQuery[];

  /**
   * Field path with nested operators
   */
  [field: string]: any;
}

/**
 * Input for creating a subscription
 */
export interface SubscribeInput {
  /**
   * Model type from the application schema
   * @example "task"
   */
  model: string;

  /**
   * Filter results to models owned by a specific user (that user's id).
   * Intended for applications that have authentication enabled.
   * Cannot be used together with `id`.
   * @example "user_abc123"
   */
  userId?: string;

  /**
   * Filter by specific model instance ID.
   * Cannot be used together with `userId`.
   * @example "task_abc123"
   */
  id?: string;

  /**
   * FilterQuery DSL for advanced filtering.
   * Supports operators: eq, ne, gt, gte, lt, lte, in, and, or.
   * Field paths support dot notation for nested fields.
   */
  filter?: FilterQuery;

  /**
   * If true, retrieves data without creating a subscription.
   * Useful for one-time queries.
   * @default false
   */
  getOnly?: boolean;

  /**
   * Maximum number of items to return
   * @default 10
   * @minimum 1
   * @maximum 100
   */
  limit?: number;

  /**
   * Number of items to skip (for pagination)
   * @default 0
   * @minimum 0
   */
  offset?: number;
}

/**
 * Subscription response
 */
export interface SubscribeOutput {
  data :{
    /**
   * Unique subscription channel identifier.
   * Only present when `getOnly` is false.
   * Used internally to route real-time updates.
   * @example "nxx:subscription:myapp:task:partition:0"
   */
    channelId: string;

    /**
     * Array of model instances matching the subscription criteria
     */
    items: AppModel[];
  }
}

/**
 * Result of a `getOnly` subscription request — a one-time search that creates
 * no channel/subscription. Behaves like a traditional search operation.
 */
export interface SubscribeQueryResult {
  /** Model instances matching the query criteria */
  items: AppModel[];
}

/**
 * Resolves the command output based on the `getOnly` flag:
 * `getOnly: true` yields a {@link SubscribeQueryResult}; otherwise a {@link ReadonlyChannel}.
 */
type SubscribeResult<G extends boolean | undefined> = G extends true ? SubscribeQueryResult : ReadonlyChannel;

/**
 * Command to subscribe to a channel and optionally retrieve data
 *
 * Creates a subscription for the device to receive real-time updates.
 * The subscription is tied to the device specified in the `nxx-device-id` header.
 * Device must be connected to a transport (e.g., WebSocket) to receive notifications.
 *
 * If `getOnly` is true, only retrieves data without creating a subscription.
 *
 * @example
 * ```typescript
 * const client = new NexxusClient({
 *   baseUrl: 'http://localhost:3000',
 *   appId: 'myapp',
 *   deviceId: 'dev_abc123'
 * });
 * client.setAuthToken('your-jwt-token');
 *
 * // Subscribe to all tasks
 * const command = new SubscribeCommand({
 *   model: 'task',
 *   limit: 10,
 *   offset: 0
 * });
 * const result = await client.send(command);
 * console.log('Channel ID:', result.channelId);
 * console.log('Tasks:', result.items);
 * ```
 *
 * @example
 * ```typescript
 * // Subscribe to a specific user's tasks
 * const command = new SubscribeCommand({
 *   model: 'task',
 *   userId: 'user_abc123',
 *   limit: 10
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Subscribe to a specific task by ID
 * const command = new SubscribeCommand({
 *   model: 'task',
 *   id: 'task_abc123'
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Subscribe with filter for high-priority tasks
 * const command = new SubscribeCommand({
 *   model: 'task',
 *   filter: {
 *     priority: 'high'
 *   },
 *   limit: 20
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Complex filter with AND/OR operators
 * const command = new SubscribeCommand({
 *   model: 'task',
 *   filter: {
 *     $or: [
 *       { status: { in: ['todo', 'in_progress'] } },
 *       { priority: 'high' }
 *     ]
 *   },
 *   limit: 10
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Get data without subscribing (one-time query)
 * const command = new SubscribeCommand({
 *   model: 'task',
 *   getOnly: true,
 *   limit: 50
 * });
 * const result = await client.send(command);
 * // result is a plain query result ({ items }); no Channel is created or tracked
 * console.log('Tasks:', result.items);
 * ```
 */
export class SubscribeCommand<G extends boolean | undefined = undefined> extends Command<SubscribeInput, SubscribeResult<G>> {
  constructor(input: SubscribeInput & { getOnly?: G }) {
    super(input, { authEnabled: true });
  }

  public resolveRequest(config: NexxusClientConfig) {
    return {
      method: 'POST' as const,
      path: '/subscription/',
      body: this.input,
    };
  }

  public parseResponse(response: any): SubscribeResult<G> {
    // `getOnly` is a one-shot search: return the items and create no Channel,
    // so the client won't register/track a subscription for it.
    if (this.input.getOnly) {
      return { items: (response as SubscribeOutput).data.items } as SubscribeResult<G>;
    }

    // A concrete Channel satisfies the public ReadonlyChannel contract; the
    // double cast is only needed because TS can't resolve the generic conditional.
    return new Channel(response as SubscribeOutput) as unknown as SubscribeResult<G>;
  }
}
