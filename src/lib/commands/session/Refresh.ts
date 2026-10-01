import type { CommandContext } from '../../Command';
import { SessionCommand } from '../../SessionCommand';
import type { SessionTokens } from '../../types';

/**
 * Input for refreshing the session (no parameters — the refresh token comes
 * from the client's stored identity).
 */
export type RefreshInput = Record<string, never>;

/**
 * The next pair of tokens. No device and no user: decode the new access token
 * if you need its claims.
 */
export type RefreshOutput = SessionTokens;

/**
 * Command to exchange the stored refresh token for a new access token and a
 * new refresh token.
 *
 * **You rarely need this.** The client refreshes on its own before the access
 * token expires, and `client.refreshSession()` asks it to refresh now — which,
 * unlike this command, skips the request when another tab has just refreshed.
 * Sending this directly is still safe: like every command that changes the
 * session, it runs under the client's session lock.
 *
 * Works the same on every application, zero-auth included. Sends no
 * `Authorization` header: the refresh token is the credential, and the access
 * token has usually expired by now anyway.
 *
 * **Rotation.** Both tokens are replaced, and the client stores the new pair.
 * The old refresh token is still accepted for a few seconds — enough to retry
 * a refresh whose response was lost — but presenting it after that is treated
 * as theft and ends the session for every holder.
 *
 * The new access token carries the user as currently stored, so this is also
 * how a `PUT /user` change reaches the token and `GetUserCommand`.
 *
 * Fails with `InvalidRefreshTokenException` when the token is malformed,
 * unknown, expired, replaced or ended by logout. It never says which — to a
 * client they all mean the same thing: sign in again. The client drops both
 * tokens and emits `session_ended`.
 */
export class RefreshCommand extends SessionCommand<RefreshInput, RefreshOutput> {
  /**
   * Shorter than the limit the client puts on its other session requests,
   * because a refresh is retried when it can't get through: the retry has to
   * reach the server inside the ~10 seconds in which it still accepts the
   * previous refresh token — which matters when the request that timed out did
   * arrive and rotate the token. Five seconds is still generous for a request
   * this small.
   */
  private static readonly TIMEOUT_MS = 5_000;

  constructor(input: RefreshInput) {
    super(input, { authEnabled: false, timeoutMs: RefreshCommand.TIMEOUT_MS });
  }

  public resolveRequest(context: CommandContext) {
    return {
      method: 'POST' as const,
      path: '/auth/refresh',
      body: { refreshToken: context.identity.refreshToken },
    };
  }

  public parseResponse(response: any): RefreshOutput {
    return response as RefreshOutput;
  }
}
