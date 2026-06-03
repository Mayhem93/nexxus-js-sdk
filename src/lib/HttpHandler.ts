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
   * @throws {NexxusError} on non-2xx responses (`name` = server error type) or
   *   on a transport failure (`name` = `"NetworkError"`, `statusCode` = `0`)
   */
  public async handle(request: HttpRequest): Promise<HttpResponse> {
    let response: Response;

    try {
      response = await fetch(request.path, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
    } catch (cause) {
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

    const body = await response.text();

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

      throw new NexxusError({ name, message, statusCode: response.status });
    }

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body,
    };
  }
}
