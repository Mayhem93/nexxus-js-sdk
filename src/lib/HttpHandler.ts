import type { HttpRequest, HttpResponse, NexxusError } from './types';

/**
 * Handles HTTP requests using the Fetch API
 */
export class HttpHandler {
  /**
   * Executes an HTTP request
   * @param request - HTTP request metadata
   * @returns HTTP response metadata
   * @throws NexxusError on non-2xx responses
   */
  public async handle(request: HttpRequest): Promise<HttpResponse> {
    const response = await fetch(request.path, {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    const body = await response.text();

    if (!response.ok) {
      let error: NexxusError;
      try {
        const errorData = JSON.parse(body);

        error = {
          name: errorData.error || 'UnknownError',
          message: errorData.message || 'An error occurred',
          statusCode: response.status,
        };
      } catch {
        error = {
          name: 'UnknownError',
          message: body || response.statusText,
          statusCode: response.status,
        };
      }
      throw error;
    }

    return {
      statusCode: response.status,
      headers: responseHeaders,
      body,
    };
  }
}
