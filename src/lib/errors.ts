import type { TransportDisconnect, TransportErrorCode, TransportErrorData } from './types';

/**
 * Parameters for constructing a {@link NexxusError}.
 */
export interface NexxusErrorParams {
  /**
   * Error discriminant. For an API error response this is the server-provided
   * error type (e.g. `"UserAlreadyExistsException"`); for a request that never
   * completed it is `"NetworkError"`, or `"TimeoutError"` when it ran out of
   * time.
   */
  name: string;

  /** Human-readable error message. */
  message: string;

  /** HTTP status code of the response, or `0` if the request never completed. */
  statusCode: number;

  /** The underlying error, when this wraps another failure (e.g. a network error). */
  cause?: unknown;
}

/**
 * Error thrown for every failure originating in the Nexxus client's HTTP layer.
 *
 * Following the AWS SDK convention, `name` carries the discriminant you switch
 * on:
 * - API error response → `name` is the server error type (e.g.
 *   `"UserAlreadyExistsException"`) and `statusCode` is the HTTP status.
 * - Transport/network failure → `name` is `"NetworkError"`, `statusCode` is `0`,
 *   and the underlying error is available on `cause`.
 * - Timeout → `name` is `"TimeoutError"`, `statusCode` is `0`. Whether the
 *   server acted on the request is unknown.
 *
 * @example
 * ```typescript
 * try {
 *   await client.send(command);
 * } catch (err) {
 *   if (err instanceof NexxusError) {
 *     console.error(err.name, err.statusCode, err.message);
 *   }
 * }
 * ```
 */
export class NexxusError extends Error {
  /** HTTP status code of the response, or `0` if the request never completed. */
  public readonly statusCode: number;

  constructor({ name, message, statusCode, cause }: NexxusErrorParams) {
    super(message, cause !== undefined ? { cause } : undefined);

    this.name = name;
    this.statusCode = statusCode;
  }
}

/**
 * The realtime transport refused something the client sent — in practice, a
 * device registration. Branch on {@link code}; the message is for humans.
 */
export class NexxusTransportError extends Error {
  public readonly code: TransportErrorCode;

  constructor({ code, message }: TransportErrorData) {
    super(message);

    this.name = 'NexxusTransportError';
    this.code = code;
  }
}

/**
 * The realtime transport closed while the client was registering on it, before
 * the worker answered. Branch on {@link code}, the WebSocket close code:
 *
 * - `1013` — the server instance can't take connections right now; try again
 *   later, waiting longer each time.
 * - `4003` — another connection of the device took this one's place, over the
 *   application's connection cap. Don't retry automatically.
 */
export class NexxusTransportClosedError extends Error {
  public readonly code: number;
  public readonly reason: string;

  constructor({ code, reason }: TransportDisconnect) {
    super(`The transport closed before the device was registered (${code}${reason ? `: ${reason}` : ''})`);

    this.name = 'NexxusTransportClosedError';
    this.code = code;
    this.reason = reason;
  }
}
