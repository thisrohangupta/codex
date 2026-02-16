import type { AgentEvent } from './types.js';

export type EventListener = (event: AgentEvent) => void;

/**
 * In-memory event bus that captures execution telemetry and allows real-time subscriptions.
 */
export class EventBus {
  private readonly listeners = new Set<EventListener>();
  private readonly history: AgentEvent[] = [];

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: AgentEvent): void {
    this.history.push(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  list(): AgentEvent[] {
    return [...this.history];
  }
}
