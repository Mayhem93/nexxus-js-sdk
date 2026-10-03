import { Command } from '../../Command';
import type { AppModel, Paginated, ScopedModelQuery } from '../../types';

/**
 * Input for searching model instances — the same shape as a subscribe, since a
 * search is that query without the subscription.
 */
export type SearchInput = ScopedModelQuery & Paginated;

/**
 * Command to search instances of a model — a one-off query with no
 * subscription and no channel.
 *
 * This is the counterpart to {@link SubscribeCommand}, not a mode of it. A
 * subscribe records a subscription against the calling device and returns a
 * live {@link Channel}; a search just reads. Use this when you want data once
 * and do not want the server pushing updates about it — a search needs no
 * transport connection and leaves nothing behind to unsubscribe from.
 *
 * Where ACLs are enabled, results are limited to the rows the caller's role
 * permits. Note this differs from `CountCommand`, which is gated at the action
 * level only and still counts rows the caller could not read.
 *
 * @example
 * ```typescript
 * const tasks = await client.send(new SearchCommand({
 *   type: 'task',
 *   filter: { priority: 'high' },
 *   limit: 50
 * }));
 * console.log(tasks.length);
 * ```
 *
 * @example
 * ```typescript
 * // Paging through a user's own tasks
 * const page = await client.send(new SearchCommand({
 *   type: 'task',
 *   userId: 'user_abc123',
 *   limit: 20,
 *   offset: 40
 * }));
 * ```
 */
export class SearchCommand extends Command<SearchInput, AppModel[]> {
  constructor(input: SearchInput) {
    super(input, { authEnabled: true });
  }

  public resolveRequest() {
    const { type, ...body } = this.input;

    return {
      method: 'POST' as const,
      path: `/model/${encodeURIComponent(type)}/search`,
      body,
    };
  }

  public parseResponse(response: any): AppModel[] {
    return (response as { data: { items: AppModel[] } }).data.items;
  }
}
