import { Command } from '../../Command';
import type { ScopedModelQuery } from '../../types';

/**
 * Input for removing a subscription.
 *
 * The same descriptor that created it, minus pagination — `limit` and `offset`
 * were how the first page was fetched, not part of what the subscription *is*,
 * so they take no part in identifying it.
 */
export type UnsubscribeInput = ScopedModelQuery;

/**
 * Unsubscribe response.
 */
export interface UnsubscribeOutput {
  data: {
    /**
     * The channel that was removed — the same key
     * {@link ReadonlyChannel.getName} returns for it.
     */
    channel: string;
  };
}

/**
 * Command to remove a subscription from this client's transport connection.
 *
 * **The descriptor must match the one that created the subscription.** The
 * channel key is derived deterministically from `type` + `id` + `userId` +
 * `filter`, so a descriptor that differs in any of them addresses a different
 * channel and comes back `404` rather than removing the one you meant. The
 * safest source is the channel itself: it kept the query it was created with.
 *
 * On success the client also drops its local `Channel`, so a stale view cannot
 * linger after the server has stopped feeding it.
 *
 * Needs the connection, like subscribing does: with none registered, the
 * command fails before sending anything. A subscription made on an earlier
 * connection ended with it, so unsubscribing it on a new one is a `404`.
 *
 * @example
 * ```typescript
 * const channel = await client.send(new SubscribeCommand({
 *   type: 'task',
 *   filter: { priority: 'high' },
 *   limit: 50,
 * }));
 *
 * // …later. Note `limit` is not repeated — it never identified the channel.
 * await client.send(new UnsubscribeCommand({
 *   type: 'task',
 *   filter: { priority: 'high' },
 * }));
 * ```
 */
export class UnsubscribeCommand extends Command<UnsubscribeInput, UnsubscribeOutput> {
  constructor(input: UnsubscribeInput) {
    super(input, { authEnabled: true, requiresConnection: true });
  }

  public resolveRequest() {
    const { type, ...rest } = this.input;

    return {
      method: 'DELETE' as const,
      path: '/subscription/',
      // The subscription routes call the model type `model` on the wire.
      body: { model: type, ...rest },
    };
  }

  public parseResponse(response: any): UnsubscribeOutput {
    return response as UnsubscribeOutput;
  }

  /**
   * Read from the response rather than recomputed locally: the server folds any
   * ACL row constraint into the filter before deriving the key, so the channel
   * actually removed can have a key the client could not have produced itself.
   */
  public releasedChannel(response: any): string | undefined {
    return (response as UnsubscribeOutput).data?.channel;
  }
}
