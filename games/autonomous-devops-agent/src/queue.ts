import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { AgentContext } from './types.js';

export type QueueItemStatus = 'queued' | 'running' | 'retryable' | 'succeeded' | 'failed';
export type QueueItemType = 'jira' | 'pull_request';

export interface RunQueueItem {
  id: string;
  type: QueueItemType;
  issueId?: string;
  repo?: string;
  prNumber?: string;
  serviceNowRecordId?: string;
  approvalOverride?: boolean;
  approvalRequestId?: string;
  status: QueueItemStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  createdAt: string;
  updatedAt: string;
  runId?: string;
  resultStatus?: string;
  lastError?: string;
}

interface RunQueueStore {
  items: RunQueueItem[];
}

export interface QueueBackoffConfig {
  initialBackoffMs: number;
  maxBackoffMs: number;
}

export interface QueueOptions {
  maxAttempts: number;
  serviceNowRecordId?: string;
  approvalOverride?: boolean;
  approvalRequestId?: string;
}

export class FileRunQueue {
  private readonly filePath: string;

  constructor(queuePath: string) {
    this.filePath = isAbsolute(queuePath) ? queuePath : resolve(process.cwd(), queuePath);
  }

  enqueueJira(issueId: string, options: QueueOptions): RunQueueItem {
    if (!issueId) {
      throw new Error('issueId is required');
    }

    return this.enqueue({
      type: 'jira',
      issueId,
      maxAttempts: options.maxAttempts,
      serviceNowRecordId: options.serviceNowRecordId,
      approvalOverride: options.approvalOverride,
      approvalRequestId: options.approvalRequestId,
    });
  }

  enqueuePullRequest(repo: string, prNumber: string, options: QueueOptions): RunQueueItem {
    if (!repo || !prNumber) {
      throw new Error('repo and prNumber are required');
    }

    return this.enqueue({
      type: 'pull_request',
      repo,
      prNumber,
      maxAttempts: options.maxAttempts,
      serviceNowRecordId: options.serviceNowRecordId,
      approvalOverride: options.approvalOverride,
      approvalRequestId: options.approvalRequestId,
    });
  }

  list(): RunQueueItem[] {
    const store = this.readStore();
    return [...store.items].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(itemId: string): RunQueueItem | undefined {
    const store = this.readStore();
    return store.items.find((item) => item.id === itemId);
  }

  claimNext(now: Date = new Date()): RunQueueItem | undefined {
    const store = this.readStore();
    const nowMs = now.getTime();

    const next = store.items.find((item) => {
      if (item.status !== 'queued' && item.status !== 'retryable') {
        return false;
      }
      return new Date(item.nextAttemptAt).getTime() <= nowMs;
    });

    if (!next) {
      return undefined;
    }

    next.status = 'running';
    next.attempts += 1;
    next.updatedAt = now.toISOString();

    this.writeStore(store);
    return { ...next };
  }

  markSucceeded(itemId: string, context: AgentContext): RunQueueItem {
    const now = new Date().toISOString();
    const store = this.readStore();
    const item = this.requireItem(store, itemId);

    item.status = 'succeeded';
    item.updatedAt = now;
    item.runId = context.runId;
    item.resultStatus = context.status;
    item.lastError = undefined;

    this.writeStore(store);
    return { ...item };
  }

  markFailed(itemId: string, error: string, backoff: QueueBackoffConfig): RunQueueItem {
    const now = new Date();
    const store = this.readStore();
    const item = this.requireItem(store, itemId);

    item.lastError = error;
    item.updatedAt = now.toISOString();

    if (item.attempts >= item.maxAttempts) {
      item.status = 'failed';
      item.nextAttemptAt = now.toISOString();
    } else {
      const retryAfterMs = Math.min(
        backoff.maxBackoffMs,
        backoff.initialBackoffMs * Math.max(1, 2 ** (item.attempts - 1)),
      );
      item.status = 'retryable';
      item.nextAttemptAt = new Date(now.getTime() + retryAfterMs).toISOString();
    }

    this.writeStore(store);
    return { ...item };
  }

  private enqueue(input: {
    type: QueueItemType;
    issueId?: string;
    repo?: string;
    prNumber?: string;
    serviceNowRecordId?: string;
    approvalOverride?: boolean;
    approvalRequestId?: string;
    maxAttempts: number;
  }): RunQueueItem {
    const now = new Date().toISOString();
    const store = this.readStore();
    const item: RunQueueItem = {
      id: `q-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      type: input.type,
      issueId: input.issueId,
      repo: input.repo,
      prNumber: input.prNumber,
      serviceNowRecordId: input.serviceNowRecordId,
      approvalOverride: input.approvalOverride,
      approvalRequestId: input.approvalRequestId,
      status: 'queued',
      attempts: 0,
      maxAttempts: Math.max(1, input.maxAttempts),
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    };

    store.items.push(item);
    this.writeStore(store);
    return { ...item };
  }

  private requireItem(store: RunQueueStore, itemId: string): RunQueueItem {
    const item = store.items.find((entry) => entry.id === itemId);
    if (!item) {
      throw new Error(`Queue item not found: ${itemId}`);
    }
    return item;
  }

  private readStore(): RunQueueStore {
    if (!existsSync(this.filePath)) {
      return { items: [] };
    }

    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as RunQueueStore;
      if (!parsed || !Array.isArray(parsed.items)) {
        return { items: [] };
      }
      return { items: parsed.items };
    } catch {
      return { items: [] };
    }
  }

  private writeStore(store: RunQueueStore): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    renameSync(temp, this.filePath);
  }
}
