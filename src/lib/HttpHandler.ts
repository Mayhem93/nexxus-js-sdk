import type { HttpRequest, HttpResponse } from './types';
import { NexxusError } from './errors';

/**
 * Handles HTTP requests using the Fetch API
 */
export class HttpHandler {
  /**
   * Executes an HTTP request
   * @param request - HTTP request metadata
   * @returns HTTP response metadata
   * @throws {NexxusError} on non-2xx responses (`name` = server error type,
   *   `retryAfter` from `Retry-After`), on a transport failure (`name` =
   *   `"NetworkError"`, `statusCode` = `0`), or when `timeoutMs` runs out
   *   (`name` = `"TimeoutError"`, `statusCode` = `0`)
   */
  public async handle(request: HttpRequest): Promise<HttpResponse> {
    let response: Response;
    let body: string;

    try {
      response = await fetch(request.path, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        // Covers the body as well as the headers: the signal aborts a read
        // still streaming when it fires.
        signal: request.timeoutMs !== undefined ? AbortSignal.timeout(request.timeoutMs) : undefined,
      });

      body = await response.text();
    } catch (cause) {
      if ((cause as { name?: unknown } | null)?.name === 'TimeoutError') {
        throw new NexxusError({
          name: 'TimeoutError',
          message: `The request timed out after ${request.timeoutMs} ms`,
          statusCode: 0,
          cause,
        });
      }

      // The request never completed (DNS, connection refused, CORS, offline…).
      throw new NexxusError({
        name: 'NetworkError',
        message: cause instanceof Error ? cause.message : 'The network request failed',
        statusCode: 0,
        cause,
      });
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    if (!response.ok) {
      let name = 'UnknownError';
      let message = body || response.statusText;

      try {
        const errorData = JSON.parse(body);
        name = errorData.error || name;
        message = errorData.message || message;
      } catch {
        // Non-JSON error body — keep the raw text / status text from above.
      }

      throw new NexxusError({
        name,
        message,
        statusCode: response.status,
        retryAfter: HttpHandler.retryAfterSeconds(response.headers.get('retry-after')),
      });
    }

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body,
    };
  }

  /**
   * `Retry-After` in the form the API sends it: a whole number of seconds.
   * Missing, or in any other form, it reads as unknown.
   */
  private static retryAfterSeconds(header: string | null): number | undefined {
    const value = header?.trim();

    return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
  }
}
