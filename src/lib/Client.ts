import type { NexxusClientConfig, TransportModelEventData } from './types';
import { Command } from './Command';
import { HttpHandler } from './HttpHandler';
import { Channel, type ReadonlyChannel } from './Channel';
import { GetModelCommand } from './commands/model/Get';
import { WsClient } from './ws/WsClient';
import { createLogger } from './logger';
import EventEmitter from 'eventemitter3';
import type { Logger, ILogObj } from 'tslog';

/**
 * Main Nexxus API client
 */
export class NexxusClient extends EventEmitter {
  private config: NexxusClientConfig;
  private httpHandler: HttpHandler;
  private authToken?: string;
  private channels: Map<string, Channel> = new Map();
  private wsClient: WsClient | null = null;

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

  public disconnectTransport(): void {
    if (!this.wsClient) {
      return;
    }

    this.wsClient.disconnect();
    this.emit('disconnected');
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

  public getChannel(channelId: string): ReadonlyChannel | undefined {
    return this.channels.get(channelId);
  }

  public getChannels(): Iterable<ReadonlyChannel> {
    return this.channels.values();
  }

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

          if (!local) {
            // Not in our view slice — fetch the full current object.
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
    this.logger.debug('resync: fetching model', { label: 'resync', type, id, channel: channel.getName() });

    try {
      const { data } = await this.send(new GetModelCommand({ id, type }));
      channel.upsert(data);
      this.logger.debug('resync: upserted', { label: 'resync', id, version: data.version });
    } catch (error) {
      this.logger.error('resync: failed', { label: 'resync', type, id, error: error instanceof Error ? error.message : String(error) });
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
