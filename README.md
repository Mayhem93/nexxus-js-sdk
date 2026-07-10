# nexxus-js-sdk

TypeScript client SDK for the **Nexxus** backend. Works in **Node.js and modern browsers**, ships dual CommonJS / ESM builds with type definitions, and follows an **AWS SDK v3-style command pattern**: you build a command object and hand it to `client.send(...)`.

Its headline feature is **realtime channels** — a subscription returns a local, live-updating view of a server-side query result, kept in sync over a WebSocket.

## Features

- **Command pattern** — one small class per operation; `client.send(command)` returns typed output.
- **Realtime channels** — subscribe to a query and get a `Channel`: a local materialized view that stays current as objects are created, updated, and deleted server-side.
- **Version-aware sync** — every model carries a monotonic `version`; updates apply in order, and gaps or unknown objects trigger an automatic resync so a channel self-heals.
- **Isomorphic** — the same package runs in Node and the browser (WebSocket transport adapts automatically).
- **Built-in logger** — an isomorphic [tslog](https://tslog.js.org/) instance exposed as `client.logger`; attach your own transports (file, remote shipping, …).

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
  RegisterUserCommand,
  AuthLocalCommand,
  RegisterDeviceCommand,
  SubscribeCommand,
  CreateModelCommand,
} from 'nexxus-js-client';

const client = new NexxusClient({
  baseUrl: 'http://localhost:5000',
  appId: 'your-app-id',
  transportUri: 'ws://localhost:7000',      // omit to run without realtime
  logging: { level: 'info', format: 'json' },
});

// 1. Authenticate (for apps with auth enabled)
await client.send(new RegisterUserCommand({ username: 'alice', password: 'secret', name: 'Alice' }));
const auth = await client.send(new AuthLocalCommand({ username: 'alice', password: 'secret' }));
client.setAuthToken(auth.token);

// 2. Register a device and open the realtime transport
const { device } = await client.send(new RegisterDeviceCommand({ name: 'My Device' }));
client.setDeviceId(device.id);
await client.initTransport();

// 3. Subscribe — you get back a live Channel
const channel = await client.send(new SubscribeCommand({ model: 'task', limit: 50 }));

channel.on('model_created', (task) => console.log('new task', task.id));
channel.on('model_updated', (task) => console.log('updated', task.id));
channel.on('model_deleted', (task) => console.log('deleted', task.id));

// 4. Mutate — changes flow back to every subscriber via the channel
await client.send(new CreateModelCommand({ type: 'task', /* ...fields */ }));

// ... on shutdown
client.disconnectTransport();
```

## Core concepts

### Commands

Every operation is a command you `send`. Available commands:

| Area | Commands |
| --- | --- |
| Users | `RegisterUserCommand`, `AuthLocalCommand`, `GetUserCommand`, `UpdateUserCommand` |
| Devices | `RegisterDeviceCommand` |
| Models | `GetModelCommand`, `CreateModelCommand`, `UpdateModelCommand`, `DeleteModelCommand`, `CountCommand` |
| Subscriptions | `SubscribeCommand` |

### Channels

`SubscribeCommand` returns a **`ReadonlyChannel`** — a read-only, live view of the query result. Consumers can query it and listen for changes, but not mutate it directly (mutations happen through the server and arrive as events).

```ts
const channel = await client.send(new SubscribeCommand({ model: 'task', filter: { priority: 'high' } }));

channel.size;                        // items held locally (this page)
channel.has(id);                     // membership
channel.get(id);                     // a single item
for (const task of channel) { }      // iterate models
for (const [id, task] of channel.entries()) { }  // iterate [id, model] pairs

await channel.remoteCount();         // total matching on the server, on demand
```

`channel.size` is what you hold locally; `channel.remoteCount()` is the server-side total for the channel's query (issued only when you call it — never automatically). For a single-`id` subscription it resolves locally without a request.

One-off query without a live subscription:

```ts
const { items } = await client.send(new SubscribeCommand({ model: 'task', getOnly: true, limit: 100 }));
```

### Versioning & resync

Each model has a monotonically increasing `version`. The client applies an update only when it's exactly one ahead of the local copy. If it sees a version gap, or an update for an object not in its view, it fetches the current object and reconciles — so a channel converges to the correct state even if events are missed or arrive out of order.

### Logging

The client owns a public logger you can use and extend:

```ts
client.logger.info('hello', { label: 'app' });
client.logger.attachTransport((logObj) => { /* ship somewhere */ });
```

Defaults are environment-aware: pretty text in the browser, JSON in Node. Configure via the `logging` field (`level`, `format`).

## Building from source

```sh
npm run build       # clean + CJS + ESM + type declarations into dist/
npm run typecheck   # type-check only, no emit
```

Outputs: `dist/cjs` (CommonJS), `dist/esm` (ES modules), `dist/types` (declarations), wired up through the `exports` map in `package.json`.

## License

[MPL-2.0](LICENSE) © Răzvan Botea
