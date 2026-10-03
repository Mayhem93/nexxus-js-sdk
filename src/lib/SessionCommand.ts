import { Command } from './Command';
import type { StoredIdentityPatch } from './storage';
import type { SessionTokens } from './types';

/**
 * What any session-issuing response may carry. The tokens are always there;
 * authentication and registration add the device and the user, device
 * registration puts the owner on the device instead, and a refresh adds
 * neither.
 */
type SessionIssuingResponse = SessionTokens & {
  device?: {
    id: string;
    userId?: string;
  };

  user?: {
    id: string;
  };
};

/**
 * A command whose response issues or renews a session: authentication, user
 * registration, device registration, and refresh.
 *
 * Exists so that reading a session out of a response is written once. Those
 * four routes answer in three different shapes, but every field the client
 * keeps sits in a predictable place in all of them, so one reading covers
 * every case — and a field a route leaves out comes back `undefined`, which
 * leaves the stored value as it is.
 */
export abstract class SessionCommand<TInput = {}, TOutput = {}> extends Command<TInput, TOutput> {
  /**
   * The tokens always replace what is stored: a refresh rotates the refresh
   * token, and a new session replaces the old one outright.
   *
   * The device id is re-read rather than assumed. The hint a login sends is
   * only a hint — a stale id, or one belonging to another user, is ignored and
   * a fresh device issued — so what the response names is the device the
   * client actually has now.
   */
  public extractIdentity(response: any): StoredIdentityPatch {
    const session = response as SessionIssuingResponse;

    return {
      token: session.token,
      refreshToken: session.refreshToken,
      deviceId: session.device?.id,
      userId: session.user?.id ?? session.device?.userId,
    };
  }
}
