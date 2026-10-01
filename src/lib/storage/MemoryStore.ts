import { IdentityStore, type StoredIdentity } from './IdentityStore';

/**
 * An {@link IdentityStore} that keeps records in a plain `Map`.
 *
 * Not intended as a client's storage: nothing here survives the process or the
 * page, so every run registers a new device — the growth this layer exists to
 * stop. It is here for two jobs:
 *
 * - the fallback {@link LocalStorageStore} degrades to when a browser refuses
 *   storage, so a user in private browsing gets a working session for the life
 *   of the page rather than an exception;
 * - a substitute in tests, where a real engine buys nothing.
 *
 * Pass one deliberately and {@link isPersistent} will tell the client to warn.
 */
export class MemoryStore extends IdentityStore {
  private readonly records: Map<string, StoredIdentity> = new Map();

  constructor() {
    // Nothing to configure — the empty base config is the whole of it.
    super({});
  }

  public load(key: string): Promise<StoredIdentity | null> {
    const record = this.records.get(key);

    // Copied on the way out as well as in: the caller owns what it receives,
    // and a mutation of it must not reach back into the store.
    return Promise.resolve(record ? { ...record } : null);
  }

  public clear(key: string): Promise<void> {
    this.records.delete(key);

    return Promise.resolve();
  }

  /**
   * Widened from `protected` so {@link LocalStorageStore} can put an
   * already-merged record straight into its fallback. Merging a second time
   * through `save` would fold it into whatever the fallback happened to hold,
   * which can resurrect a field the real store had already dropped.
   */
  public write(key: string, record: StoredIdentity): Promise<void> {
    this.records.set(key, { ...record });

    return Promise.resolve();
  }

  public isPersistent(): boolean {
    return false;
  }
}
