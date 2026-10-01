import { Command } from '../../Command';
import type { ModelQuery } from '../../types';

/**
 * Input for counting model instances.
 *
 * A plain {@link ModelQuery} — no `id`, and no `limit`/`offset`. A count is
 * over the whole matching set rather than a page of it, and the route drops
 * anything else the body carries before validating, so an `id` cannot be
 * smuggled through.
 */
export type CountInput = ModelQuery;

/**
 * Command to count the model instances matching a query, server-side.
 *
 * Returns the total number of models of `model` that match the optional
 * `userId`/`filter` — independent of any pagination. Usable on its own, or via
 * {@link Channel.remoteCount} which reuses the channel's own subscription criteria.
 *
 * @example
 * ```typescript
 * const total = await client.send(new CountCommand({ type: 'task', filter: { priority: 'high' } }));
 * console.log('high-priority tasks:', total);
 * ```
 */
export class CountCommand extends Command<CountInput, number> {
  constructor(input: CountInput) {
    super(input, { authEnabled: true });
  }

  public resolveRequest() {
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
