import { SubscribeOutput, type FilterQuery } from './commands/subscription/Subscribe';
import type { CountInput } from './commands/model/Count';
import { AppModel, ModelIdentity, TransportPatch } from './types';

import EventEmitter from 'eventemitter3';
import * as dot from 'dot-prop';

interface ChannelEvents {
  model_created: (model: AppModel) => void;
  model_updated: (model: ModelIdentity, patches: TransportPatch[]) => void;
  model_deleted: (model: ModelIdentity) => void;
}

/**
 * The query that defines a channel — the part of the original subscribe request
 * that says *which* models the channel represents (not how they were paged).
 * Kept so the channel can re-derive its own count request (and, later, an
 * unsubscribe). `limit`/`offset` are intentionally dropped — they're pagination,
 * not identity. `id` is retained only to mark id-scoped subscriptions.
 */
export interface ChannelSubscription {
  model: string;
  userId?: string;
  filter?: FilterQuery;
  id?: string;
}

/**
 * The read-only public face of a {@link Channel} handed to consumers: query the
 * current items and subscribe to changes, but no mutation. The mutators and
 * `emit` live only on the concrete `Channel`, which the client keeps internally.
 *
 * Compile-time encapsulation — a deliberate cast could still reach the concrete
 * class; that's an accepted trade-off for a TS SDK.
 */
export type ReadonlyChannel = Pick<
  Channel,
  'getName' | 'get' | 'has' | 'size' | 'remoteCount' | 'entries' | 'on' | 'once' | 'off' | typeof Symbol.iterator
>;

export class Channel extends EventEmitter<ChannelEvents> {
  private name: string;
  private readonly items: Map<string, AppModel> = new Map();
  private readonly subscription: ChannelSubscription;
  private countExecutor?: (query: CountInput) => Promise<number>;

  constructor(input: SubscribeOutput, subscription: ChannelSubscription) {
    super();
    this.name = input.data.channelId;
    this.subscription = subscription;

    for (const item of input.data.items) {
      this.items.set(item.id, item);
    }
  }

  /**
   * Wires the capability used by {@link remoteCount} to reach the server. Called
   * by the client when it registers the channel; not part of {@link ReadonlyChannel}.
   * @internal
   */
  public setCountExecutor(fn: (query: CountInput) => Promise<number>): void {
    this.countExecutor = fn;
  }

  /**
   * The number of models the server currently holds for this channel's
   * subscription criteria (`model` + `userId` + `filter`), independent of the
   * local view / page size — contrast with {@link size}, the count held locally.
   *
   * For an id-scoped subscription this resolves locally to {@link size} (0 or 1):
   * the count endpoint has no `id` parameter, so a request would count the whole
   * model set rather than the single targeted instance. The local view is kept
   * accurate by real-time events.
   */
  public async remoteCount(): Promise<number> {
    if (this.subscription.id !== undefined) {
      return this.size;
    }

    if (!this.countExecutor) {
      throw new Error('Channel is not attached to a client');
    }

    const { model, userId, filter } = this.subscription;

    return this.countExecutor({ type: model, userId, filter });
  }

  public [Symbol.iterator](): Iterator<AppModel> {
    return this.items.values();
  }

  /**
   * Iterate `[id, model]` pairs, mirroring `Map.entries()` — use when you need
   * each model's id alongside it. (The default iterator yields models only.)
   */
  public entries(): IterableIterator<[string, AppModel]> {
    return this.items.entries();
  }

  /**
   * Insert or replace a full model, version-guarded: writes only when the model
   * is new or strictly newer than the local copy (newer wins; equal/older is
   * dropped). Emits `model_created` when the item is new to the channel,
   * otherwise `model_updated`. Used for create events and GET-based resyncs.
   */
  public upsert(model: AppModel): void {
    const current = this.items.get(model.id);

    if (current && model.version <= current.version) {
      return;
    }

    this.items.set(model.id, model);

    if (current) {
      this.emit('model_updated', model, []);
    } else {
      this.emit('model_created', model);
    }
  }

  /**
   * Apply an update event's patches (in order) to an existing model and stamp
   * its new version, then emit `model_updated`. The caller (client) only invokes
   * this when `version` is exactly one ahead of the local copy; missing/gapped
   * objects are resynced via `upsert` instead.
   */
  public applyPatches(id: string, patches: TransportPatch[], version: number): void {
    const obj = this.items.get(id);

    if (!obj) {
      return;
    }

    for (const patch of patches) {
      this.applyPatch(obj, patch);
    }

    obj.version = version;

    this.emit('model_updated', obj, patches);
  }

  /**
   * Remove a model from the channel; emits `model_deleted` only if it was
   * actually present (so consumers aren't notified about items outside their view).
   */
  public remove(model: ModelIdentity): boolean {
    const existed = this.items.delete(model.id);

    if (existed) {
      this.emit('model_deleted', model);
    }

    return existed;
  }

  public has(itemId: string): boolean {
    return this.items.has(itemId);
  }

  public get(itemId: string): AppModel | undefined {
    return this.items.get(itemId);
  }

  public get size(): number {
    return this.items.size;
  }

  public getName(): string {
    return this.name;
  }

  private applyPatch(obj: AppModel, patch: TransportPatch): void {
    const { op, path, value } = patch;

    // Ensure path and value arrays have the same length
    if (path.length !== value.length) {
      console.warn(`Path and value arrays length mismatch in channel ${this.name}`);
      return;
    }

    for (let i = 0; i < path.length; i++) {
      const fieldPath = path[i];
      const fieldValue = value[i];

      try {
        switch (op) {
          case 'replace':
            // Replace the value at the given path
            dot.setProperty(obj, fieldPath, fieldValue);
            break;

          case 'append':
            // Append to an array or string at the given path
            {
              const currentValue = dot.getProperty(obj, fieldPath);

              if (Array.isArray(currentValue)) {
                const arr = currentValue as any[];
                arr.push(fieldValue);
              } else if (typeof currentValue === 'string') {
                dot.setProperty(obj, fieldPath, currentValue + (fieldValue as string));
              } else {
                console.warn(`Cannot append to non-array/non-string field ${fieldPath} in channel ${this.name}`);
              }
            }
            break;

          case 'prepend':
            // Prepend to an array or string at the given path
            {
              const currentValue = dot.getProperty(obj, fieldPath);

              if (Array.isArray(currentValue)) {
                const arr = currentValue as any[];
                arr.unshift(fieldValue);
              } else if (typeof currentValue === 'string') {
                dot.setProperty(obj, fieldPath, (fieldValue as string) + currentValue);
              } else {
                console.warn(`Cannot prepend to non-array/non-string field ${fieldPath} in channel ${this.name}`);
              }
            }
            break;

          case 'incr':
            // Increment a numeric value
            {
              const currentValue = dot.getProperty(obj, fieldPath);
              if (typeof currentValue === 'number') {
                dot.setProperty(obj, fieldPath, currentValue + (fieldValue as number));
              } else {
                console.warn(`Cannot increment non-numeric field ${fieldPath} in channel ${this.name}`);
              }
            }
            break;

          case 'decr':
            // Decrement a numeric value
            {
              const currentValue = dot.getProperty(obj, fieldPath);
              if (typeof currentValue === 'number') {
                dot.setProperty(obj, fieldPath, currentValue - (fieldValue as number));
              } else {
                console.warn(`Cannot decrement non-numeric field ${fieldPath} in channel ${this.name}`);
              }
            }
            break;

          default:
            console.warn(`Unknown patch operation ${op} in channel ${this.name}`);
        }
      } catch (error) {
        console.warn(`Failed to apply ${op} operation on ${fieldPath} in channel ${this.name}:`, error);
      }
    }
  }
}
