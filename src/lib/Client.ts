import type { NexxusClientConfig } from './types';
import { Command } from './Command';
import { HttpHandler } from './HttpHandler';
import { Channel } from './Channel';
import { WsClient } from './ws/WsClient';
import EventEmitter from 'eventemitter3';
import { resolve } from 'node:dns';

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
    if (this.wsClient) {
      await this.wsClient.connect(this.handleChannelMessage.bind(this));

      this.wsClient.register(this.config.deviceId!);

      await new Promise((resolve) => {
        this.wsClient!.once('registered', (data) => {
          console.log('Device registered:', data);

          resolve(undefined);
        });
      });

      this.emit('connected');
    }
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

  private handleChannelMessage(message: any): void {
    console.log('Received channel message:', message);
  }
}
