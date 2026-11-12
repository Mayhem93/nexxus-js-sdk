# nexxus-js-sdk

TypeScript client SDK for the **Nexxus** backend. Works in **Node.js and modern browsers**, ships dual CommonJS / ESM builds with type definitions, and follows an **AWS SDK v3-style command pattern**: you build a command object and hand it to `client.send(...)`.

Its headline feature is **realtime channels** — a subscription returns a local, live-updating view of a server-side query result, kept in sync over a WebSocket.

## Features

- **Command pattern** — one small class per operation; `client.send(command)` returns typed output.
- **Realtime channels** — subscribe to a query and get a `Channel`: a local materialized view that stays current as objects are created, updated, and deleted server-side.
- **Version-aware sync** — every model carries a monotonic `version`; updates apply in order, and gaps or unknown objects trigger an automatic resync so a channel self-heals.
- **Isomorphic** — the same package runs in Node and the browser (WebSocket transport adapts automatically).
- **Built-in logger** — an isomorphic [tslog](https://tslog.js.org/) instance exposed as `NexxusClient.logger`, shared by every client in the process; attach your own transports (file, remote shipping, …).

## Requirements

- **Node.js ≥ 24**, or a modern browser (no legacy support).
- TypeScript 6+ if consuming the types.

## Installation

```sh
npm install @mayhem93/nexxus-js-sdk
```

## Quick start

```ts
import {
  NexxusClient,
  SqliteStore,
  RegisterUserCommand,
  AuthLocalCommand,
  SubscribeCommand,
  CreateModelCommand,
} from '@mayhem93/nexxus-js-sdk';

const client = new NexxusClient({
  baseUrl: 'http://localhost:5000',
  appId: 'your-app-id',
  transportUri: 'ws://localhost:7000',      // omit to run without realtime
  store: new SqliteStore({ path: './nexxus.db' }),   // browser: defaults to localStorage
  logging: { level: 'info', format: 'json' },
});

// 1. Authenticate. Registration returns a session, so there's no separate
//    login step — use AuthLocalCommand on later runs. The token and device
//    are persisted for you; there is nothing to wire up by hand.
await client.send(new RegisterUserCommand({ username: 'alice', password: 'secret', name: 'Alice' }));

// The client refreshes its session on its own; this fires when it can't, and
// the user has to sign in again.
client.on('session_ended', ({ reason }) => { /* show sign-in */ });

// 2. Open the realtime transport. It needs a token, which you now have.
await client.initTransport();

// 3. Subscribe — you get back a live Channel
const channel = await client.send(new SubscribeCommand({ type: 'task', limit: 50 }));

channel.on('model_created', (task) => console.log('new task', task.id));
channel.on('model_updated', (task) => console.log('updated', task.id));
channel.on('model_deleted', (task) => console.log('deleted', task.id));

// 4. Mutate — changes flow back to every subscriber via the channel
await client.send(new CreateModelCommand({ type: 'task', /* ...fields */ }));

// ... on shutdown. Closes the transport and the identity store; a Node
// process won't exit while the store's handle is open.
await client.close();
```

> `RegisterDeviceCommand` is **not** part of this flow. It always creates a new
> device, and registering or logging in already binds one — calling it as well
> gives one client two device records. It's for adding a device deliberately,
> and for applications without authentication, which have no other way to get a
> token.

## Core concepts

### Commands

Every operation is a command you `send`. Available commands:

| Area | Commands |
| --- | --- |
| Users | `RegisterUserCommand`, `AuthLocalCommand`, `GetUserCommand`, `UpdateUserCommand` |
| Sessions | `RefreshCommand`, `LogoutCommand` |
| Devices | `RegisterDeviceCommand`, `GetDeviceCommand`, `UpdateDeviceCommand`, `ListDevicesCommand` |
| Models | `GetModelCommand`, `SearchCommand`, `CreateModelCommand`, `UpdateModelCommand`, `DeleteModelCommand`, `CountCommand` |
| Subscriptions | `SubscribeCommand`, `UnsubscribeCommand` |

### Identity & devices

A Nexxus token names a **device** as well as a user, and the device is a signed
claim inside it — there is no device header and no device argument. The client
therefore persists the session's tokens and the device id they were issued
against.

```ts
await client.getIdentity();   // { deviceId?, token?, refreshToken?, receivedAt?, userId? } — a copy
await client.setIdentity({ token });  // for a token obtained out of band
await client.clearIdentity(); // forget everything; the next login gets a NEW device
```

The device id matters more than it looks. Every **login** replays it as a hint,
and that is what makes the server reuse your existing device instead of minting
a fresh one. Without it, every sign-in would leave another entry in the user's
device list. The client sends it for you; you only have to give it somewhere to
persist:

| Environment | Store | Notes |
| --- | --- | --- |
| Browser | `LocalStorageStore` | the default; degrades to memory if storage is blocked |
| Node | `SqliteStore({ path })` | no default — a path is required, and each process needs its own |
| Tests | `MemoryStore` | nothing survives the process |

The hint is only a hint: a stale id, or one belonging to another user, is
ignored and a new device issued — not an error. The client always re-reads the
device id from the response, so the stored value tracks what the server
actually did.

**Registration is the exception.** It takes no device input and always
creates a new device — even when it signs in. Registering a username that
already exists, with that account's password, signs in to that account
(`accountCreated: false`); any other password is a `409`. So sign returning
users in with `AuthLocalCommand`, which reuses the stored device. The device a
registration creates is unnamed; rename it afterwards through the device
route.

That splits the `device` object along the line of who owns each part:

| Part | Owner | Where it goes |
| --- | --- | --- |
| `device.id` | the client | attached from the store, **on logins only** |
| `device.name`, and more to come | you | an optional `device` on a login |

```ts
new AuthLocalCommand({ username, password, device: { name: 'My Laptop' } });
```

`DeviceInfo` has no `id` field — that isn't yours to set, and there is nowhere
to set it. On a login the client layers the stored id on top of whatever you
pass. Device information is only read when a device is actually created, so on
a login that reuses one it is ignored.

Since registration leaves the device unnamed, naming it is a follow-up call:

```ts
await client.send(new UpdateDeviceCommand({ name: "Ann's Laptop" }));
await client.send(new GetDeviceCommand({}));     // the calling device
await client.send(new ListDevicesCommand({}));   // all of this user's devices
```

All three act on the device the token names. There is no way to address
another one, by design.

One store per client, never shared between processes: two processes sharing a
record are two clients fighting over one device identity. A custom store
subclasses `IdentityStore` and implements `load`, `write` and `clear`.

### Sessions

A session is two tokens: a short-lived **access token** (an hour by default —
the application decides) and a long-lived **refresh token** (30 days by default,
counted from sign-in, not extended by refreshing). The client keeps the session
alive by itself:

- It refreshes the access token at 90% of its lifetime, timed from when the
  token arrived on this device. It never compares the token's `exp` against the
  local clock, since device clocks drift.
- A token found past due when a request is made — the timer ran late, or the
  process restarted — is refreshed first. The request only waits if the token
  has actually expired.
- If the server still refuses a request as expired, the client refreshes and
  retries it once.

When the refresh token itself is refused, the session is over. The client drops
both tokens, keeps the device, and emits `session_ended`:

```ts
client.on('session_ended', ({ reason }) => showSignIn()); // 'refresh_rejected' | 'logged_out' | 'ended_elsewhere'

await client.refreshSession(); // refresh now — e.g. after UpdateUserCommand, to get fresh claims
await client.logout();         // end the session, drop the tokens (even if the request fails), close the transport
```

**Browser tabs share one session.** Tabs of an origin share `localStorage`, so
they share one device and one refresh token — and the server ends a session
when two holders refresh it independently. So everything that changes the
session (sign-in, registration, refresh, logout) runs under a lock held across
tabs, and each tab follows the others' changes. That lock needs the Web Locks
API, which browsers only offer over HTTPS or on localhost; elsewhere, tabs
refresh uncoordinated. Their realtime connections stay separate: each tab
registers its own, with its own subscriptions.

**In Node**, the refresh timer never keeps a process alive by itself, and
`client.close()` stops it.

Requests that change the session always time out, so a hung one can't hold up
the others: 15 seconds for sign-in, registration and logout, 5 seconds for a
refresh. A timeout surfaces as a `NexxusError` named `TimeoutError`. Only a
refresh is retried, because whether the server acted on a timed-out request is
unknown — and a registration that did go through can't be repeated.

### Realtime transport

`initTransport()` opens the WebSocket and registers this client's device on it
with the current access token — refreshing first if that token is due. If the
token expires on the way, the client refreshes it and registers again on the
same connection.

Once registered, the connection is moved onto every newer access token the
client gets, so it survives refreshes without reconnecting.

```ts
client.on('connected', () => { /* initTransport() registered: subscribe */ });
client.on('disconnected', ({ code, reason, willReconnect }) => { /* subscriptions are gone */ });
client.on('reconnecting', ({ attempt, delayMs }) => { /* e.g. show "reconnecting…" */ });
client.on('reconnected', () => { /* a new connection: subscribe again */ });
```

Subscriptions belong to the connection they were made on, and close with it.
A device can hold several connections at once, one per socket: every tab or
process sharing its session registers its own and subscribes on it. The
application caps how many (`connections.maxPerDevice`, 20 by default);
registering one more closes the device's oldest connection with `4003`.

**Reconnecting.** When the server or the network drops the connection, the
client reconnects on its own: it waits 2 seconds, tries for up to 2 seconds,
and keeps at it until a connection registers. Then `reconnected` fires — not
`connected`, which is for your own `initTransport()` — and that is where to
subscribe again. Each subscription returns a new `Channel`, so move your
listeners onto it.

It doesn't reconnect after a close you made (`disconnectTransport()`,
`logout()`, `close()`), after a logout (`4001`) or after an eviction (`4003`),
and it stops when the session ends; `willReconnect` on `disconnected` says
which. After repeated `1013`s it waits longer between tries, up to 30 seconds.
Calling `initTransport()` yourself takes over from a reconnect under way. To
handle reconnecting yourself, pass `reconnect: false`.

The server closes with its own codes:

| Code | Reason | Meaning |
| --- | --- | --- |
| `4001` | `logged_out` | The device was logged out, closing every one of its connections. The client ends its session (`session_ended`) and doesn't reconnect. |
| `4002` | `token_expired` | The connection's token expired before a newer one reached it. The client reconnects. |
| `4003` | `evicted` | The device went over its application's connection cap, and this was its oldest connection. Not reconnected: the new connection would evict the next-oldest. |
| `1012` | `service_restart` | The server instance is shutting down, or lost its message queue. The client reconnects. |
| `1013` | `try_again_later` | The server instance can't take connections right now; it closes a new socket before `register`. Reconnect attempts wait longer each time. |

`1006`, a close without a close frame, means the network dropped, or the server
cut off a connection that stopped answering its pings. The client reconnects.

If the worker refuses to register the device because its session is over, or
the device no longer exists, `initTransport()` rejects with a
`NexxusTransportError` and `session_ended` fires with `transport_rejected`.
Branch on the error's `code`, never its message. If the connection closes
before the worker answers, it rejects with a `NexxusTransportClosedError`,
whose `code` is the close code — `1013` means try again later.

### Channels

`SubscribeCommand` returns a **`ReadonlyChannel`** — a read-only, live view of the query result. Consumers can query it and listen for changes, but not mutate it directly (mutations happen through the server and arrive as events).

```ts
const channel = await client.send(new SubscribeCommand({ type: 'task', filter: { priority: 'high' } }));

channel.size;                        // items held locally (this page)
channel.has(id);                     // membership
channel.get(id);                     // a single item
for (const task of channel) { }      // iterate models
for (const [id, task] of channel.entries()) { }  // iterate [id, model] pairs

await channel.remoteCount();         // total matching on the server, on demand
```

`channel.size` is what you hold locally; `channel.remoteCount()` is the server-side total for the channel's query (issued only when you call it — never automatically). For a single-`id` subscription it resolves locally without a request.

For a one-off read, use `SearchCommand` instead — a separate route, not a mode
of subscribing. It needs no transport connection, creates no channel, and
leaves no subscription behind:

```ts
const tasks = await client.send(new SearchCommand({ type: 'task', limit: 100 }));
```

To stop receiving updates, unsubscribe with the **same descriptor** that
created the subscription. The channel key is derived from `type` + `id` +
`userId` + `filter`, so any difference addresses a different channel and
returns `404`. Pagination is not part of it:

```ts
await client.send(new SubscribeCommand({ type: 'task', filter: { priority: 'high' }, limit: 50 }));
await client.send(new UnsubscribeCommand({ type: 'task', filter: { priority: 'high' } }));
```

The client drops its local `Channel` on success, so a stale view can't outlive
the subscription feeding it.

### Versioning & resync

Each model has a monotonically increasing `version`. The client applies an update only when it's exactly one ahead of the local copy. It fetches the current object instead when it sees a version gap, an update for an object not in its view, or an update it can't apply exactly, such as an `append` to a field that has no value yet. So a channel converges to the correct state even if events are missed or arrive out of order. Each fetch is logged under the `resync` label with a `reason` (`ResyncReason`): `not_in_channel`, `no_version`, `version_gap` or `patch_not_applied`.

### Logging

The SDK has one public logger, shared by every client in the process, that you can use and extend:

```ts
NexxusClient.logger.info('hello', { label: 'app' });
NexxusClient.logger.attachTransport((logObj) => { /* ship somewhere */ });
```

Defaults are environment-aware: pretty text in the browser, JSON in Node. Configure via the client's `logging` field (`level`, `format`); with several clients in one process, the last one constructed with a `logging` config sets them.

## Building from source

```sh
npm run build       # clean + CJS + ESM + type declarations into dist/
npm run typecheck   # type-check only, no emit
```

Outputs: `dist/cjs` (CommonJS), `dist/esm` (ES modules), `dist/types` (declarations), wired up through the `exports` map in `package.json`.

## License

[MPL-2.0](LICENSE) © Răzvan Botea
