import { SubscribeOutput } from './commands/subscription/Subscribe';
import { AppModel, ModelIdentity, TransportPatch } from './types';

import EventEmitter from 'eventemitter3';
import * as dot from 'dot-prop';

interface ChannelEvents {
  model_created: (model: AppModel) => void;
  model_updated: (model: ModelIdentity, patches: TransportPatch[]) => void;
  model_deleted: (model: ModelIdentity) => void;
}

export class Channel extends EventEmitter<ChannelEvents> {
  private name: string;
  private readonly items: Map<string, AppModel> = new Map();

  constructor(input: SubscribeOutput) {
    super();
    this.name = input.data.channelId;

    for (const item of input.data.items) {
      this.items.set(item.id, item);
    }

    this.on('model_created', (model) => {
      this.add(model);
    });

    this.on('model_updated', (model, patches) => {
      const obj = this.items.get(model.id);

      if (!obj) {
        console.warn(`Received update for unknown model ID "${model.id}" in channel ${this.name}`);

        return;
      }

      // All patches in an update event target the same model — apply in order.
      for (const patch of patches) {
        this.applyPatch(obj, patch);
      }
    });

    this.on('model_deleted', (model) => {
      this.remove(model.id);
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

  private applyPatch(obj: AppModel, patch: TransportPatch): void {
    const { op, path, value } = patch;

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
