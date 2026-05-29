import { Command } from '../../Command';
import type { NexxusClientConfig } from '../../types';

/**
 * Input for registering a new device
 */
export interface RegisterDeviceInput {
  /**
   * Human-readable name for the device
   * @example "John's iPhone"
   */
  name: string;
}

/**
 * Device registration response
 */
export interface RegisterDeviceOutput {
  message: string;
  device: {
    /**
   * Unique device identifier
   */
    id: string;

    /**
     * ID of the user who owns this device
     */
    userId?: string;

    /**
     * Human-readable device name
     */
    name: string;

    /**
     * Application ID this device belongs to
     */
    appId: string;
  }
}

/**
 * Command to register a new device
 *
 * @example
 * ```typescript
 * const client = new NexxusClient({ baseUrl: 'http://localhost:3000', appId: 'myapp' });
 * const command = new RegisterDeviceCommand({
 *   name: "John's iPhone",
 *   transport: 'websockets-transport'
 * });
 * const device = await client.send(command);
 * console.log('Device ID:', device.id);
 * ```
 */
export class RegisterDeviceCommand extends Command<RegisterDeviceInput, RegisterDeviceOutput> {
  constructor(input: RegisterDeviceInput) {
    super(input, { authEnabled: true });
  }

  public resolveRequest(config: NexxusClientConfig) {
    return {
      method: 'POST' as const,
      path: '/device/register',
      body: this.input,
    };
  }

  public parseResponse(response: any): RegisterDeviceOutput {
    return response as RegisterDeviceOutput;
  }
}
