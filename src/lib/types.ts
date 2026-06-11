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
   * Device identifier (optional - can be set after registration)
   * Used in header: nxx-device-id
   */
  deviceId?: string;

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
 * JsonPatch operation types
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
   * Timestamp when model was created
   */
  createdAt: string;

  /**
   * Timestamp of last model update
   */
  updatedAt: string;

  /**
   * Monotonically-increasing per-document version, assigned by the backend on
   * every write. Channels use it for gap detection / dedup when applying
   * realtime updates. Always present on app models received from the backend.
   */
  version: number;

  /**
   * Custom fields based on application schema
   */
  [key: string]: any;
}

/**
 * A single JsonPatch operation as delivered over the realtime transport.
 * Transport patches carry no metadata of their own: every patch in a
 * `model_updated` event targets the same model, whose identity and matched
 * channels are hoisted to the event level.
 */
export interface TransportPatch {
  op: PatchOperation;
  path: string[];
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
  model: ModelIdentity & { version: number };
  patches: TransportPatch[];
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

/** Server → client acknowledgement of device registration. */
export interface TransportRegisterAck {
  success: boolean;
  message?: string;
}

/** Server → client error frame. */
export interface TransportErrorData {
  message: string;
  code?: string;
}

/**
 * Every server → client message is a `{ event, data }` envelope. This is the
 * discriminated union of all frames the transport can send.
 */
export type TransportServerMessage =
  | { event: 'register'; data: TransportRegisterAck }
  | { event: 'error'; data: TransportErrorData }
  | { event: 'model_created'; data: TransportModelCreatedData }
  | { event: 'model_updated'; data: TransportModelUpdatedData }
  | { event: 'model_deleted'; data: TransportModelDeletedData };

/** Client → server device registration message. */
export interface TransportRegisterClientMessage {
  event: 'register';
  data: {
    deviceId: string;
  };
}

/** Union of all client → server frames. */
export type TransportClientMessage = TransportRegisterClientMessage;
