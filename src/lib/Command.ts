import type { NexxusClientConfig } from './types';

export type CommandOptions = {
  authEnabled?: boolean;
};

/**
 * Abstract base class for all Nexxus commands
 * @template TInput - Command input type
 * @template TOutput - Command output type
 */
export abstract class Command<TInput = {}, TOutput = {}> {
  /**
   * Command input data
   */
  public readonly input: TInput;
  private readonly auth: boolean;

  constructor(input: TInput, options: CommandOptions = {}) {
    this.input = input;
    this.auth = options.authEnabled ?? false;
  }

  public authEnabled(): boolean {
    return this.auth;
  }

  /**
   * Resolves the HTTP request details for this command
   * @param config - Client configuration
   * @returns HTTP request metadata
   */
  abstract resolveRequest(config: NexxusClientConfig): {
    method: 'GET' | 'POST' | 'PUT' | 'DELETE';
    path: string;
    headers?: Record<string, string>;
    body?: any;
  };

  /**
   * Parses the HTTP response into the command output type
   * @param response - Raw response body (already parsed as JSON if applicable)
   * @returns Typed command output
   */
  abstract parseResponse(response: any): TOutput;
}
