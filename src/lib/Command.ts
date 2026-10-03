import type { NexxusClientConfig } from './types';
import type { StoredIdentity, StoredIdentityPatch } from './storage';

export type CommandOptions = {
  authEnabled?: boolean;

  /**
   * Give up on the request after this many milliseconds. Unset means no limit
   * beyond the platform's own.
   */
  timeoutMs?: number;
};

/**
 * What a command is told about the client sending it.
 *
 * The identity is passed in rather than read from anywhere, so a command that
 * needs to put its device id in the body has it to hand — and so a command
 * stays a pure description of a request, testable by calling
 * `resolveRequest` with a literal.
 */
export interface CommandContext {
  config: NexxusClientConfig;

  /**
   * What the client currently knows about itself. Empty on a first run; never
   * `undefined`, so a command can read `identity.deviceId` without a guard.
   */
  identity: StoredIdentity;
}

/**
 * The HTTP request a command resolves to. `path` is relative to the client's
 * `baseUrl`.
 */
export interface CommandRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  headers?: Record<string, string>;
  body?: any;
}

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
  private readonly timeout?: number;

  constructor(input: TInput, options: CommandOptions = {}) {
    this.input = input;
    this.auth = options.authEnabled ?? false;
    this.timeout = options.timeoutMs;
  }

  public authEnabled(): boolean {
    return this.auth;
  }

  public timeoutMs(): number | undefined {
    return this.timeout;
  }

  /**
   * Resolves the HTTP request details for this command.
   *
   * Declared with a parameter the many commands that need nothing from it can
   * simply omit — TypeScript allows an implementation to take fewer arguments
   * than the signature it satisfies.
   *
   * @param context - The client's config and current identity
   * @returns HTTP request metadata
   */
  abstract resolveRequest(context: CommandContext): CommandRequest;

  /**
   * Parses the HTTP response into the command output type
   * @param response - Raw response body (already parsed as JSON if applicable)
   * @returns Typed command output
   */
  abstract parseResponse(response: any): TOutput;

  /**
   * What this response taught the client about its own identity, if anything.
   *
   * Implemented only by the routes that mint a token — authentication,
   * registration, device registration. The client persists whatever comes back
   * and replays the device id as a hint on the next authentication, which is
   * what stops a new device record appearing every time a token expires.
   *
   * A patch: a field returned as `undefined` means "unchanged", and `null`
   * means "remove".
   */
  public extractIdentity?(response: any): StoredIdentityPatch | undefined;

  /**
   * The channel this response says is no longer live, if it says so.
   *
   * Implemented only by unsubscribe. The client drops the matching local
   * `Channel` so a view cannot linger after the server has stopped feeding it.
   * Declared here, rather than having the client recognise the command, so the
   * two stay decoupled — the same reason {@link extractIdentity} exists.
   */
  public releasedChannel?(response: any): string | undefined;
}
