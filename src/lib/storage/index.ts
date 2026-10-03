import { IdentityStore } from './IdentityStore';
import { LocalStorageStore } from './LocalStorageStore';

export {
  IdentityStore,
  type BaseIdentityStoreConfig,
  type IdentityChangeListener,
  type StoredIdentity,
  type StoredIdentityPatch,
} from './IdentityStore';
export { MemoryStore } from './MemoryStore';
export { LocalStorageStore } from './LocalStorageStore';
export { SqliteStore, type SqliteStoreConfig } from './SqliteStore';

/**
 * The store to use when the client was given none.
 *
 * Only the browser gets a default. Node's store needs a path to its database
 * file, and there is no location the SDK can pick on a consumer's behalf that
 * isn't a worse guess than asking — so it asks, loudly, instead of falling back
 * to something that doesn't persist and letting device records pile up.
 */
export function createDefaultStore(): IdentityStore {
  if (LocalStorageStore.isAvailable()) {
    return new LocalStorageStore();
  }

  throw new Error(
    'No IdentityStore configured and no localStorage available. ' +
    'On Node, pass one explicitly: `new SqliteStore({ path: "/path/to/nexxus.db" })`.'
  );
}
