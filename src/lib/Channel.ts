import { SubscribeOutput } from './commands/subscription/Subscribe';
import type { CountInput } from './commands/model/Count';
import { AppModel, ModelIdentity, ScopedModelQuery, JsonPatch } from './types';
import { NexxusClient } from './Client';

import EventEmitter from 'eventemitter3';
import * as dot from 'dot-prop';

interface ChannelEvents {
  model_created: (model: AppModel) => void;
  model_updated: (model: ModelIdentity, patches: JsonPatch[]) => void;
  model_deleted: (model: ModelIdentity) => void;
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
  /**
   * The descriptor that identifies this channel — the subscribe request minus
   * its pagination, which only shaped the first page. Kept so the channel can
   * derive its own count request. `id`, when set, marks an id-scoped channel.
   */
  private readonly subscription: ScopedModelQuery;
  private countExecutor?: (query: CountInput) => Promise<number>;

  constructor(input: SubscribeOutput, subscription: ScopedModelQuery) {
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
   * subscription criteria (`type` + `userId` + `filter`), independent of the
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

    // Named rather than spread: count takes a deliberately narrower query, so a
    // field later added to the descriptor must not reach it by default.
    const { type, userId, filter } = this.subscription;

    return this.countExecutor({ type, userId, filter });
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

    if (current && Channel.isStale(model, current)) {
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
   *
   * Returns `false` when a patch can't be applied exactly — an `append` to a
   * field with no value yet, say, whose type only the schema knows. The version
   * is then left as it was and nothing is emitted: the copy is behind the
   * server, and the caller must re-read it rather than build on it. Patches
   * before the failing one stay applied until the re-read replaces the copy.
   */
  public applyPatches(id: string, patches: JsonPatch[], version: number): boolean {
    const obj = this.items.get(id);

    if (!obj) {
      return false;
    }

    for (const patch of patches) {
      if (!this.applyPatch(obj, patch)) {
        return false;
      }
    }

    obj.version = version;

    this.emit('model_updated', obj, patches);

    return true;
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

  /**
   * Whether `incoming` is no newer than `current` and should be dropped.
   *
   * Ordering needs a version on both sides. A model without one is transient —
   * it skipped the writer, so nothing stamped it — and transient models are
   * create-only, so there is no later update for it to race; the write is let
   * through. Likewise a versioned model always supersedes an unversioned copy,
   * since it is the strictly more informative of the two.
   */
  private static isStale(incoming: AppModel, current: AppModel): boolean {
    if (incoming.version === undefined || current.version === undefined) {
      return false;
    }

    return incoming.version <= current.version;
  }

  /**
   * Apply one patch in place. Returns `false` when the copy can't follow it
   * exactly; paths before the one that failed stay applied.
   */
  private applyPatch(obj: AppModel, patch: JsonPatch): boolean {
    const { op, path, value } = patch;

    // Ensure path and value arrays have the same length
    if (path.length !== value.length) {
      NexxusClient.logger.warn('channel: path and value arrays length mismatch', { label: 'channel', channel: this.name, type: obj.type, id: obj.id, op });
      return false;
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

              // No value yet: the server creates an array or a string, and only
              // the schema says which. Not a fault — the caller re-reads.
              if (currentValue === undefined || currentValue === null) {
                return false;
              }

              if (Array.isArray(currentValue)) {
                const arr = currentValue as any[];
                arr.push(fieldValue);
              } else if (typeof currentValue === 'string') {
                dot.setProperty(obj, fieldPath, currentValue + (fieldValue as string));
              } else {
                NexxusClient.logger.warn('channel: cannot append to non-array/non-string field', { label: 'channel', channel: this.name, type: obj.type, id: obj.id, op, path: fieldPath });
                return false;
              }
            }
            break;

          case 'prepend':
            // Prepend to an array or string at the given path; a field with no
            // value yet can't be followed, as with `append`
            {
              const currentValue = dot.getProperty(obj, fieldPath);

              if (currentValue === undefined || currentValue === null) {
                return false;
              }

              if (Array.isArray(currentValue)) {
                const arr = currentValue as any[];
                arr.unshift(fieldValue);
              } else if (typeof currentValue === 'string') {
                dot.setProperty(obj, fieldPath, (fieldValue as string) + currentValue);
              } else {
                NexxusClient.logger.warn('channel: cannot prepend to non-array/non-string field', { label: 'channel', channel: this.name, type: obj.type, id: obj.id, op, path: fieldPath });
                return false;
              }
            }
            break;

          case 'incr':
            // Increment a numeric value. A field with no value counts as 0, as
            // it does on the server.
            {
              const currentValue = dot.getProperty(obj, fieldPath) ?? 0;
              if (typeof currentValue === 'number') {
                dot.setProperty(obj, fieldPath, currentValue + (fieldValue as number));
              } else {
                NexxusClient.logger.warn('channel: cannot increment non-numeric field', { label: 'channel', channel: this.name, type: obj.type, id: obj.id, op, path: fieldPath });
                return false;
              }
            }
            break;

          case 'decr':
            // Decrement a numeric value. A field with no value counts as 0.
            {
              const currentValue = dot.getProperty(obj, fieldPath) ?? 0;
              if (typeof currentValue === 'number') {
                dot.setProperty(obj, fieldPath, currentValue - (fieldValue as number));
              } else {
                NexxusClient.logger.warn('channel: cannot decrement non-numeric field', { label: 'channel', channel: this.name, type: obj.type, id: obj.id, op, path: fieldPath });
                return false;
              }
            }
            break;

          case 'remove':
            // Take elements out of an array: `{ v }` removes every element equal
            // to `v`, `{ i }` the element at index `i`. A field with no value, or
            // an index past the end, removes nothing — as on the server.
            {
              const currentValue = dot.getProperty(obj, fieldPath);

              if (currentValue === undefined || currentValue === null) {
                break;
              }

              if (!Array.isArray(currentValue)) {
                NexxusClient.logger.warn('channel: cannot remove from non-array field', { label: 'channel', channel: this.name, type: obj.type, id: obj.id, op, path: fieldPath });
                return false;
              }

              const arr = currentValue as any[];

              if (Number.isInteger(fieldValue?.i) && fieldValue.i >= 0) {
                arr.splice(fieldValue.i, 1);
              } else if (fieldValue !== null && typeof fieldValue === 'object' && 'v' in fieldValue) {
                for (let k = arr.length - 1; k >= 0; k--) {
                  if (arr[k] === fieldValue.v) {
                    arr.splice(k, 1);
                  }
                }
              } else {
                NexxusClient.logger.warn('channel: invalid remove value', { label: 'channel', channel: this.name, type: obj.type, id: obj.id, op, path: fieldPath });
                return false;
              }
            }
            break;

          default:
            NexxusClient.logger.warn('channel: unknown patch operation', { label: 'channel', channel: this.name, type: obj.type, id: obj.id, op, path: fieldPath });
            return false;
        }
      } catch (error) {
        NexxusClient.logger.warn('channel: failed to apply patch operation', { label: 'channel', channel: this.name, type: obj.type, id: obj.id, op, path: fieldPath, error: error instanceof Error ? error.message : String(error) });
        return false;
      }
    }

    return true;
  }
}
