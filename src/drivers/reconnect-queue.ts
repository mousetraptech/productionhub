/**
 * Ring buffer for queuing messages during disconnection.
 *
 * When a driver (OBS, VISCA) loses its connection, messages are queued
 * here instead of being silently dropped. On reconnect the driver calls
 * flush() and the queued messages are replayed in order.
 *
 * The buffer has a fixed capacity — oldest messages are evicted when
 * the buffer is full, so memory stays bounded even during long outages.
 */

export interface QueuedMessage<T = any> {
  timestamp: number;
  data: T;
}

export class ReconnectQueue<T = any> {
  private buffer: Array<QueuedMessage<T> | undefined>;
  private head: number = 0;   // next write position
  private count: number = 0;  // current item count
  private readonly capacity: number;

  constructor(capacity = 64) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
  }

  /** Enqueue a message. Oldest message is evicted if buffer is full. */
  push(data: T): void {
    this.buffer[this.head] = { timestamp: Date.now(), data };
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /**
   * Drain all queued messages in FIFO order and clear the buffer.
   * Returns an array of the queued data items.
   */
  flush(): T[] {
    if (this.count === 0) return [];

    const result: T[] = [];
    // Start position: head - count (wrap around)
    let readIdx = (this.head - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) {
      const item = this.buffer[readIdx];
      if (item) {
        result.push(item.data);
      }
      readIdx = (readIdx + 1) % this.capacity;
    }

    this.clear();
    return result;
  }

  /** Clear all queued messages without replaying them. */
  clear(): void {
    this.head = 0;
    this.count = 0;
    this.buffer = new Array(this.capacity);
  }

  /** Number of messages currently queued */
  get size(): number {
    return this.count;
  }

  /** Whether the buffer is empty */
  get empty(): boolean {
    return this.count === 0;
  }
}
