import type {
  TransportServerMessage,
  TransportClientMessage,
  TransportModelEventData,
  TransportDisconnect,
} from '../types';
import type { WebSocket as WSWebSocket } from 'ws';
import EventEmitter from 'eventemitter3';

/**
 * Configuration for WebSocket client
 */
export interface WsClientConfig {
  /**
   * WebSocket server URL (e.g., 'ws://localhost:3000' or 'wss://api.example.com')
   */
  url: string;

  /**
   * Optional protocols to use when connecting
   */
  protocols?: string | string[];

  /**
   * Optional headers (Node.js only - browsers don't support custom headers in WebSocket constructor)
   */
  headers?: Record<string, string>;
}

/**
 * WebSocket client that works in both Node.js and browser environments.
 *
 * Events:
 * - `registered` ({@link TransportRegisterAck}) — the worker accepted a
 *   `register` frame; the ack carries the connection's id.
 * - `token_refreshed` — the worker accepted a `refresh_access_token` frame.
 * - `transport_error` ({@link TransportErrorData}) — the worker refused a frame.
 * - `closed` ({@link TransportDisconnect}, `closedByClient`) — the connection
 *   closed, from either end. `closedByClient` is `true` when {@link disconnect}
 *   closed it, and `false` when the server or the network did.
 * - `error` — a frame could not be parsed.
 */
export class WsClient extends EventEmitter {
  private ws: WebSocket | WSWebSocket | null = null;
  /**
   * Bumped by every `connect` and `disconnect`, so a `connect` still loading
   * the `ws` package can tell, once it has, that it was cancelled or
   * overtaken meanwhile — and not open a socket nobody wants.
   */
  private generation = 0;
  /** How the current socket closed, if it has; reset when the next one opens. */
  private lastClose?: TransportDisconnect;
  private config: WsClientConfig;
  private isBrowser: boolean;

  constructor(config: WsClientConfig) {
    super();

    this.config = config;
    this.isBrowser = typeof window !== 'undefined' && window.WebSocket !== undefined;
  }

  /**
   * Establishes WebSocket connection
   * Uses native WebSocket in browsers, 'ws' package in Node.js
   *
   * A connection that is already open is closed first: two live sockets would
   * register two connections of the device, and their close events would be
   * indistinguishable.
   */
  public async connect(onMessage: (payload: TransportModelEventData) => void): Promise<void> {
    this.disconnect();

    const generation = this.generation;

    return new Promise(async (resolve, reject) => {
      try {
        if (this.isBrowser) {
          this.lastClose = undefined;
          this.ws = new window.WebSocket(this.config.url, this.config.protocols);
        } else {
          const { WebSocket } = await import('ws');

          if (generation !== this.generation) {
            reject(new Error('The connection was closed before it opened'));

            return;
          }

          const options = this.config.headers ? { headers: this.config.headers } : undefined;

          this.lastClose = undefined;
          this.ws = new WebSocket(this.config.url, this.config.protocols, options);
        }

        this.setupEventHandlers(resolve, onMessage, reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Closes the WebSocket connection. `closed` follows once the close completes.
   */
  public disconnect(code?: number, reason?: string): void {
    this.generation++;

    if (this.ws) {
      this.ws.close(code, reason);
      this.ws = null;
    }
  }

  /**
   * Checks if WebSocket is currently connected
   */
  public isConnected(): boolean {
    return this.ws !== null && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN);
  }

  /** Whether the current socket is in its closing handshake. */
  public isClosing(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.CLOSING;
  }

  /** How the current socket closed — until the next one opens. */
  public getLastClose(): TransportDisconnect | undefined {
    return this.lastClose;
  }

  /**
   * Gets the underlying WebSocket instance
   */
  public getSocket(): WebSocket | WSWebSocket | null {
    return this.ws;
  }

  /**
   * Claim a device on this connection by presenting the token it was issued
   * to. The worker verifies the signature and reads the device from the
   * claims — a device id alone is no longer enough to register a transport.
   *
   * One registration per connection may be in flight: the worker drops a
   * second `register` frame sent before the first is acknowledged, so callers
   * must await the ack rather than pipelining.
   *
   * `previousConnectionId` names a connection of the device that closed
   * without this client closing it, so the server ends it at once instead of
   * holding it, subscriptions and all, until it notices. Left out of the frame
   * when there is none.
   */
  public register(token: string, previousConnectionId?: string): void {
    this.sendFrame({
      event: 'register',
      data: previousConnectionId === undefined ? { token } : { token, previousConnectionId },
    });
  }

  /**
   * Move this registered connection onto a newer access token for the same
   * device, so it outlives the one it registered with. The worker answers with
   * `token_refreshed`, or a `transport_error` — which leaves the connection
   * running on the token it had.
   */
  public refreshAccessToken(token: string): void {
    this.sendFrame({ event: 'refresh_access_token', data: { token } });
  }

  private sendFrame(frame: TransportClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    this.ws.send(JSON.stringify(frame));
  }

  /**
   * Sets up event handlers for both browser and Node.js WebSocket implementations.
   * Both environments funnel incoming frames through `handleIncoming`, and
   * closes through `handleClose`.
   *
   * Frames from a socket that is no longer the current one — disconnected, or
   * replaced — are dropped: a late reply on an old socket would otherwise be
   * taken for the answer to a registration on the new one.
   */
  private setupEventHandlers(onOpen: () => void, onMessage: (payload: TransportModelEventData) => void, onError: (error: any) => void): void {
    const socket = this.ws;

    if (!socket) {
      return;
    }

    if (this.isBrowser) {
      // Browser WebSocket uses onopen/onerror/onmessage/onclose
      const browserWs = socket as WebSocket;

      browserWs.onopen = () => onOpen();
      browserWs.onerror = (error: Event | ErrorEvent) => onError(error);
      browserWs.onmessage = (event: MessageEvent) => {
        if (this.ws === socket) {
          this.handleIncoming(event.data, onMessage);
        }
      };
      browserWs.onclose = (event: CloseEvent) => this.handleClose(socket, event.code, event.reason);
    } else {
      // Node.js 'ws' uses the EventEmitter pattern
      const nodeWs = socket as WSWebSocket;

      nodeWs.on('open', () => onOpen());
      nodeWs.on('error', (error: Error) => onError(error));
      nodeWs.on('message', (data: Buffer | string) => {
        if (this.ws === socket) {
          this.handleIncoming(typeof data === 'string' ? data : data.toString(), onMessage);
        }
      });
      nodeWs.on('close', (code: number, reason: Buffer) => this.handleClose(socket, code, reason.toString()));
    }
  }

  /**
   * Report a closed connection — unless it is one a newer `connect` already
   * replaced, whose close is old news. A socket this client disconnected
   * itself still reports: `this.ws` is already `null` for it, which is also
   * what tells its close apart from one the server or the network made.
   */
  private handleClose(socket: WebSocket | WSWebSocket, code: number, reason: string): void {
    if (this.ws !== socket && this.ws !== null) {
      return;
    }

    const closedByClient = this.ws === null;

    this.ws = null;

    const event: TransportDisconnect = { code, reason };

    this.lastClose = event;
    this.emit('closed', event, closedByClient);
  }

  /**
   * Parses an incoming frame and routes it by type:
   * - acks and `error` frames are surfaced as emitter events;
   * - model-change events are forwarded to `onMessage` for channel routing.
   *
   * Shared by the browser and Node.js message handlers.
   */
  private handleIncoming(raw: string, onMessage: (payload: TransportModelEventData) => void): void {
    let message: TransportServerMessage;

    try {
      message = JSON.parse(raw) as TransportServerMessage;
    } catch {
      this.emit('error', new Error('Received a malformed message from the transport'));

      return;
    }

    switch (message.event) {
      case 'register':
        this.emit('registered', message.data);
        break;

      case 'refresh_access_token':
        this.emit('token_refreshed', message.data);
        break;

      case 'error':
        this.emit('transport_error', message.data);
        break;

      case 'model_created':
      case 'model_updated':
      case 'model_deleted':
        onMessage(message.data);
        break;
    }
  }
}
