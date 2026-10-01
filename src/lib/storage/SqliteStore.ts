import { IdentityStore, type BaseIdentityStoreConfig, type StoredIdentity } from './IdentityStore';

// Type-only, so the specifier is erased at compile time and never reaches a
// bundler. The runtime import is deliberately opaque — see `loadDriver`.
import type { DatabaseSync, StatementSync } from 'node:sqlite';

/** What `SELECT` reads back: the serialized record. */
interface IdentityRow {
  record: string;
}

/** The database handle and its prepared statements, created together. */
interface Connection {
  db: DatabaseSync;
  select: StatementSync;
  upsert: StatementSync;
  remove: StatementSync;
}

export interface SqliteStoreConfig extends BaseIdentityStoreConfig {
  /**
   * Where the database file lives.
   *
   * Required, with no default: an SDK guessing a location on someone's disk is
   * a bad default, and a path relative to the working directory silently
   * changes meaning when the process is started from somewhere else.
   *
   * Give every worker process its own path. Sharing one means sharing one
   * device identity — and in a load test each worker is meant to be a distinct
   * device, not a contender for the same row.
   */
  path: string;
}

/**
 * The record is one serialized value, not a column per field. Nothing here is
 * ever queried by anything but its key, and a column per field would need a
 * migration every time the record gains one.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS identity_records (
    key        TEXT PRIMARY KEY,
    record     TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`;

const SELECT = 'SELECT record FROM identity_records WHERE key = ?';

const UPSERT = `
  INSERT INTO identity_records (key, record, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(key) DO UPDATE SET
    record     = excluded.record,
    updated_at = excluded.updated_at
`;

const DELETE = 'DELETE FROM identity_records WHERE key = ?';

/**
 * The Node {@link IdentityStore}, backed by the built-in `node:sqlite`.
 *
 * Chosen over the `sqlite3` package to keep the SDK dependency-free: `sqlite3`
 * needs a native build and an install script that fetches a prebuilt binary,
 * which fails outright under `ignore-scripts` and drags in a long transitive
 * chain. This has neither.
 *
 * **`node:sqlite` is still flagged experimental** and emits an
 * `ExperimentalWarning` the first time it loads — once per process, on stderr.
 * A library cannot suppress that for its host; run node with
 * `--disable-warning=ExperimentalWarning` (or `NODE_NO_WARNINGS=1`) if it is
 * noise in your logs. Only the handful of calls below are used, so the
 * "might change at any time" caveat has a small surface.
 *
 * The connection opens lazily on first use, so constructing a store costs
 * nothing and a client that never authenticates never touches the disk.
 * {@link close} should be called before a process expects to exit.
 *
 * Unlike the browser store this never degrades to memory. A path that cannot
 * be opened is a configuration error, and quietly carrying on in memory would
 * hide it behind a slow leak of device records.
 *
 * One process per file is the rule, so the base class's in-process `lock` and
 * silent `onChange` are all the coordination this store needs.
 */
export class SqliteStore extends IdentityStore<SqliteStoreConfig> {
  private connection?: Connection;

  constructor(config: SqliteStoreConfig) {
    super(config);

    // After `super`, because a derived constructor cannot touch `this` before
    // it. Nothing has opened a handle yet, so throwing here costs nothing.
    if (!this.config?.path) {
      throw new Error('SqliteStore requires a `path` to its database file.');
    }
  }

  public async load(key: string): Promise<StoredIdentity | null> {
    const { select } = await this.open();
    const row = select.get(key) as IdentityRow | undefined;

    return row ? IdentityStore.parseRecord(row.record) : null;
  }

  public async clear(key: string): Promise<void> {
    const { remove } = await this.open();

    remove.run(key);
  }

  protected async write(key: string, record: StoredIdentity): Promise<void> {
    const { upsert } = await this.open();

    upsert.run(
      key,
      IdentityStore.serializeRecord(record),
      // Seconds, matching the convention every date in Nexxus follows.
      Math.floor(Date.now() / 1000),
    );
  }

  public async close(): Promise<void> {
    const open = this.connection;

    if (!open) {
      return;
    }

    // Cleared first so a failed close can't leave a half-shut handle memoized
    // for the next call to reuse.
    this.connection = undefined;

    open.db.close();

    return Promise.resolve();
  }

  /**
   * Open the database, ensure the schema and prepare the statements, once.
   *
   * `node:sqlite` is synchronous, so there is no connection race to guard
   * against — but this stays async because the {@link IdentityStore} contract
   * is, and a store backed by something genuinely async must be able to
   * satisfy it.
   */
  private async open(): Promise<Connection> {
    if (this.connection) {
      return this.connection;
    }

    const { DatabaseSync: Database } = await SqliteStore.loadDriver();
    const db = new Database(this.config.path);

    db.exec(SCHEMA);
    // Cheap insurance. Stores are not meant to be shared between processes,
    // but if a path ever is, waiting beats failing the write outright.
    db.exec('PRAGMA busy_timeout = 5000');

    // Prepared once and reused: the statements outlive every call, and
    // re-parsing the same SQL on each read would be pure waste.
    this.connection = {
      db,
      select: db.prepare(SELECT),
      upsert: db.prepare(UPSERT),
      remove: db.prepare(DELETE),
    };

    return this.connection;
  }

  /**
   * Import `node:sqlite` at call time.
   *
   * The specifier is held in a variable so it is not a literal: a bundler
   * cannot then follow it into a browser bundle, where a Node builtin would be
   * an unresolvable import even though this code never runs there. The cast
   * restores the types the indirection hides.
   */
  private static async loadDriver(): Promise<typeof import('node:sqlite')> {
    const specifier = 'node:sqlite';

    try {
      return await import(specifier) as typeof import('node:sqlite');
    } catch (cause) {
      throw new Error(
        'SqliteStore could not load `node:sqlite`. It needs Node 22.5 or newer, ' +
        'and is not available outside Node — use a different IdentityStore there.',
        { cause }
      );
    }
  }
}
