import { Command } from '../../Command';
import type { NexxusClientConfig } from '../../types';
import type { FilterQuery } from '../subscription/Subscribe';

/**
 * Input for counting model instances. Mirrors the query-defining subset of a
 * subscription (`model` + `userId` + `filter`) — there is no `id`, `limit` or
 * `offset`: a count is over the whole matching set, not a page of it.
 */
export interface CountInput {
  /**
   * Model type from the application schema
   * @example "task"
   */
  type: string;

  /**
   * Restrict the count to models owned by a specific user (that user's id).
   * Intended for applications that have authentication enabled.
   */
  userId?: string;

  /**
   * FilterQuery DSL for advanced filtering (same dialect as subscriptions).
   */
  filter?: FilterQuery;
}

/**
 * Command to count the model instances matching a query, server-side.
 *
 * Returns the total number of models of `model` that match the optional
 * `userId`/`filter` — independent of any pagination. Usable on its own, or via
 * {@link Channel.remoteCount} which reuses the channel's own subscription criteria.
 *
 * @example
 * ```typescript
 * const total = await client.send(new CountCommand({ model: 'task', filter: { priority: 'high' } }));
 * console.log('high-priority tasks:', total);
 * ```
 */
export class CountCommand extends Command<CountInput, number> {
  constructor(input: CountInput) {
    super(input, { authEnabled: true });
  }

  public resolveRequest(_config: NexxusClientConfig) {
    return {
      method: 'POST' as const,
      path: '/model/count',
      body: this.input,
    };
  }

  public parseResponse(response: any): number {
    return (response as { data: { count: number } }).data.count;
  }
}
