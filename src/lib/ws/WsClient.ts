import { TransportEventPayload, TransportRegisterClientPayload } from '../types';
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
  public async connect(onMessage: (message: Record<string, any>) => void): Promise<void> {
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

    const payload: TransportRegisterClientPayload = {
      event: 'register',
      data: {
        deviceId,
      },
    };

    this.ws.send(JSON.stringify(payload));
  }

  /**
   * Sets up event handlers for both browser and Node.js WebSocket implementations
   */
  private setupEventHandlers(onOpen: () => void, onMessage: (message: Record<string, any>) => void, onError: (error: any) => void): void {
    if (!this.ws) {
      return;
    }

    if (this.isBrowser) {
      // Browser WebSocket uses onopen/onerror/onmessage
      this.ws.onopen = () => onOpen();
      this.ws.onerror = (error: Event | ErrorEvent) => onError(error);
      this.ws.onmessage = (event: MessageEvent) => onMessage(JSON.parse(event.data));
    } else {
      // Node.js ws uses EventEmitter pattern
      const nodeWs = this.ws as WSWebSocket;

      nodeWs.on('open', () => onOpen());
      nodeWs.on('error', (error: Error) => onError(error));
      nodeWs.on('message', (data: Buffer | string) => {
        const message = JSON.parse(typeof data === 'string' ? data : data.toString()) as TransportEventPayload;

        switch (message.event) {
          case 'register':
            this.emit('registered', message.data);

            break;
        }

        // onMessage(JSON.parse(message));
      });
    }
  }
}
