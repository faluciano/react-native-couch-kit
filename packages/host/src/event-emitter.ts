/**
 * Lightweight, type-safe EventEmitter implementation for cross-platform compatibility.
 * Works in browser, React Native, and Node.js environments.
 *
 * @typeParam EventMap - A record mapping event names to their listener argument tuples.
 *
 * @example
 * ```ts
 * type MyEvents = {
 *   data: [payload: string];
 *   error: [err: Error];
 *   close: [];
 * };
 * const emitter = new EventEmitter<MyEvents>();
 * emitter.on("data", (payload) => { ... }); // payload is typed as string
 * ```
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class EventEmitter<
  EventMap extends Record<string, any[]> = Record<string, any[]>,
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listeners: Map<string, Array<(...args: any[]) => void>> = new Map();

  on<K extends string & keyof EventMap>(
    event: K,
    listener: (...args: EventMap[K]) => void,
  ): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(listener);
    return this;
  }

  once<K extends string & keyof EventMap>(
    event: K,
    listener: (...args: EventMap[K]) => void,
  ): this {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onceWrapper = (...args: any[]) => {
      this.off(event, onceWrapper as (...a: EventMap[K]) => void);
      listener(...(args as EventMap[K]));
    };
    return this.on(event, onceWrapper as (...a: EventMap[K]) => void);
  }

  off<K extends string & keyof EventMap>(
    event: K,
    listener: (...args: EventMap[K]) => void,
  ): this {
    const listeners = this.listeners.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index !== -1) {
        listeners.splice(index, 1);
      }
    }
    return this;
  }

  emit<K extends string & keyof EventMap>(
    event: K,
    ...args: EventMap[K]
  ): boolean {
    const listeners = this.listeners.get(event);
    if (!listeners || listeners.length === 0) {
      return false;
    }

    // Create a copy to avoid issues if listeners are added/removed during emit
    const listenersCopy = [...listeners];
    for (const listener of listenersCopy) {
      try {
        listener(...args);
      } catch (error) {
        console.error(`Error in event listener for "${event}":`, error);
      }
    }
    return true;
  }

  removeAllListeners<K extends string & keyof EventMap>(event?: K): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }

  listenerCount<K extends string & keyof EventMap>(event: K): number {
    return this.listeners.get(event)?.length ?? 0;
  }
}
