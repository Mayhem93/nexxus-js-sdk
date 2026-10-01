import { Command } from '../../Command';
import { Channel, type ReadonlyChannel } from '../../Channel';
import type { AppModel, Paginated, ScopedModelQuery } from '../../types';

/**
 * Input for creating a subscription: what to subscribe to, plus how to page the
 * first batch of items.
 */
export type SubscribeInput = ScopedModelQuery & Paginated;

/**
 * Subscription response
 */
export interface SubscribeOutput {
  data :{
    /**
   * Unique subscription channel identifier.
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
 * Command to subscribe to a channel and receive its first page of data.
 *
 * Creates a subscription for the calling device — which the token names — so
 * it receives real-time updates. The device must already be connected to a
 * transport, or this fails with `DeviceNotConnectedException`.
 *
 * For a one-off query with no subscription and no channel, use
 * {@link SearchCommand} instead.
 *
 * @example
 * ```typescript
 * const client = new NexxusClient({ baseUrl: 'http://localhost:3000', appId: 'myapp', store });
 * await client.send(new AuthLocalCommand({ username, password }));
 * await client.initTransport();
 *
 * // Subscribe to all tasks — the result is a live Channel
 * const channel = await client.send(new SubscribeCommand({
 *   type: 'task',
 *   limit: 10,
 *   offset: 0
 * }));
 * console.log('Channel ID:', channel.getName());
 * console.log('Tasks held locally:', channel.size);
 * ```
 *
 * @example
 * ```typescript
 * // Subscribe to a specific user's tasks
 * const command = new SubscribeCommand({
 *   type: 'task',
 *   userId: 'user_abc123',
 *   limit: 10
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Subscribe to a specific task by ID
 * const command = new SubscribeCommand({
 *   type: 'task',
 *   id: 'task_abc123'
 * });
 * ```
 *
 * @example
 * ```typescript
 * // Subscribe with filter for high-priority tasks
 * const command = new SubscribeCommand({
 *   type: 'task',
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
 *   type: 'task',
 *   filter: {
 *     $or: [
 *       { status: { in: ['todo', 'in_progress'] } },
 *       { priority: 'high' }
 *     ]
 *   },
 *   limit: 10
 * });
 * ```
 */
export class SubscribeCommand extends Command<SubscribeInput, ReadonlyChannel> {
  constructor(input: SubscribeInput) {
    super(input, { authEnabled: true });
  }

  public resolveRequest() {
    const { type, ...rest } = this.input;

    return {
      method: 'POST' as const,
      path: '/subscription/',
      // The subscription routes call the model type `model` on the wire.
      body: { model: type, ...rest },
    };
  }

  public parseResponse(response: any): ReadonlyChannel {
    // The channel keeps the descriptor that identifies it — the input minus
    // pagination, which only shaped the first page. It needs that descriptor to
    // derive its own count request, and a caller needs it to unsubscribe.
    const { limit: _limit, offset: _offset, ...subscription } = this.input;

    return new Channel(response as SubscribeOutput, subscription);
  }
}
