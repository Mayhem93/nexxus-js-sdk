import { TransportServerMessage, TransportRegisterClientMessage, TransportModelEventData } from '../types';
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
 * WebSocket client that works in both Node.js and browser environments
 */
export class WsClient extends EventEmitter {
  private ws: WebSocket | WSWebSocket | null = null;
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
   */
  public async connect(onMessage: (payload: TransportModelEventData) => void): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        if (this.isBrowser) {
          this.ws = new window.WebSocket(this.config.url, this.config.protocols);
        } else {
          const { WebSocket } = await import('ws');
          const options = this.config.headers ? { headers: this.config.headers } : undefined;

          this.ws = new WebSocket(this.config.url, this.config.protocols, options);
        }

        this.setupEventHandlers(resolve, onMessage, reject);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Closes the WebSocket connection
   */
  public disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Checks if WebSocket is currently connected
   */
  public isConnected(): boolean {
    return this.ws !== null && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN);
  }

  /**
   * Gets the underlying WebSocket instance
   */
  public getSocket(): WebSocket | WSWebSocket | null {
    return this.ws;
  }

  public register(deviceId: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const payload: TransportRegisterClientMessage = {
      event: 'register',
      data: {
        deviceId,
      },
    };

    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Sets up event handlers for both browser and Node.js WebSocket implementations.
   * Both environments funnel incoming frames through `handleIncoming`.
   */
  private setupEventHandlers(onOpen: () => void, onMessage: (payload: TransportModelEventData) => void, onError: (error: any) => void): void {
    if (!this.ws) {
      return;
    }

    if (this.isBrowser) {
      // Browser WebSocket uses onopen/onerror/onmessage
      this.ws.onopen = () => onOpen();
      this.ws.onerror = (error: Event | ErrorEvent) => onError(error);
      this.ws.onmessage = (event: MessageEvent) => this.handleIncoming(event.data, onMessage);
    } else {
      // Node.js 'ws' uses the EventEmitter pattern
      const nodeWs = this.ws as WSWebSocket;

      nodeWs.on('open', () => onOpen());
      nodeWs.on('error', (error: Error) => onError(error));
      nodeWs.on('message', (data: Buffer | string) => {
        this.handleIncoming(typeof data === 'string' ? data : data.toString(), onMessage);
      });
    }
  }

  /**
   * Parses an incoming frame and routes it by type:
   * - `register` acks and `error` frames are surfaced as emitter events;
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

      case 'error':
        this.emit('transport-error', message.data);
        break;

      case 'model_created':
      case 'model_updated':
      case 'model_deleted':
        onMessage(message.data);
        break;
    }
  }
}
