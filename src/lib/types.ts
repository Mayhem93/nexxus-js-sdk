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
}

/**
 * Generic error response structure from the API
 */
export interface NexxusError {
  /**
   * Error name/type (e.g., 'ValidationError', 'NotFoundError')
   */
  name: string;

  /**
   * Human-readable error message
   */
  message: string;

  /**
   * HTTP status code
   */
  statusCode: number;
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
   * Custom fields based on application schema
   */
  [key: string]: any;
}

export interface TransportModelCreatedEventPayload {
  event: 'model_created';
  data: AppModel;
}

export interface TransportModelUpdatedEventPayload {
  event: 'model_updated';
  data: {
    op: PatchOperation;
    path: Array<string>;
    value: Array<any>;
    metadata: {
      id: string;
      channels: Array<string>;
    }
  };
}

export interface TransportModelDeletedEventPayload {
  event: 'model_deleted';
  data: {
    id: string;
    type: string;
    appId: string;
  };
}

export interface TransportRegisterClientPayload {
  event: 'register';
  data: {
    deviceId: string;
  };
}

export type TransportEventPayload = TransportModelCreatedEventPayload | TransportModelUpdatedEventPayload | TransportModelDeletedEventPayload | TransportRegisterClientPayload;
