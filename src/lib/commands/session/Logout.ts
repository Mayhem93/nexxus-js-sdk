import { Command, type CommandContext } from '../../Command';
import type { StoredIdentityPatch } from '../../storage';

/**
 * Input for logging out (no parameters — the refresh token comes from the
 * client's stored identity).
 */
export type LogoutInput = Record<string, never>;

/**
 * Logout response. Carries no information about whether a session ended.
 */
export interface LogoutOutput {
  message: string;
}

/**
 * Command to end the session the stored refresh token belongs to.
 *
 * **Prefer `client.logout()`**, which also drops the tokens when the request
 * fails, closes the transport, and emits `session_ended`. This command clears
 * the tokens only when the request succeeds.
 *
 * Answers `200` to any request carrying a refresh token, **whether or not a
 * session actually ended** — the server deliberately won't confirm which tokens
 * were live. The session ends for the whole device, and the server closes the
 * device's live transport connection with close code `4001`.
 *
 * The access token stays valid on the server until it expires. What stops this
 * client using it is dropping it locally: the client removes both tokens and
 * keeps the device id, so the next sign-in on this installation reuses the
 * same device.
 */
export class LogoutCommand extends Command<LogoutInput, LogoutOutput> {
  constructor(input: LogoutInput) {
    super(input, { authEnabled: false });
  }

  public resolveRequest(context: CommandContext) {
    return {
      method: 'POST' as const,
      path: '/auth/logout',
      body: { refreshToken: context.identity.refreshToken },
    };
  }

  public parseResponse(response: any): LogoutOutput {
    return response as LogoutOutput;
  }

  /** Drops the session, keeps the device. */
  public extractIdentity(): StoredIdentityPatch {
    return { token: null, refreshToken: null };
  }
}
