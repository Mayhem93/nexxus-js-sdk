import type { NexxusClientConfig, TransportModelEventData } from './types';
import { Command } from './Command';
import { HttpHandler } from './HttpHandler';
import { Channel } from './Channel';
import { WsClient } from './ws/WsClient';
import EventEmitter from 'eventemitter3';

/**
 * Main Nexxus API client
 */
export class NexxusClient extends EventEmitter {
  private config: NexxusClientConfig;
  private httpHandler: HttpHandler;
  private authToken?: string;
  private channels: Map<string, Channel> = new Map();
  private wsClient: WsClient | null = null;

  constructor(config: NexxusClientConfig) {
    super();

    this.config = { ...config };
    this.httpHandler = new HttpHandler();

    if (this.config.transportUri) {
      this.wsClient = new WsClient({ url: this.config.transportUri});
    }
  }

  public async initTransport(): Promise<void> {
    if (!this.wsClient) {
      return;
    }

    if (!this.config.deviceId) {
      throw new Error('A deviceId is required before initializing the transport. Register a device first.');
    }

    await this.wsClient.connect(this.handleChannelMessage.bind(this));

    // Attach the listener before registering so the ack can't race ahead of us.
    const registered = new Promise<void>((resolve) => {
      this.wsClient!.once('registered', () => resolve());
    });

    this.wsClient.register(this.config.deviceId);

    await registered;

    this.emit('connected');
  }

  /**
   * Executes a command against the Nexxus API
   * @param command - Command instance to execute
   * @returns Typed command output
   */
  public async send<TInput, TOutput>(command: Command<TInput, TOutput>): Promise<TOutput> {
    const requestConfig = command.resolveRequest(this.config);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'nxx-app-id': this.config.appId,
      ...requestConfig.headers,
    };

    if (this.config.deviceId) {
      headers['nxx-device-id'] = this.config.deviceId;
    }

    if (this.authToken && command.authEnabled()) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const request = {
      method: requestConfig.method,
      path: `${this.config.baseUrl}${requestConfig.path}`,
      headers,
      body: requestConfig.body ? JSON.stringify(requestConfig.body) : undefined,
    };

    const response = await this.httpHandler.handle(request);
    const parsedBody = response.body ? JSON.parse(response.body) : {};

    const result = command.parseResponse(parsedBody);

    if (result instanceof Channel) {
      this.channels.set(result.getName(), result);
    }

    return result;
  }

  /**
   * Updates the device ID (typically called after device registration)
   * @param deviceId - New device identifier
   */
  public setDeviceId(deviceId: string): void {
    this.config.deviceId = deviceId;
  }

  /**
   * Gets the current device ID
   * @returns Current device identifier or undefined
   */
  public getDeviceId(): string | undefined {
    return this.config.deviceId;
  }

  public setAuthToken(token: string): void {
    this.authToken = token;
  }

  public getChannel(channelId: string): Channel | undefined {
    return this.channels.get(channelId);
  }

  public getChannels(): Iterable<Channel> {
    return this.channels.values();
  }

  private handleChannelMessage(payload: TransportModelEventData): void {
    switch (payload.event) {
      case 'model_created':
        this.dispatchToChannels(payload.metadata.channels, (channel) => channel.emit('model_created', payload.model));
        break;

      case 'model_updated':
        this.dispatchToChannels(payload.metadata.channels, (channel) => channel.emit('model_updated', payload.model, payload.patches));
        break;

      case 'model_deleted':
        this.dispatchToChannels(payload.metadata.channels, (channel) => channel.emit('model_deleted', payload.model));
        break;
    }
  }

  /**
   * Emits an event onto every locally-held channel whose key appears in the
   * server-provided channel list. Channels this client doesn't hold are ignored.
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
