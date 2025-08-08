import { EventEmitter } from 'node:events';

const bus = new EventEmitter();

export function emitRun(runId: string, payload: any) {
  bus.emit(`run:${runId}`, payload);
}

export function onRun(runId: string, listener: (p: any) => void) {
  const key = `run:${runId}`;
  bus.on(key, listener);
  return () => bus.off(key, listener);
}

