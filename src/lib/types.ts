import type { IdentityStore } from './storage';

/**
 * Configuration for the Nexxus client
 */
export interface NexxusClientConfig {
  /**
   * Base URL of the Nexxus API (e.g., 'http://localhost:3000')
   */
  baseUrl: string;

  /**
   * Transport URI for real-time updates (e.g., ws://localhost:7000)
   */
  transportUri?: string;

  /**
   * Application identifier (required header: nxx-app-id)
   */
  appId: string;

  /**
   * Where the client persists what it knows about itself: its device id and
   * token. Defaults to `localStorage` in the browser; on Node there is no
   * default, because a store needs a path and the SDK will not guess one.
   *
   * Loaded once and cached in memory, not re-read per request. Without
   * persistence the server issues a new device on every run and the user's
   * device list fills with duplicates, so one store per client — never shared
   * between processes.
   */
  store?: IdentityStore;

  /**
   * Logger configuration. The client always logs to stdout/console; this only
   * controls level and format. Consumers can attach additional transports
   * (file in Node, network shipping in the browser, etc.) on the public
   * `client.logger` instance.
   */
  logging?: LoggingConfig;
}

/**
 * Log levels, low → high severity (mirrors the underlying logger's set).
 */
export type LogLevel = 'silly' | 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Configuration for the client's logger.
 */
export interface LoggingConfig {
  /**
   * Minimum level to emit. Default: `'info'`.
   */
  level?: LogLevel;

  /**
   * Output format — `'text'` is human-readable (pretty), `'json'` is structured.
   * Default: `'text'` in the browser, `'json'` in Node.
   */
  format?: 'json' | 'text';
}

/**
 * HTTP request metadata
 */
export interface HttpRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  headers: Record<string, string>;
  body?: string;

  /**
   * Give up after this many milliseconds, response body included. Unset means
   * no limit beyond the platform's own.
   */
  timeoutMs?: number;
}

/**
 * HTTP response metadata
 */
export interface HttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * A device record as the device routes return it.
 *
 * The wire object also carries an empty `subscriptions` array — these routes
 * read a device without hydrating its subscriptions, so it is always `[]` and
 * is deliberately not modelled here.
 */
export interface Device {
  id: string;

  appId: string;

  name: string;

  /** Absent on an application without authentication, where a device has no owner. */
  userId?: string;

  /**
   * How the device's transport behaves. `unknown` until it registers with one,
   * at which point it becomes `volatile` (connection-oriented, subscriptions
   * live only while connected) or `persistent` (push-style, subscriptions
   * outlive the connection).
   */
  type: 'volatile' | 'persistent' | 'unknown';

  /**
   * Reachability. Absent on a device that has never registered with a
   * transport — a freshly created one, for instance. Once set it is
   * overwritten, never cleared.
   */
  status?: 'online' | 'offline' | 'unknown';

  /**
   * The transport carrying this device, or `null` when it is not connected.
   * Absent until the device first registers with one.
   */
  transport?: string | null;

  /**
   * When the device was last seen online, as an **ISO 8601 string** — the one
   * date in the API that is not an integer UNIX timestamp. Volatile devices
   * only; absent on one that has never connected.
   */
  lastSeen?: string;
}

/**
 * FilterQuery DSL — matches on fields a model declares `filterable: true`.
 * Leaf entries are `field: value`; `$and` and `$or` nest.
 */
export interface FilterQuery {
  /** Equality operator */
  eq?: any;

  /** Not equal operator */
  ne?: any;

  /** Greater than operator */
  gt?: any;

  /** Greater than or equal operator */
  gte?: any;

  /** Less than operator */
  lt?: any;

  /** Less than or equal operator */
  lte?: any;

  /** In array operator */
  in?: any[];

  /** AND logical operator */
  $and?: FilterQuery[];

  /** OR logical operator */
  $or?: FilterQuery[];

  /** Field path with nested operators */
  [field: string]: any;
}

/**
 * The query fields every model-facing read shares.
 *
 * Subscribe, unsubscribe, search and count all narrow a model type the same
 * way, and the server validates them through one shared code path — so they
 * are described once here rather than restated per command.
 *
 * The SDK calls the model type `type` everywhere. The wire does not: the
 * subscription routes name it `model`, count sends `type` in the body, and
 * search puts it in the URL. That difference is each command's to handle in
 * `resolveRequest`, not the caller's to remember.
 */
export interface ModelQuery {
  /**
   * A model type the application's schema declares. Subscribing additionally
   * requires one not marked `subscribable: false`.
   * @example "task"
   */
  type: string;

  /**
   * Restrict to models owned by a specific user (that user's id).
   * Only usable on an application with authentication.
   */
  userId?: string;

  /**
   * FilterQuery DSL for advanced filtering. Only fields the model declares
   * `filterable: true` can be matched.
   */
  filter?: FilterQuery;
}

/**
 * A {@link ModelQuery} that can also target one instance by id.
 *
 * Everything but count, which has no `id` parameter — a count is over a
 * matching set, and counting one known instance is not a question worth
 * asking. The server drops the field rather than ignoring it, so it cannot be
 * smuggled in.
 *
 * This is also exactly what identifies a subscription: the channel key is
 * derived from these four fields, which is why it doubles as the unsubscribe
 * input and as the descriptor a `Channel` keeps.
 */
export interface ScopedModelQuery extends ModelQuery {
  /**
   * Restrict to a single model instance.
   * Cannot be used together with `userId`.
   */
  id?: string;
}

/**
 * Pagination, for the routes that return a page of items — subscribe and
 * search. Unsubscribe and count take neither: one matches a stored descriptor,
 * the other counts a whole set.
 */
export interface Paginated {
  /**
   * Maximum number of items to return. Defaults to the application's
   * `defaultLimit`, and may not exceed its `maxLimit`.
   * @minimum 1
   */
  limit?: number;

  /**
   * Number of items to skip.
   * @default 0
   * @minimum 0
   */
  offset?: number;
}

/**
 * What a caller can say about the device it is running on.
 *
 * Developer-supplied, and legitimately so: the SDK cannot know what an
 * installation should be called, and a product may well let the user name it.
 * Expected to grow as the API accepts more device information.
 *
 * The device **id** is deliberately absent, and should never be added here. An
 * id asks the server to reuse a device the caller already owns, which is the
 * client's business, not the developer's — it comes out of the identity store
 * and is attached to authentication calls only.
 */
export interface DeviceInfo {
  /**
   * Human-readable name, shown in the user's device list.
   *
   * Applied only when a device is actually created. It takes no part in
   * matching an existing one, and changing it later does not rename a device
   * that already exists — that goes through the device update route.
   */
  name?: string;
}

/**
 * The two tokens a session is made of. Every route that issues or renews a
 * session returns at least these.
 */
export interface SessionTokens {
  /**
   * The access token, sent as `Authorization: Bearer` on every request. Short-
   * lived — the application decides, an hour by default.
   */
  token: string;

  /**
   * Exchanged for the next pair before the access token expires, and replaced
   * each time it is. Long-lived and revocable; opaque to the client.
   */
  refreshToken: string;
}

/**
 * Why a session ended, as reported by the client's `session_ended` event.
 *
 * - `refresh_rejected` — the server refused the refresh token: the session
 *   expired, was ended by logout elsewhere, or its token was replayed.
 * - `transport_rejected` — the realtime transport refused to register the
 *   device, because its session is over or the device no longer exists.
 * - `logged_out` — the device logged out: this client did, or the transport
 *   closed the connection because another holder of the device did.
 * - `ended_elsewhere` — another holder of the same store dropped the session;
 *   in practice another browser tab logging out, or having its refresh refused.
 *
 * All of them mean the same thing to the application: sign in again.
 */
export type SessionEndReason = 'refresh_rejected' | 'transport_rejected' | 'logged_out' | 'ended_elsewhere';

/** Payload of the client's `session_ended` event. */
export interface SessionEndedEvent {
  reason: SessionEndReason;
}

/**
 * What every route that authenticates a caller returns: the session's tokens,
 * the device they are bound to, and the user they name.
 *
 * `POST /auth/{strategy}` and `POST /user/register` share this shape — a
 * registration now returns a usable session, so there is no register-then-login
 * sequence and both can share a response handler.
 *
 * `device.name` reflects what the server stored, which is the name sent at
 * creation time — not necessarily the one just sent, since a reused device
 * keeps the name it already had.
 */
export interface SessionResponse extends SessionTokens {
  device: {
    id: string;
    name: string;
  };

  user: {
    id: string;
    username: string;
  };
}

/**
 * JsonPatch operation types.
 *
 * `remove` is deliberately absent. The OpenAPI spec and the migration brief
 * both list it, but the server does not implement it: core rejects it as an
 * unsupported operation, so it could only ever produce a `400`. Add it here
 * when the server gains it, not because the spec mentions it.
 */
export type PatchOperation = 'replace' | 'append' | 'prepend' | 'incr' | 'decr';

/**
 * Application model instance
 */
export interface AppModel {
  /**
   * Unique model instance identifier
   */
  id: string;

  /**
   * Model type as defined in application schema
   */
  type: string;

  /**
   * Application ID this model belongs to
   */
  appId: string;

  /**
   * ID of the user who owns this model (optional for some model types)
   */
  userId?: string;

  /**
   * When the model was created, as an integer UNIX timestamp in **seconds** —
   * multiply by 1000 before handing it to `new Date()`.
   */
  createdAt: number;

  /**
   * When the model was last updated, as an integer UNIX timestamp in
   * **seconds**.
   */
  updatedAt: number;

  /**
   * Monotonically-increasing per-document version, assigned by the database
   * adapter on every write. Channels use it for gap detection / dedup when
   * applying realtime updates.
   *
   * Absent on a model declared `transient`: those skip the writer and are
   * never stored, so nothing ever stamps one. They are also create-only, so a
   * transient model is never the subject of an update that would need it.
   */
  version?: number;

  /**
   * Custom fields based on application schema
   */
  [key: string]: any;
}

/**
 * Nexxus's own patch shape — not RFC 6902. `path` and `value` are parallel
 * arrays, so one patch can touch several fields at once.
 *
 * One type for both directions: what `UpdateModelCommand` and
 * `UpdateUserCommand` send, and what a `model_updated` event delivers. The
 * server uses a single schema for all three, and the transport's patches are
 * that same shape with the server-side metadata stripped.
 */
export interface JsonPatch {
  /**
   * - `replace`: set the field
   * - `append` / `prepend`: add to the end / start of an array or string
   * - `incr` / `decr`: add to / subtract from a number
   */
  op: PatchOperation;

  /**
   * Dot-separated field paths, e.g. `details.age`. Each must be declared in
   * the target's schema.
   */
  path: string[];

  /**
   * One value per `path`, in the same order and of the same length.
   *
   * A date may be sent as a UNIX timestamp in **seconds** or as a parseable
   * date string; both are stored as seconds. Never milliseconds — `Date.now()`
   * would land some fifty thousand years in the future.
   */
  value: any[];
}

/**
 * Identity fields shared by updated/deleted events. (The full model is only
 * sent on create.)
 */
export interface ModelIdentity {
  id: string;
  type: string;
  appId: string;
  userId?: string;
}

/** Channels (subscription getKey() values) an event was routed to. */
export interface TransportMetadata {
  channels: string[];
}

/**
 * Inner payload for a created model — the `data` of the wire envelope.
 */
export interface TransportModelCreatedData {
  event: 'model_created';
  model: AppModel;
  metadata: TransportMetadata;
}

/**
 * Inner payload for an updated model. All patches target the same `model` and
 * should be applied in order. `model.version` is the post-update version stamp;
 * the channel applies the patches only when it's exactly one ahead of the local
 * copy (otherwise it resyncs via GET, or ignores a stale/duplicate event).
 */
export interface TransportModelUpdatedData {
  event: 'model_updated';

  /**
   * Always carries `version`, unlike {@link AppModel} — only stored models can
   * be updated, and every stored write is stamped.
   */
  model: ModelIdentity & { version: number };

  /**
   * Carry no metadata of their own: every patch here targets `model`, whose
   * identity and matched channels are hoisted to the event level.
   */
  patches: JsonPatch[];

  metadata: TransportMetadata;
}

/**
 * Inner payload for a deleted model.
 */
export interface TransportModelDeletedData {
  event: 'model_deleted';
  model: ModelIdentity;
  metadata: TransportMetadata;
}

/**
 * Union of the model-change inner payloads forwarded to channel routing.
 */
export type TransportModelEventData =
  | TransportModelCreatedData
  | TransportModelUpdatedData
  | TransportModelDeletedData;

/** Server → client acknowledgement of a `register` or `refresh_access_token` frame. */
export interface TransportAck {
  success: boolean;
  message?: string;
}

/**
 * What a transport error frame's `code` says went wrong. Branch on this, never
 * on the message — messages are for humans and may change.
 *
 * - `TOKEN_EXPIRED` — the token sent had already expired. Refresh it and send
 *   it again; the connection stays open.
 * - `SESSION_ENDED` — the device's session is over: it logged out, or its
 *   refresh session ran out. Refreshing won't help; sign in again.
 * - `DEVICE_NOT_FOUND` — the device the token names no longer exists.
 * - `INVALID_PARAMETERS` — anything else wrong with the frame or its token.
 * - `INTERNAL_SERVER_ERROR` — the worker failed.
 *
 * Left open to other strings, so a code added server-side later doesn't make
 * the type lie.
 */
export type TransportErrorCode =
  | 'TOKEN_EXPIRED'
  | 'SESSION_ENDED'
  | 'DEVICE_NOT_FOUND'
  | 'INVALID_PARAMETERS'
  | 'INTERNAL_SERVER_ERROR'
  | (string & {});

/** Server → client error frame. */
export interface TransportErrorData {
  message: string;
  code: TransportErrorCode;
}

/**
 * Every server → client message is a `{ event, data }` envelope. This is the
 * discriminated union of all frames the transport can send.
 */
export type TransportServerMessage =
  | { event: 'register'; data: TransportAck }
  | { event: 'refresh_access_token'; data: TransportAck }
  | { event: 'error'; data: TransportErrorData }
  | { event: 'model_created'; data: TransportModelCreatedData }
  | { event: 'model_updated'; data: TransportModelUpdatedData }
  | { event: 'model_deleted'; data: TransportModelDeletedData };

/**
 * Client → server frames. Both carry an access token and nothing else — never
 * the refresh token, which goes to the refresh and logout routes only.
 *
 * - `register` claims, on this connection, the device the token names. A
 *   device id alone is not accepted: the worker verifies the token and reads
 *   the device from its claims, so a client can only register its own.
 * - `refresh_access_token` moves an already registered connection onto a newer
 *   token for the same device, so it keeps going without reconnecting.
 */
export interface TransportClientMessage {
  event: 'register' | 'refresh_access_token';
  data: {
    token: string;
  };
}

/**
 * Payload of the client's `disconnected` event.
 *
 * The server closes with its own codes when it ends a connection:
 * - `4001` (`logged_out`) — the device's session was ended by a logout. The
 *   client ends its session too; don't reconnect.
 * - `4002` (`token_expired`) — the connection's access token expired before a
 *   newer one reached it.
 *
 * Any other code is an ordinary close, the client's own included. After any
 * disconnect the server has dropped the device's subscriptions.
 */
export interface TransportDisconnect {
  code: number;
  reason: string;
}
