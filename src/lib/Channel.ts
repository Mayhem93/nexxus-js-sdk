import { SubscribeOutput } from './commands/subscription/Subscribe';
import { AppModel, TransportModelUpdatedEventPayload } from './types';

import EventEmitter from 'eventemitter3';
import * as dot from 'dot-prop';

interface ChannelEvents {
  model_created: (item: AppModel) => void;
  model_updated: (data: TransportModelUpdatedEventPayload['data']) => void;
  model_deleted: (item: AppModel) => void;
}

export class Channel extends EventEmitter<ChannelEvents> {
  private name: string;
  private readonly items: Map<string, AppModel> = new Map();

  constructor(input: SubscribeOutput) {
    super();
    this.name = input.data.channelId;

    console.log(input);

    for (const item of input.data.items) {
      this.items.set(item.id, item);
    }

    this.on('model_created', (item: AppModel) => {
      this.add(item);
    });

    this.on('model_updated', (data: TransportModelUpdatedEventPayload['data']) => {
      const obj = this.items.get(data.metadata.id);

      if (!obj) {
        console.warn(`Received update for unknown model ID ${data.metadata.id} in channel ${this.name}`);

        return;
      }

      this.applyPatch(obj, data);
    });

    this.on('model_deleted', (item: AppModel) => {
      const removed = this.remove(item.id);

      if (removed) {
        console.log(`Model with ID ${item.id} removed from channel ${this.name}: ${removed}`);
      } else {
        console.log(`Model with ID ${item.id} not found in channel ${this.name}`);
      }
    });
  }

  public [Symbol.iterator](): Iterator<AppModel> {
    return this.items.values();
  }

  public add(item: AppModel): void {
    this.items.set(item.id, item);
  }

  public remove(itemId: string): boolean {
    return this.items.delete(itemId);
  }

  public has(itemId: string): boolean {
    return this.items.has(itemId);
  }

  public get size(): number {
    return this.items.size;
  }

  public getName(): string {
    return this.name;
  }

  private applyPatch(obj: AppModel, updated: TransportModelUpdatedEventPayload['data']): void {
    const { op, path, value } = updated;

    // Ensure path and value arrays have the same length
    if (path.length !== value.length) {
      console.warn(`Path and value arrays length mismatch in channel ${this.name}`);
      return;
    }

    for (let i = 0; i < path.length; i++) {
      const fieldPath = path[i];
      const fieldValue = value[i];

      try {
        switch (op) {
          case 'replace':
            // Replace the value at the given path
            dot.setProperty(obj, fieldPath, fieldValue);
            break;

          case 'append':
            // Append to an array or string at the given path
            {
              const currentValue = dot.getProperty(obj, fieldPath);

              if (Array.isArray(currentValue)) {
                const arr = currentValue as any[];
                arr.push(fieldValue);
              } else if (typeof currentValue === 'string') {
                dot.setProperty(obj, fieldPath, currentValue + (fieldValue as string));
              } else {
                console.warn(`Cannot append to non-array/non-string field ${fieldPath} in channel ${this.name}`);
              }
            }
            break;

          case 'prepend':
            // Prepend to an array or string at the given path
            {
              const currentValue = dot.getProperty(obj, fieldPath);

              if (Array.isArray(currentValue)) {
                const arr = currentValue as any[];
                arr.unshift(fieldValue);
              } else if (typeof currentValue === 'string') {
                dot.setProperty(obj, fieldPath, (fieldValue as string) + currentValue);
              } else {
                console.warn(`Cannot prepend to non-array/non-string field ${fieldPath} in channel ${this.name}`);
              }
            }
            break;

          case 'incr':
            // Increment a numeric value
            {
              const currentValue = dot.getProperty(obj, fieldPath);
              if (typeof currentValue === 'number') {
                dot.setProperty(obj, fieldPath, currentValue + (fieldValue as number));
              } else {
                console.warn(`Cannot increment non-numeric field ${fieldPath} in channel ${this.name}`);
              }
            }
            break;

          case 'decr':
            // Decrement a numeric value
            {
              const currentValue = dot.getProperty(obj, fieldPath);
              if (typeof currentValue === 'number') {
                dot.setProperty(obj, fieldPath, currentValue - (fieldValue as number));
              } else {
                console.warn(`Cannot decrement non-numeric field ${fieldPath} in channel ${this.name}`);
              }
            }
            break;

          default:
            console.warn(`Unknown patch operation ${op} in channel ${this.name}`);
        }
      } catch (error) {
        console.warn(`Failed to apply ${op} operation on ${fieldPath} in channel ${this.name}:`, error);
      }
    }
  }
}
