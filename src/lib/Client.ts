import type {
  NexxusClientConfig,
  TransportModelEventData,
  TransportErrorData,
  TransportDisconnect,
  SessionEndReason,
  SessionEndedEvent,
} from './types';
import { Command } from './Command';
import { HttpHandler } from './HttpHandler';
import { Channel, type ReadonlyChannel } from './Channel';
import { GetModelCommand } from './commands/model/Get';
import { CountCommand } from './commands/model/Count';
import { RefreshCommand } from './commands/session/Refresh';
import { LogoutCommand } from './commands/session/Logout';
import { WsClient } from './ws/WsClient';
import { NexxusError, NexxusTransportError } from './errors';
import { createLogger } from './logger';
import { IdentityStore, createDefaultStore, type StoredIdentity, type StoredIdentityPatch } from './storage';
import EventEmitter from 'eventemitter3';
import type { Logger, ILogObj } from 'tslog';

/**
 * Main Nexxus API client.
 *
 * Keeps its own session alive: the access token is refreshed before it
 * expires, and a request refused for an expired token is refreshed and retried
 * once. Across browser tabs sharing one store, refreshes take turns under the
 * store's lock, because the server ends a session whose refresh token two
 * holders present.
 *
 * Events:
 * - `connected` — the realtime transport is open and the device registered.
 * - `disconnected` ({@link TransportDisconnect}) — the transport closed, from
 *   either end. The client does not reconnect by itself.
 * - `session_ended` ({@link SessionEndedEvent}) — the session is over and the
 *   user has to sign in again. The device id is kept.
 * - `error` — a background operation failed.
 */
export class NexxusClient extends EventEmitter {
  /** Fraction of an access token's lifetime after which it is refreshed. */
  private static readonly REFRESH_AT = 0.9;

  /**
   * Waits between attempts when a refresh cannot reach the server. Short on
   * purpose: a network failure can hide a response lost after the server had
   * already rotated the token, and the old token is only accepted for about ten
   * seconds after that — a retry has to land inside that window.
   */
  private static readonly NETWORK_RETRY_DELAYS_MS = [ 1000, 3000 ];

  /** How long to wait before trying again after a scheduled refresh fails. */
  private static readonly RETRY_AFTER_FAILURE_MS = 30_000;

  /** `setTimeout` treats a longer delay as zero. */
  private static readonly MAX_TIMER_MS = 2 ** 31 - 1;

  /** Close code the transport uses when the device's session was ended by logout. */
  private static readonly CLOSE_LOGGED_OUT = 4001;

  /**
   * The limit on any request made under the session lock that sets none of its
   * own — sign-in, registration, device registration, logout. A request that
   * hung would otherwise hold the lock, and with it every other session change
   * (refreshes included), until the platform gave up on the connection.
   *
   * Generous on purpose. These requests are not retried, and a registration
   * that times out after the server did create the account leaves the client
   * without it: trying again then fails with `UserAlreadyExistsException`. The
   * longer the limit, the rarer that is; this one still bounds the lock.
   * Refresh keeps its own, shorter limit, fitted to the window in which the
   * server accepts the previous refresh token.
   */
  private static readonly SESSION_REQUEST_TIMEOUT_MS = 15_000;

  private config: NexxusClientConfig;
  private httpHandler: HttpHandler;
  private channels: Map<string, Channel> = new Map();
  private wsClient: WsClient | null = null;

  private readonly store: IdentityStore;
  /**
   * The hot copy of what the store holds. The store is the durable record;
   * this is what every request reads, so a send does not pay for a disk or
   * `localStorage` round trip.
   */
  private identity?: StoredIdentity;
  /** In-flight first load, memoized so concurrent sends share one read. */
  private identityLoad?: Promise<StoredIdentity>;

  /** The refresh in progress, which every concurrent caller joins. */
  private refreshing?: Promise<void>;
  private refreshTimer?: ReturnType<typeof setTimeout>;
  private readonly stopWatchingStore: () => void;
  private readonly stopWatchingVisibility?: () => void;
  private closed = false;

  /**
   * The access token the live connection runs on — the one it registered with,
   * or the last one moved onto it. Unset while no connection is registered.
   */
  private transportToken?: string;

  /**
   * The client's logger. Logs to stdout/console by default; attach more
   * transports (file, remote shipping, …) here as needed for your environment.
   */
  public readonly logger: Logger<ILogObj>;

  constructor(config: NexxusClientConfig) {
    super();

    this.config = { ...config };
    this.logger = createLogger(this.config.logging);
    this.httpHandler = new HttpHandler();
    // Throws on Node when none was given, rather than silently running without
    // persistence — which costs a device record per process.
    this.store = this.config.store ?? createDefaultStore();

    if (!this.store.isPersistent()) {
      this.logger.warn(
        'Identity store is not persistent — this client will register a new device on every run.',
        { label: 'identity' }
      );
    }

    // Another tab signing in, refreshing or logging out rewrites the shared
    // record. Following it keeps this tab from ever presenting a refresh token
    // that has been replaced — which the server treats as theft.
    this.stopWatchingStore = this.store.onChange(this.config.appId, stored => this.adopt(stored ?? {}));
    this.stopWatchingVisibility = this.watchVisibility();

    if (this.config.transportUri) {
      this.wsClient = new WsClient({ url: this.config.transportUri});
      this.wsClient.on('closed', (event: TransportDisconnect) => this.onTransportClosed(event));
      this.wsClient.on('transport_error', (error: TransportErrorData) => this.onTransportError(error));
      this.wsClient.on('token_refreshed', () => {
        this.logger.debug('transport: now running on the refreshed access token', { label: 'transport' });
      });
    }
  }

  /**
   * Open the realtime transport and claim this client's device on it.
   *
   * Needs a token, not a device id: the worker reads the device out of the
   * verified claims. So authenticate — or, on an application without
   * authentication, register a device — before calling this.
   *
   * Once registered, the connection is moved onto every newer access token the
   * client gets, so it keeps going across refreshes without reconnecting.
   *
   * @throws {NexxusTransportError} when the worker refuses the registration.
   *   If it refused because the session is over, `session_ended` fires too.
   */
  public async initTransport(): Promise<void> {
    if (!this.wsClient) {
      return;
    }

    // Register with a token that has life left in it. One restored from
    // storage may be past due, and the worker refuses an expired one.
    await this.ensureFresh(true);

    if (!(await this.loadIdentity()).token) {
      throw new Error(
        'A token is required before initializing the transport. Authenticate, or register a device on an application without authentication.'
      );
    }

    await this.wsClient.connect(this.handleChannelMessage.bind(this));

    try {
      await this.registerTransport();
    } catch (error) {
      // A connection whose device isn't registered receives nothing.
      this.wsClient.disconnect();

      throw error;
    }

    this.emit('connected');
  }

  /** Close the realtime transport. `disconnected` fires once it has closed. */
  public disconnectTransport(): void {
    this.wsClient?.disconnect();
  }

  /**
   * Release everything the client holds open: the transport, the refresh
   * schedule, and the identity store. A Node process will not exit while the
   * store's handle is open, so call this before expecting one to.
   *
   * A closed client emits nothing further — not even `disconnected` for the
   * connection this closes.
   */
  public async close(): Promise<void> {
    this.closed = true;
    this.cancelScheduledRefresh();
    this.stopWatchingStore();
    this.stopWatchingVisibility?.();
    this.disconnectTransport();

    await this.store.close();
  }

  /**
   * Executes a command against the Nexxus API.
   *
   * A command that sends the access token gets one that isn't past due, and if
   * the server still refuses it as expired, the client refreshes and retries
   * the command once. Commands that change the session — sign-in, registration,
   * refresh, logout — run under the session lock, one at a time per device.
   *
   * @param command - Command instance to execute
   * @returns Typed command output
   */
  public async send<TInput, TOutput>(command: Command<TInput, TOutput>): Promise<TOutput> {
    if (command.authEnabled()) {
      await this.ensureFresh();
    }

    const sentToken = (await this.loadIdentity()).token;

    try {
      return await this.dispatch(command);
    } catch (error) {
      // The one refusal a client can resolve itself.
      if (!command.authEnabled() || !NexxusClient.isErrorNamed(error, 'UserTokenExpiredException') || !this.identity?.refreshToken) {
        throw error;
      }

      await this.refresh(sentToken);

      return this.dispatch(command);
    }
  }

  /**
   * What the client currently knows about itself — its device, tokens and user.
   *
   * A copy: mutating it changes nothing. Use {@link setIdentity} to write.
   */
  public async getIdentity(): Promise<Readonly<StoredIdentity>> {
    return { ...await this.loadIdentity() };
  }

  /**
   * Write into the stored identity by hand.
   *
   * Rarely needed — every route that issues a token already feeds this
   * automatically. It exists for a token obtained out of band, such as one
   * handed over from a server-rendered page.
   *
   * A patch: a value sets a field, `null` removes it, and a field left out (or
   * `undefined`) keeps its stored value.
   *
   * Setting `token` stamps `receivedAt` with the current time, since the refresh
   * is scheduled from it. Pass `receivedAt` too if the token is not fresh.
   */
  public async setIdentity(patch: StoredIdentityPatch): Promise<void> {
    await this.withSessionLock(() => this.applyIdentity(patch));
  }

  /**
   * Forget everything, device included.
   *
   * The next authentication then registers a **new device** — there is no
   * stored id left to hint with. To sign out but keep the device, use
   * {@link logout}.
   */
  public async clearIdentity(): Promise<void> {
    await this.withSessionLock(async () => {
      await this.store.clear(this.config.appId);
      this.setCached({});
    });
  }

  /**
   * Refresh the session now instead of waiting for the schedule.
   *
   * Rarely needed — the client refreshes on its own before the access token
   * expires. Use it when you want fresh claims sooner: after
   * `UpdateUserCommand`, say, since a new access token carries the user as
   * currently stored. If another tab refreshes first, its result is used.
   */
  public async refreshSession(): Promise<void> {
    const { token, refreshToken } = await this.loadIdentity();

    if (!refreshToken) {
      throw new Error('No session to refresh — sign in first.');
    }

    await this.refresh(token);
  }

  /**
   * Sign out: end the session on the server, drop both tokens here, keep the
   * device, and close the transport. Emits `session_ended`.
   *
   * The tokens are dropped even when the server can't be reached — the user
   * asked to be signed out, and a failed request must not leave the session
   * usable on this machine. The error is rethrown afterwards, since the session
   * may then live on server-side until it expires.
   */
  public async logout(): Promise<void> {
    let hadSession = false;
    let failure: unknown;

    await this.withSessionLock(async () => {
      const { token, refreshToken } = await this.loadIdentity();

      hadSession = token !== undefined || refreshToken !== undefined;

      try {
        if (refreshToken) {
          await this.execute(new LogoutCommand({}));
        }
      } catch (error) {
        failure = error;
      }

      await this.applyIdentity({ token: null, refreshToken: null });
    });

    this.disconnectTransport();

    if (hadSession) {
      this.emit('session_ended', { reason: 'logged_out' } satisfies SessionEndedEvent);
    }

    if (failure) {
      throw failure;
    }
  }

  public getChannel(channelId: string): ReadonlyChannel | undefined {
    return this.channels.get(channelId);
  }

  public getChannels(): Iterable<ReadonlyChannel> {
    return this.channels.values();
  }

  // --- requests ------------------------------------------------------------

  /**
   * Send a command: under the session lock if it changes the session,
   * otherwise directly.
   */
  private dispatch<TInput, TOutput>(command: Command<TInput, TOutput>): Promise<TOutput> {
    return NexxusClient.changesSession(command)
      ? this.withSessionLock(() => this.executeLocked(command))
      : this.execute(command);
  }

  /**
   * Whether a command changes the session — sign-in, registration, refresh,
   * logout. Exactly the commands that implement `extractIdentity`, and exactly
   * the ones that run under the session lock.
   */
  private static changesSession<TInput, TOutput>(command: Command<TInput, TOutput>): boolean {
    return command.extractIdentity !== undefined;
  }

  /**
   * Execute a command that changes the session; the caller holds the lock.
   *
   * A refused refresh token means the session is over, whichever path found
   * out — so the tokens are dropped here, once, rather than at each caller.
   */
  private async executeLocked<TInput, TOutput>(command: Command<TInput, TOutput>): Promise<TOutput> {
    try {
      return await this.execute(command);
    } catch (error) {
      if (NexxusClient.isErrorNamed(error, 'InvalidRefreshTokenException')) {
        await this.endSessionLocked('refresh_rejected');
      }

      throw error;
    }
  }

  /** One round trip: build the request, send it, and take in what came back. */
  private async execute<TInput, TOutput>(command: Command<TInput, TOutput>): Promise<TOutput> {
    const identity = await this.loadIdentity();
    const requestConfig = command.resolveRequest({ config: this.config, identity });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'nxx-app-id': this.config.appId,
      ...requestConfig.headers,
    };

    // No device header: the device is a signed claim inside the token, and a
    // header asserting one would be ignored.
    if (identity.token && command.authEnabled()) {
      headers['Authorization'] = `Bearer ${identity.token}`;
    }

    const request = {
      method: requestConfig.method,
      path: `${this.config.baseUrl}${requestConfig.path}`,
      headers,
      body: requestConfig.body ? JSON.stringify(requestConfig.body) : undefined,
      // A request made under the session lock is always bounded; a command's
      // own limit (refresh's shorter one) takes precedence.
      timeoutMs: command.timeoutMs()
        ?? (NexxusClient.changesSession(command) ? NexxusClient.SESSION_REQUEST_TIMEOUT_MS : undefined),
    };

    const response = await this.httpHandler.handle(request);
    const parsedBody = response.body ? JSON.parse(response.body) : {};

    // Before parseResponse, so a command that throws while shaping its output
    // still leaves the client holding the token it was just issued.
    const learned = command.extractIdentity?.(parsedBody);

    if (learned) {
      await this.applyIdentity(learned);
    }

    const released = command.releasedChannel?.(parsedBody);

    if (released) {
      this.channels.delete(released);
    }

    const result = command.parseResponse(parsedBody);

    if (result instanceof Channel) {
      result.setCountExecutor((query) => this.send(new CountCommand(query)));
      this.channels.set(result.getName(), result);
    }

    return result;
  }

  // --- identity ------------------------------------------------------------

  /**
   * Read the stored record once, then serve it from memory.
   *
   * The promise is memoized rather than the value, so several sends racing on
   * a cold client share a single read instead of each starting their own.
   */
  private loadIdentity(): Promise<StoredIdentity> {
    if (this.identity) {
      return Promise.resolve(this.identity);
    }

    if (!this.identityLoad) {
      this.identityLoad = this.store.load(this.config.appId).then(stored => {
        // Only if nothing newer arrived — another tab's write — while reading.
        // `{}` rather than null for a first run, so callers can read
        // `identity.deviceId` without a guard.
        if (!this.identity) {
          this.setCached(stored ?? {});
        }

        return this.identity!;
      });
    }

    return this.identityLoad;
  }

  /**
   * Replace the cached record. The one place it changes, so the refresh
   * schedule and the live connection always follow the token actually held —
   * whether this client refreshed it, another tab did, or a sign-in replaced it.
   */
  private setCached(identity: StoredIdentity): void {
    const previousToken = this.identity?.token;

    this.identity = identity;
    this.scheduleRefresh();

    if (identity.token !== undefined && identity.token !== previousToken) {
      this.moveTransportOnto(identity.token);
    }
  }

  /**
   * Take on the record as it stands in the store — because another holder
   * wrote it, or at the start of a locked operation. If that holder ended the
   * session, this client's session is over too.
   */
  private adopt(stored: StoredIdentity): void {
    const hadSession = this.identity?.refreshToken !== undefined;

    this.setCached(stored);

    if (hadSession && stored.refreshToken === undefined) {
      this.emit('session_ended', { reason: 'ended_elsewhere' } satisfies SessionEndedEvent);
    }
  }

  /**
   * Fold what a response taught us into the cached record and persist it. The
   * caller holds the session lock.
   *
   * Both halves go through `IdentityStore.merge`, so the copy in memory and the
   * copy on disk can't disagree about what a missing field means.
   */
  private async applyIdentity(learned: StoredIdentityPatch): Promise<void> {
    const patch = NexxusClient.stampTokenAge(learned);

    this.setCached(IdentityStore.merge(await this.loadIdentity(), patch));

    await this.store.save(this.config.appId, patch);
  }

  /**
   * Keep `receivedAt` describing the access token it sits beside: a new token
   * is stamped with the local time it arrived, and removing the token removes
   * its age with it.
   *
   * Done here, where every token arrives — sign-in, registration, refresh, or
   * one set by hand — so none of those paths can forget it. A patch that sets
   * `receivedAt` itself is left alone.
   */
  private static stampTokenAge(patch: StoredIdentityPatch): StoredIdentityPatch {
    if (patch.token === undefined || patch.receivedAt !== undefined) {
      return patch;
    }

    return { ...patch, receivedAt: patch.token === null ? null : NexxusClient.nowSeconds() };
  }

  // --- session -------------------------------------------------------------

  /**
   * Run `fn` holding the store's session lock, after catching up with whatever
   * another holder wrote while this one waited for it.
   *
   * Everything that changes the session goes through here — refreshes,
   * sign-ins, registrations, logout, identity written by hand — so they happen
   * one at a time per device, each starting from the record as it really is.
   */
  private withSessionLock<T>(fn: () => Promise<T>): Promise<T> {
    return this.store.lock(this.config.appId, async () => {
      this.adopt((await this.store.load(this.config.appId)) ?? {});

      return fn();
    });
  }

  /**
   * Make sure `stale` is replaced by a newer access token.
   *
   * Concurrent callers share one refresh. Inside the lock, if the stored token
   * is no longer `stale`, another holder has already replaced it — the lock
   * adopted theirs on the way in — and no second refresh is sent.
   */
  private refresh(stale: string | undefined): Promise<void> {
    if (!this.refreshing) {
      this.refreshing = this.withSessionLock(() => this.refreshLocked(stale))
        .finally(() => {
          this.refreshing = undefined;
        });
    }

    return this.refreshing;
  }

  private async refreshLocked(stale: string | undefined): Promise<void> {
    const { token, refreshToken } = this.identity ?? {};

    if (token !== stale) {
      return;
    }

    if (!refreshToken) {
      throw new Error('No session to refresh — sign in first.');
    }

    for (let attempt = 0; ; attempt++) {
      try {
        await this.executeLocked(new RefreshCommand({}));

        return;
      } catch (error) {
        const wait = NexxusClient.NETWORK_RETRY_DELAYS_MS[attempt];

        // Only a failure to reach the server is retried, and only quickly. An
        // answer from the server — a refusal included — is final.
        if (!NexxusClient.isNetworkError(error) || wait === undefined) {
          throw error;
        }

        await new Promise(resolve => setTimeout(resolve, wait));
      }
    }
  }

  /**
   * Drop both tokens, keep the device, and say so. The caller holds the lock.
   */
  private async endSessionLocked(reason: SessionEndReason): Promise<void> {
    await this.applyIdentity({ token: null, refreshToken: null });

    this.emit('session_ended', { reason } satisfies SessionEndedEvent);
  }

  /**
   * End the session from outside the lock — if there is still one to end. A
   * logout this client made itself is also reported back by the transport, and
   * by then there is nothing left, so it is not announced twice.
   */
  private endSession(reason: SessionEndReason): Promise<void> {
    return this.withSessionLock(async () => {
      const { token, refreshToken } = this.identity ?? {};

      if (token !== undefined || refreshToken !== undefined) {
        await this.endSessionLocked(reason);
      }
    });
  }

  /**
   * Make sure the access token about to be sent is not past due.
   *
   * Past its refresh point but still valid, the refresh runs alongside and the
   * request goes out with the current token — the usual case after a timer ran
   * late. Past expiry, the request waits, since it would only be refused; with
   * `waitIfDue` it waits from the refresh point already.
   */
  private async ensureFresh(waitIfDue = false): Promise<void> {
    const identity = await this.loadIdentity();
    const timing = NexxusClient.tokenTiming(identity);
    const now = NexxusClient.nowSeconds();

    if (!timing || now < timing.refreshAt) {
      return;
    }

    const refreshing = this.refresh(identity.token);

    if (waitIfDue || now >= timing.expiresAt) {
      await refreshing;
    } else {
      refreshing.catch(error => this.logRefreshFailure(error));
    }
  }

  /** Arm the timer for the held token's refresh point, or after `delayMs`. */
  private scheduleRefresh(delayMs?: number): void {
    this.cancelScheduledRefresh();

    if (this.closed) {
      return;
    }

    let wait = delayMs;

    if (wait === undefined) {
      const timing = NexxusClient.tokenTiming(this.identity);

      if (!timing) {
        return;
      }

      wait = (timing.refreshAt - NexxusClient.nowSeconds()) * 1000;
    }

    const timer = setTimeout(() => this.onRefreshDue(), Math.min(Math.max(wait, 0), NexxusClient.MAX_TIMER_MS));

    // Never keep a Node process alive just to refresh a token nobody is using.
    (timer as { unref?: () => void }).unref?.();

    this.refreshTimer = timer;
  }

  private cancelScheduledRefresh(): void {
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private onRefreshDue(): void {
    this.refreshTimer = undefined;

    this.refresh(this.identity?.token).catch(error => {
      this.logRefreshFailure(error);

      // Still signed in means the failure was transient: try again soon, while
      // the current token has life left. A refused session has no tokens left
      // to schedule, and ends here.
      if (this.identity?.refreshToken !== undefined) {
        this.scheduleRefresh(NexxusClient.RETRY_AFTER_FAILURE_MS);
      }
    });
  }

  private logRefreshFailure(error: unknown): void {
    this.logger.warn('session: refresh failed', {
      label: 'session',
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }

  /**
   * In a browser, check the schedule whenever the page becomes visible again.
   * Background tabs and sleep delay timers, so a refresh can be overdue by the
   * time the user comes back.
   */
  private watchVisibility(): (() => void) | undefined {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') {
      return undefined;
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        this.ensureFresh().catch(error => this.logRefreshFailure(error));
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }

  /**
   * When the held access token is due for refresh and when it expires, in
   * local UNIX seconds — or `null` when there is nothing to schedule: no
   * token, no refresh token to renew it with, or a token that isn't a readable
   * JWT.
   *
   * Measured from when the token arrived, using the token's own lifetime
   * (`exp − iat`). Never `exp` against the local clock: device clocks drift.
   */
  private static tokenTiming(identity: StoredIdentity | undefined): { refreshAt: number; expiresAt: number } | null {
    if (!identity?.token || !identity.refreshToken) {
      return null;
    }

    const lifetime = NexxusClient.tokenLifetime(identity.token);

    if (lifetime === null) {
      return null;
    }

    // An unknown arrival time means an unknown age. Treating the token as
    // expired costs one refresh; guessing could cost a refused request.
    const receivedAt = identity.receivedAt ?? 0;

    return {
      refreshAt: receivedAt + NexxusClient.REFRESH_AT * lifetime,
      expiresAt: receivedAt + lifetime,
    };
  }

  /**
   * A JWT's payload, or `null` if the token isn't one. Decoded, not verified:
   * the client only uses it to decide *when* to do something, and the server
   * verifies every token it is handed.
   */
  private static tokenClaims(token: string): Record<string, unknown> | null {
    const payload = token.split('.')[1];

    if (!payload) {
      return null;
    }

    try {
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const binary = atob(base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '='));
      const claims: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0))));

      return claims !== null && typeof claims === 'object' ? claims as Record<string, unknown> : null;
    } catch {
      return null;
    }
  }

  /** A JWT's `exp − iat`, in seconds, or `null` if it can't be read. */
  private static tokenLifetime(token: string): number | null {
    const claims = NexxusClient.tokenClaims(token);

    if (typeof claims?.exp !== 'number' || typeof claims.iat !== 'number') {
      return null;
    }

    const lifetime = claims.exp - claims.iat;

    return lifetime > 0 ? lifetime : null;
  }

  /**
   * Whether two tokens name the same device. One that can't be read gets the
   * benefit of the doubt: the worker has the final word, and refuses a token
   * for another device without dropping the connection.
   */
  private static sameDevice(a: string, b: string): boolean {
    const deviceA = NexxusClient.tokenClaims(a)?.deviceId;
    const deviceB = NexxusClient.tokenClaims(b)?.deviceId;

    return deviceA === undefined || deviceB === undefined || deviceA === deviceB;
  }

  private static nowSeconds(): number {
    return Math.floor(Date.now() / 1000);
  }

  private static isErrorNamed(error: unknown, name: string): boolean {
    return error instanceof NexxusError && error.name === name;
  }

  /** The request never completed, or ran out of time — see `HttpHandler`. */
  private static isNetworkError(error: unknown): boolean {
    return error instanceof NexxusError && error.statusCode === 0;
  }

  // --- transport -----------------------------------------------------------

  /**
   * Claim this client's device on the open connection and wait for the verdict.
   *
   * A token that expired on the way is refreshed and the device registered
   * again, once — on the same connection, which stays open. A session the
   * worker says is over, or a device that no longer exists, ends the session
   * here too: no refresh can fix either.
   */
  private async registerTransport(): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      const { token } = await this.loadIdentity();

      if (!token) {
        throw new Error('No token to register the transport with — sign in again.');
      }

      try {
        await this.awaitRegistration(token);
        this.transportToken = token;

        return;
      } catch (error) {
        if (!(error instanceof NexxusTransportError)) {
          throw error;
        }

        if (error.code === 'TOKEN_EXPIRED' && attempt === 0) {
          await this.refresh(token);

          continue;
        }

        if (error.code === 'SESSION_ENDED' || error.code === 'DEVICE_NOT_FOUND') {
          await this.endSession('transport_rejected');
        }

        throw error;
      }
    }
  }

  /**
   * Send `register` and settle on the worker's verdict. A refusal arrives as an
   * error frame rather than a failed ack, and the connection can also close
   * first — every outcome is listened for before the frame goes out, so none
   * can race ahead or leave this waiting forever.
   */
  private awaitRegistration(token: string): Promise<void> {
    const ws = this.wsClient!;

    return new Promise<void>((resolve, reject) => {
      const settle = () => {
        ws.off('registered', onRegistered);
        ws.off('transport_error', onError);
        ws.off('closed', onClosed);
      };
      const onRegistered = () => {
        settle();
        resolve();
      };
      const onError = (error: TransportErrorData) => {
        settle();
        reject(new NexxusTransportError(error));
      };
      const onClosed = ({ code, reason }: TransportDisconnect) => {
        settle();
        reject(new Error(`The transport closed before the device was registered (${code}${reason ? `: ${reason}` : ''})`));
      };

      ws.on('registered', onRegistered);
      ws.on('transport_error', onError);
      ws.on('closed', onClosed);

      try {
        ws.register(token);
      } catch (error) {
        settle();
        reject(error);
      }
    });
  }

  /**
   * Move the live connection onto a newer access token, so it keeps going past
   * the old one's expiry without reconnecting.
   *
   * Only onto a token for the same device. After registering a new device the
   * connection still belongs to the previous one, and the worker would refuse
   * the new device's token.
   */
  private moveTransportOnto(token: string): void {
    const current = this.transportToken;

    if (!this.wsClient || current === undefined || token === current) {
      return;
    }

    if (!NexxusClient.sameDevice(token, current)) {
      this.logger.debug('transport: the new token names another device; the connection keeps its registration', { label: 'transport' });

      return;
    }

    try {
      this.wsClient.refreshAccessToken(token);
      this.transportToken = token;
    } catch (error) {
      this.logger.warn('transport: could not send the refreshed access token', {
        label: 'transport',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * An error frame on a registered connection — in practice, a refused
   * `refresh_access_token`. The connection keeps running on the token it had
   * until that one expires, so it is worth a warning rather than an action.
   * Refusals of `register` are handled where registration waits for them.
   */
  private onTransportError(error: TransportErrorData): void {
    if (this.transportToken === undefined) {
      return;
    }

    this.logger.warn('transport: frame refused', { label: 'transport', code: error.code, message: error.message });
  }

  /**
   * The connection closed, from either end. The client doesn't reconnect by
   * itself: after any disconnect the server has dropped the device's
   * subscriptions, so coming back means registering and subscribing again.
   *
   * A logout close (4001) ends the session here too — unless this client's own
   * logout already did, in which case there is nothing left to end.
   */
  private onTransportClosed(event: TransportDisconnect): void {
    const wasRegistered = this.transportToken !== undefined;

    this.transportToken = undefined;

    // A connection that never registered was never announced as connected, and
    // a closed client announces nothing: this close is the one `close()` began.
    if (!wasRegistered || this.closed) {
      return;
    }

    this.emit('disconnected', event);

    if (event.code === NexxusClient.CLOSE_LOGGED_OUT) {
      this.endSession('logged_out').catch(error => {
        this.logger.warn('transport: could not end the session after a logout close', {
          label: 'transport',
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  // --- channels ------------------------------------------------------------

  private handleChannelMessage(payload: TransportModelEventData): void {
    switch (payload.event) {
      case 'model_created': {
        const { model } = payload;
        this.dispatchToChannels(payload.metadata.channels, (channel) => channel.upsert(model));
        break;
      }

      case 'model_updated': {
        const { model, patches } = payload;
        this.dispatchToChannels(payload.metadata.channels, (channel) => {
          const local = channel.get(model.id);

          if (!local || local.version === undefined) {
            // Not in our view slice, or held without a version to order this
            // delta against — fetch the full current object rather than guess.
            // (A version-less copy was previously dropped here in silence:
            // `undefined + 1` is NaN, so every comparison below failed.)
            void this.resync(channel, model.type, model.id);
          } else if (model.version === local.version + 1) {
            channel.applyPatches(model.id, patches, model.version);
          } else if (model.version > local.version + 1) {
            // Missed at least one update — resync instead of applying a stale delta.
            void this.resync(channel, model.type, model.id);
          }
          // else: model.version <= local.version -> stale/duplicate, ignore.
        });
        break;
      }

      case 'model_deleted': {
        const { model } = payload;
        this.dispatchToChannels(payload.metadata.channels, (channel) => channel.remove(model));
        break;
      }
    }
  }

  /**
   * Fetch the current full model and version-guarded-upsert it into the channel.
   * Used when an update targets an object missing from the channel's view, or
   * when there's a version gap (applying a delta to a stale base would corrupt it).
   * Fire-and-forget: failures surface via the client 'error' event, and the next
   * update for the object re-triggers a resync, so it self-heals.
   */
  private async resync(channel: Channel, type: string, id: string): Promise<void> {
    // this.logger.debug('resync: fetching model', { label: 'resync', type, id, channel: channel.getName() });

    try {
      const { data } = await this.send(new GetModelCommand({ id, type }));
      channel.upsert(data);
      this.logger.debug('resync: upserted', { label: 'resync', type, id, channel: channel.getName() });
    } catch (error) {
      this.logger.error('resync: failed', { label: 'resync', type, id, channel: channel.getName(), error: error instanceof Error ? error.message : String(error) });
      this.emit('error', error);
    }
  }

  /**
   * Runs `fn` for every locally-held channel whose key appears in the
   * server-provided list. Channels this client doesn't hold are ignored.
   */
  private dispatchToChannels(channelKeys: string[], fn: (channel: Channel) => void): void {
    for (const key of channelKeys) {
      const channel = this.channels.get(key);

      if (channel) {
        fn(channel);
      }
    }
  }
}
