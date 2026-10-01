import { IdentityStore, type IdentityChangeListener, type StoredIdentity } from './IdentityStore';
import { MemoryStore } from './MemoryStore';

/**
 * Namespace for every key this store writes, so an application embedding the
 * SDK can't collide with it.
 */
const KEY_PREFIX = 'nexxus:identity:';

/** Names the cross-tab lock for a key — see `lock`. */
const LOCK_PREFIX = 'nexxus:lock:';

/** Written and removed once, to find out whether writes are actually allowed. */
const PROBE_KEY = 'nexxus:probe';

/**
 * The browser {@link IdentityStore}, backed by `localStorage`.
 *
 * `sessionStorage` is deliberately not an option: it is cleared when the tab
 * closes, which would mean a new device record per tab — the opposite of what
 * persisting an identity is for.
 *
 * **Shared between tabs.** Every tab of the origin reads and writes the same
 * record, so they share one device and one refresh token. The server ends a
 * session whose refresh token is presented by two holders that have diverged,
 * so this store coordinates them: {@link lock} is a Web Lock, held across tabs,
 * and {@link onChange} relays the `storage` event other tabs' writes raise.
 *
 * **Degradation.** `localStorage` is not always usable. Safari in private mode
 * throws on write, and storage can be disabled by policy or an extension.
 * Rather than throwing during login, this store falls back to an in-process
 * {@link MemoryStore} and reports {@link isPersistent} as `false`, so the
 * client can warn that the identity will not survive the page. The fallback is
 * one-way: once writes have failed, storage is treated as gone rather than
 * retried on every call. A degraded tab shares nothing with other tabs, so it
 * coordinates only with itself.
 */
export class LocalStorageStore extends IdentityStore {
  private fallback?: MemoryStore;

  constructor() {
    // Nothing to configure today; the type parameter is here so a future
    // setting (a key prefix override, say) is additive rather than breaking.
    super({});

    if (!LocalStorageStore.canWrite()) {
      this.fallback = new MemoryStore();
    }
  }

  /**
   * Whether this environment has a `localStorage` at all — the check the
   * factory uses to pick a store. Says nothing about whether it accepts
   * writes; {@link canWrite} answers that.
   *
   * Reading the property is itself guarded: in a blocked or sandboxed context
   * merely touching `window.localStorage` can throw rather than return
   * `undefined`.
   */
  public static isAvailable(): boolean {
    try {
      return typeof window !== 'undefined' && !!window.localStorage;
    } catch {
      return false;
    }
  }

  private static canWrite(): boolean {
    if (!LocalStorageStore.isAvailable()) {
      return false;
    }

    try {
      window.localStorage.setItem(PROBE_KEY, '1');
      window.localStorage.removeItem(PROBE_KEY);

      return true;
    } catch {
      return false;
    }
  }

  /**
   * The Web Locks API, when this context has it. It is absent outside a secure
   * context (plain `http:` on anything but localhost), and in older browsers.
   */
  private static webLocks(): LockManager | undefined {
    try {
      return typeof navigator !== 'undefined' ? navigator.locks ?? undefined : undefined;
    } catch {
      return undefined;
    }
  }

  public load(key: string): Promise<StoredIdentity | null> {
    if (this.fallback) {
      return this.fallback.load(key);
    }

    let raw: string | null;

    try {
      raw = window.localStorage.getItem(KEY_PREFIX + key);
    } catch {
      return this.degrade().load(key);
    }

    return Promise.resolve(raw === null ? null : IdentityStore.parseRecord(raw));
  }

  public clear(key: string): Promise<void> {
    if (this.fallback) {
      return this.fallback.clear(key);
    }

    try {
      window.localStorage.removeItem(KEY_PREFIX + key);
    } catch {
      return this.degrade().clear(key);
    }

    return Promise.resolve();
  }

  protected write(key: string, record: StoredIdentity): Promise<void> {
    if (this.fallback) {
      return this.fallback.write(key, record);
    }

    try {
      window.localStorage.setItem(KEY_PREFIX + key, IdentityStore.serializeRecord(record));
    } catch {
      // Quota, or storage revoked mid-session. The record is a few hundred
      // bytes, so a quota failure here means storage is effectively gone.
      return this.degrade().write(key, record);
    }

    return Promise.resolve();
  }

  /**
   * Held across every tab of the origin, through the Web Locks API — the
   * browser releases it automatically if the holding tab closes or crashes, so
   * a tab that dies mid-refresh cannot wedge the others.
   *
   * Falls back to the in-process lock when this tab has degraded to memory (it
   * shares nothing to coordinate), or when the context has no Web Locks. The
   * latter leaves tabs uncoordinated, and is why this SDK should be served over
   * HTTPS or from localhost.
   */
  public lock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const locks = LocalStorageStore.webLocks();

    if (this.fallback || !locks) {
      return super.lock(key, fn);
    }

    // Returns what the callback returns, once the lock is released.
    return locks.request(LOCK_PREFIX + key, () => fn()) as Promise<T>;
  }

  /**
   * Relays the `storage` event, which the browser raises in every OTHER tab of
   * the origin when one writes — never in the writer itself, which is exactly
   * the contract {@link IdentityStore.onChange} promises.
   *
   * A degraded tab shares nothing, so it has no other holder to hear from.
   */
  public onChange(key: string, listener: IdentityChangeListener): () => void {
    if (this.fallback || !LocalStorageStore.isAvailable()) {
      return super.onChange(key, listener);
    }

    const storageKey = KEY_PREFIX + key;
    const handler = (event: StorageEvent) => {
      // Same-origin `sessionStorage` raises the same event; only ours counts.
      if (event.storageArea !== window.localStorage) {
        return;
      }

      // A `null` key is `localStorage.clear()`: every key gone at once.
      if (event.key !== null && event.key !== storageKey) {
        return;
      }

      listener(event.key === null || event.newValue === null ? null : IdentityStore.parseRecord(event.newValue));
    };

    window.addEventListener('storage', handler);

    return () => window.removeEventListener('storage', handler);
  }

  public isPersistent(): boolean {
    return this.fallback === undefined;
  }

  /**
   * Switch to the in-memory fallback for good and hand it back, so a failing
   * call can complete against it instead of surfacing an exception.
   */
  private degrade(): MemoryStore {
    if (!this.fallback) {
      this.fallback = new MemoryStore();
    }

    return this.fallback;
  }
}
