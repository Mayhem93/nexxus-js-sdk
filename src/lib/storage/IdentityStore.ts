/**
 * What the SDK persists between runs so a returning client keeps its identity.
 *
 * Every field is optional because the record is built up over a session: a
 * client that has not authenticated yet has nothing at all.
 */
export interface StoredIdentity {
  /**
   * The device this client last used. Replayed as the `device.id` hint on every
   * authentication so a returning user reuses their device record instead of
   * accruing a new one each time they sign in.
   *
   * Not a credential: the server validates the hint against the calling
   * application and user and silently issues a fresh device when it does not
   * resolve. Safe to persist where a token would not be.
   */
  deviceId?: string;

  /**
   * The current access token. Short-lived — the application decides, an hour
   * by default — and renewed with {@link refreshToken} before it expires.
   */
  token?: string;

  /**
   * The credential that obtains the next access token. Long-lived (the
   * session's absolute lifetime, 30 days by default) and replaced on every
   * refresh, so this is the most sensitive field in the record. Opaque: never
   * parsed, and sent nowhere but the refresh and logout routes.
   */
  refreshToken?: string;

  /**
   * When {@link token} arrived, as UNIX seconds on **this device's** clock.
   *
   * The refresh is scheduled from it rather than from the token's `exp`, which
   * is stamped by the server's clock; this value is only ever compared against
   * the local clock, so drift between the two does not matter. Persisted
   * because the schedule has to survive a restart — a token loaded from storage
   * gives no other way to tell how old it is.
   */
  receivedAt?: number;

  /**
   * Who `token` names, when the application has authentication. Deliberately
   * not part of the store key — it is not known until a login responds, so it
   * cannot be used to look up the hint that login needs. Kept in the record so
   * the client can tell that the account behind the stored device changed.
   */
  userId?: string;
}

/**
 * A change to a {@link StoredIdentity}, field by field:
 *
 * - a value sets the field;
 * - `null` removes it;
 * - absent, or `undefined`, leaves it as it is.
 *
 * The same convention as JSON Merge Patch (RFC 7396). `null` is what lets a
 * caller drop the tokens while keeping the device id — signing out, or a
 * session the server has ended — which `undefined` alone cannot express.
 */
export type StoredIdentityPatch = {
  [K in keyof StoredIdentity]?: StoredIdentity[K] | null;
};

/**
 * Receives the record as another holder of the store left it, or `null` when
 * it was removed.
 */
export type IdentityChangeListener = (identity: StoredIdentity | null) => void;

/**
 * The base every store's configuration extends.
 *
 * Deliberately empty: a store that needs nothing configured — the browser and
 * in-memory ones — should not have to invent a field, and the type exists to
 * give the ones that *do* a declared place to put it.
 *
 * An empty interface rather than `Record<string, unknown>` or `object` on
 * purpose. Interfaces get no implicit index signature, so a narrow
 * `interface SqliteStoreConfig { path: string }` would fail a
 * `Record<string, unknown>` constraint; and an interface cannot `extends` a
 * bare `object` alias. This is the one shape that allows both.
 */
export interface BaseIdentityStoreConfig {}

/**
 * Where a {@link StoredIdentity} lives.
 *
 * Records are keyed by application id: one deployment serves many applications,
 * and a client talking to two of them must not have one overwrite the other.
 * There is deliberately no per-user keying — the SDK supports one account per
 * store, so a second account signing in replaces the record and, as a
 * consequence, gets its own device.
 *
 * Every operation is async because a backing engine may be: a keychain or a
 * remote store would be. `localStorage` and `node:sqlite` are synchronous and
 * simply resolve immediately.
 *
 * A store is never shared between clients or worker processes — with one
 * exception the design has to live with: browser tabs of the same origin share
 * `localStorage`, and so share one record, one device and one refresh token.
 * The server ends a session when two holders refresh it independently, so
 * {@link lock} and {@link onChange} exist to let those tabs take turns and
 * learn each other's results.
 *
 * Subclasses implement three primitives — {@link load}, {@link write} and
 * {@link clear}. {@link save} is provided, because its merge semantics are
 * exactly the part an implementation should not get to reinvent.
 *
 * @template TConfig - What this store needs configured, declared by the
 *   subclass as an extension of {@link BaseIdentityStoreConfig}. Defaults to
 *   the empty base, so a store with nothing to configure — and any caller that
 *   only holds a store to use it — can name the type without an argument.
 */
export abstract class IdentityStore<TConfig extends BaseIdentityStoreConfig = BaseIdentityStoreConfig> {
  /**
   * What this store was constructed with. Held by the base so every subclass
   * reaches its settings the same way, and so the type travels with the class
   * rather than living in a field each one declares for itself.
   */
  protected readonly config: TConfig;

  /**
   * The tail of each key's queue for the in-process {@link lock}: a promise
   * that settles when the last queued holder is done, and never rejects.
   */
  private readonly lockQueues: Map<string, Promise<void>> = new Map();

  constructor(config: TConfig) {
    this.config = config;
  }

  /**
   * Apply `patch` to `current` — see {@link StoredIdentityPatch} for what a
   * value, `null` and `undefined` each mean.
   *
   * Public and static because the client keeps an in-memory copy of the record
   * and has to fold updates into it exactly as {@link save} does. Two
   * implementations of this would drift, and the symptom would be a token
   * disappearing for no visible reason.
   */
  public static merge(
    current: StoredIdentity | null | undefined,
    patch: StoredIdentityPatch
  ): StoredIdentity {
    const merged: Record<string, unknown> = { ...current };

    for (const [ field, value ] of Object.entries(patch)) {
      if (value === null) {
        delete merged[field];
      } else if (value !== undefined) {
        merged[field] = value;
      }
    }

    return merged as StoredIdentity;
  }

  /**
   * Encode a record for a store that keeps it as text. Paired with
   * {@link parseRecord} so the format is defined in one place.
   */
  protected static serializeRecord(record: StoredIdentity): string {
    return JSON.stringify(record);
  }

  /**
   * Decode what {@link serializeRecord} wrote, or `null` if it is unreadable.
   *
   * An unreadable record — something else wrote over it, or an older format is
   * sitting there — is treated as no record. That costs one device and heals
   * on the next write, where throwing would wedge the client until someone
   * cleared storage by hand.
   */
  protected static parseRecord(raw: string): StoredIdentity | null {
    try {
      const parsed: unknown = JSON.parse(raw);

      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as StoredIdentity
        : null;
    } catch {
      return null;
    }
  }

  /** The stored record for `key`, or `null` if there is none. */
  public abstract load(key: string): Promise<StoredIdentity | null>;

  /** Remove the record for `key`. A key with no record is not an error. */
  public abstract clear(key: string): Promise<void>;

  /**
   * Replace the whole record for `key`, creating it when absent.
   *
   * Protected because callers merge through {@link save}; this is the raw put
   * a subclass provides, and it always receives a complete record.
   */
  protected abstract write(key: string, record: StoredIdentity): Promise<void>;

  /**
   * Apply `patch` to the record for `key`, creating it when absent.
   *
   * A patch rather than a replacement, so a caller that only learned one field
   * — a device id from a registration, say — cannot clobber the token sitting
   * beside it. See {@link merge} for the exact semantics. Use {@link clear} to
   * remove a record outright.
   */
  public async save(key: string, patch: StoredIdentityPatch): Promise<void> {
    const current = await this.load(key);

    await this.write(key, IdentityStore.merge(current, patch));
  }

  /**
   * Run `fn` while holding the exclusive lock for `key`, and return its result.
   * Holders queue in arrival order; the lock is released when `fn` settles,
   * whether it resolves or throws.
   *
   * Advisory: {@link load} and {@link save} do not take it, so it serializes
   * exactly what callers put inside it — typically a read, then a refresh, then
   * a write, which must not interleave with another holder's.
   *
   * The default only coordinates callers inside this process, which is all a
   * store that is never shared needs. A store that is shared across processes
   * or tabs overrides it.
   */
  public lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.lockQueues.get(key) ?? Promise.resolve();
    // `previous` never rejects (see below), so `fn` always gets its turn.
    const result = previous.then(fn);
    const settled = result.then(() => undefined, () => undefined);

    this.lockQueues.set(key, settled);

    // The last holder out removes the queue, so idle keys leave nothing behind.
    void settled.then(() => {
      if (this.lockQueues.get(key) === settled) {
        this.lockQueues.delete(key);
      }
    });

    return result;
  }

  /**
   * Be told when **another holder** of this store changes the record for
   * `key` — in practice, another browser tab. A holder's own writes are not
   * echoed back to it. Returns a function that stops the notifications.
   *
   * The default never calls `listener`: a store that is not shared has no
   * other holder to hear from. A shared one overrides this.
   */
  public onChange(_key: string, _listener: IdentityChangeListener): () => void {
    return () => {};
  }

  /**
   * Release whatever the store holds open. The default is a no-op; the sqlite
   * store overrides it, because an open handle keeps the Node event loop alive
   * and a process that skips this will not exit.
   */
  public close(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Whether writes actually survive the process or page.
   *
   * `false` means the store has degraded to memory — a browser refusing
   * storage, say — and the caller should expect a new device next run. Exposed
   * so the client can warn rather than silently losing the identity it is
   * trying to keep. Defaults to `true`; a store that cannot promise that says
   * so by overriding.
   */
  public isPersistent(): boolean {
    return true;
  }
}
