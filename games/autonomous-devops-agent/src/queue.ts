import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { createSharedPgPool, quoteIdentifier, toIso } from './pg.js';
import type { AgentContext } from './types.js';

export type QueueItemStatus =
  | 'queued'
  | 'running'
  | 'retryable'
  | 'succeeded'
  | 'failed'
  | 'canceled';
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
  leaseOwner?: string;
  leaseExpiresAt?: string;
  timeoutAt?: string;
  cancelRequested?: boolean;
  cancellationReason?: string;
  startedAt?: string;
  finishedAt?: string;
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

export interface ClaimNextOptions {
  now?: Date;
  workerId?: string;
  leaseMs?: number;
  runTimeoutMs?: number;
}

export interface ReapOptions {
  now?: Date;
  backoff: QueueBackoffConfig;
}

export interface RunQueueApi {
  enqueueJira(issueId: string, options: QueueOptions): Promise<RunQueueItem> | RunQueueItem;
  enqueuePullRequest(repo: string, prNumber: string, options: QueueOptions): Promise<RunQueueItem> | RunQueueItem;
  list(): Promise<RunQueueItem[]> | RunQueueItem[];
  get(itemId: string): Promise<RunQueueItem | undefined> | RunQueueItem | undefined;
  claimNext(options?: ClaimNextOptions | Date): Promise<RunQueueItem | undefined> | RunQueueItem | undefined;
  heartbeat(
    itemId: string,
    workerId: string,
    leaseMs: number,
    now?: Date,
  ): Promise<RunQueueItem | undefined> | RunQueueItem | undefined;
  markSucceeded(itemId: string, context: AgentContext): Promise<RunQueueItem> | RunQueueItem;
  markFailed(
    itemId: string,
    error: string,
    backoff: QueueBackoffConfig,
  ): Promise<RunQueueItem> | RunQueueItem;
  cancel(itemId: string, reason?: string): Promise<RunQueueItem> | RunQueueItem;
  retry(itemId: string): Promise<RunQueueItem> | RunQueueItem;
  forceTimeout(
    itemId: string,
    reason: string,
    backoff: QueueBackoffConfig,
  ): Promise<RunQueueItem> | RunQueueItem;
  reapExpiredRunning(options: ReapOptions): Promise<RunQueueItem[]> | RunQueueItem[];
}

export class FileRunQueue implements RunQueueApi {
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
    const item = store.items.find((entry) => entry.id === itemId);
    return item ? { ...item } : undefined;
  }

  claimNext(options: ClaimNextOptions | Date = new Date()): RunQueueItem | undefined {
    const claim = normalizeClaimOptions(options);
    const now = claim.now;
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
    next.startedAt = next.startedAt ?? now.toISOString();
    next.cancelRequested = false;
    next.cancellationReason = undefined;

    if (claim.workerId) {
      next.leaseOwner = claim.workerId;
      if (claim.leaseMs > 0) {
        next.leaseExpiresAt = new Date(now.getTime() + claim.leaseMs).toISOString();
      }
    }

    if (claim.runTimeoutMs > 0) {
      next.timeoutAt = new Date(now.getTime() + claim.runTimeoutMs).toISOString();
    }

    this.writeStore(store);
    return { ...next };
  }

  heartbeat(itemId: string, workerId: string, leaseMs: number, now: Date = new Date()): RunQueueItem | undefined {
    const store = this.readStore();
    const item = store.items.find((entry) => entry.id === itemId);
    if (!item) {
      return undefined;
    }

    if (item.status !== 'running') {
      return { ...item };
    }

    if (item.leaseOwner && item.leaseOwner !== workerId) {
      return { ...item };
    }

    item.leaseOwner = workerId;
    item.leaseExpiresAt = new Date(now.getTime() + Math.max(1, leaseMs)).toISOString();
    item.updatedAt = now.toISOString();
    this.writeStore(store);
    return { ...item };
  }

  markSucceeded(itemId: string, context: AgentContext): RunQueueItem {
    const now = new Date().toISOString();
    const store = this.readStore();
    const item = this.requireItem(store, itemId);

    if (item.status === 'canceled') {
      this.writeStore(store);
      return { ...item };
    }

    item.status = 'succeeded';
    item.updatedAt = now;
    item.runId = context.runId;
    item.resultStatus = context.status;
    item.lastError = undefined;
    item.leaseOwner = undefined;
    item.leaseExpiresAt = undefined;
    item.timeoutAt = undefined;
    item.finishedAt = now;

    this.writeStore(store);
    return { ...item };
  }

  markFailed(itemId: string, error: string, backoff: QueueBackoffConfig): RunQueueItem {
    const now = new Date();
    const store = this.readStore();
    const item = this.requireItem(store, itemId);
    const updated = applyFailureTransition(item, now, error, backoff);
    this.writeStore(store);
    return { ...updated };
  }

  cancel(itemId: string, reason = 'canceled by operator'): RunQueueItem {
    const store = this.readStore();
    const item = this.requireItem(store, itemId);
    const now = new Date().toISOString();

    if (isTerminalStatus(item.status)) {
      return { ...item };
    }

    item.status = 'canceled';
    item.cancelRequested = true;
    item.cancellationReason = reason;
    item.updatedAt = now;
    item.finishedAt = now;
    item.leaseOwner = undefined;
    item.leaseExpiresAt = undefined;
    item.timeoutAt = undefined;

    this.writeStore(store);
    return { ...item };
  }

  retry(itemId: string): RunQueueItem {
    const store = this.readStore();
    const item = this.requireItem(store, itemId);
    const now = new Date().toISOString();

    if (item.status === 'running') {
      throw new Error(`Queue item ${itemId} is running and cannot be retried`);
    }

    item.status = 'queued';
    item.attempts = 0;
    item.nextAttemptAt = now;
    item.updatedAt = now;
    item.runId = undefined;
    item.resultStatus = undefined;
    item.lastError = undefined;
    item.cancelRequested = false;
    item.cancellationReason = undefined;
    item.leaseOwner = undefined;
    item.leaseExpiresAt = undefined;
    item.timeoutAt = undefined;
    item.finishedAt = undefined;

    this.writeStore(store);
    return { ...item };
  }

  forceTimeout(itemId: string, reason: string, backoff: QueueBackoffConfig): RunQueueItem {
    const store = this.readStore();
    const item = this.requireItem(store, itemId);
    const now = new Date();
    const updated = applyFailureTransition(item, now, reason, backoff);
    this.writeStore(store);
    return { ...updated };
  }

  reapExpiredRunning(options: ReapOptions): RunQueueItem[] {
    const now = options.now ?? new Date();
    const store = this.readStore();
    const updates: RunQueueItem[] = [];

    for (const item of store.items) {
      if (item.status !== 'running') {
        continue;
      }

      if (item.cancelRequested) {
        const timestamp = now.toISOString();
        item.status = 'canceled';
        item.updatedAt = timestamp;
        item.finishedAt = timestamp;
        item.cancellationReason = item.cancellationReason ?? 'canceled while running';
        item.leaseOwner = undefined;
        item.leaseExpiresAt = undefined;
        item.timeoutAt = undefined;
        updates.push({ ...item });
        continue;
      }

      const leaseExpired = item.leaseExpiresAt && new Date(item.leaseExpiresAt).getTime() <= now.getTime();
      const timedOut = item.timeoutAt && new Date(item.timeoutAt).getTime() <= now.getTime();
      if (!leaseExpired && !timedOut) {
        continue;
      }

      const reason = timedOut
        ? `Run timed out at ${item.timeoutAt}`
        : `Worker lease expired at ${item.leaseExpiresAt}`;
      const updated = applyFailureTransition(item, now, reason, options.backoff);
      updates.push({ ...updated });
    }

    if (updates.length > 0) {
      this.writeStore(store);
    }
    return updates;
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
      cancelRequested: false,
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

export class PostgresRunQueue implements RunQueueApi {
  private readonly pool;

  private readonly tableSql: string;

  private readonly ready: Promise<void>;

  constructor(
    databaseUrl: string,
    schema = 'public',
  ) {
    this.pool = createSharedPgPool(databaseUrl);
    const schemaSql = quoteIdentifier(schema);
    this.tableSql = `${schemaSql}.${quoteIdentifier('run_queue')}`;
    this.ready = this.initialize(schemaSql);
  }

  async enqueueJira(issueId: string, options: QueueOptions): Promise<RunQueueItem> {
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

  async enqueuePullRequest(repo: string, prNumber: string, options: QueueOptions): Promise<RunQueueItem> {
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

  async list(): Promise<RunQueueItem[]> {
    await this.ready;
    const result = await this.pool.query(`SELECT * FROM ${this.tableSql} ORDER BY created_at ASC`);
    return result.rows.map((row) => mapQueueRow(row));
  }

  async get(itemId: string): Promise<RunQueueItem | undefined> {
    await this.ready;
    const result = await this.pool.query(`SELECT * FROM ${this.tableSql} WHERE id = $1 LIMIT 1`, [itemId]);
    if (result.rowCount === 0) {
      return undefined;
    }
    return mapQueueRow(result.rows[0]);
  }

  async claimNext(options: ClaimNextOptions | Date = new Date()): Promise<RunQueueItem | undefined> {
    await this.ready;
    const claim = normalizeClaimOptions(options);
    const nowIso = claim.now.toISOString();
    const leaseExpiresAt = claim.workerId && claim.leaseMs > 0
      ? new Date(claim.now.getTime() + claim.leaseMs).toISOString()
      : null;
    const timeoutAt = claim.runTimeoutMs > 0
      ? new Date(claim.now.getTime() + claim.runTimeoutMs).toISOString()
      : null;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query(
        `SELECT * FROM ${this.tableSql}
         WHERE status IN ('queued', 'retryable')
           AND next_attempt_at <= $1
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [nowIso],
      );

      if (selected.rowCount === 0) {
        await client.query('COMMIT');
        return undefined;
      }

      const row = selected.rows[0];
      const attempts = Number(row.attempts) + 1;
      const updated = await client.query(
        `UPDATE ${this.tableSql}
         SET status = 'running',
             attempts = $2,
             updated_at = $1,
             started_at = COALESCE(started_at, $1),
             cancel_requested = false,
             cancellation_reason = NULL,
             lease_owner = $3,
             lease_expires_at = $4,
             timeout_at = $5
         WHERE id = $6
         RETURNING *`,
        [nowIso, attempts, claim.workerId ?? null, leaseExpiresAt, timeoutAt, row.id],
      );
      await client.query('COMMIT');
      return mapQueueRow(updated.rows[0]);
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async heartbeat(
    itemId: string,
    workerId: string,
    leaseMs: number,
    now: Date = new Date(),
  ): Promise<RunQueueItem | undefined> {
    await this.ready;
    const updated = await this.pool.query(
      `UPDATE ${this.tableSql}
       SET lease_owner = $2,
           lease_expires_at = $3,
           updated_at = $1
       WHERE id = $4
         AND status = 'running'
         AND (lease_owner IS NULL OR lease_owner = $2)
       RETURNING *`,
      [now.toISOString(), workerId, new Date(now.getTime() + Math.max(1, leaseMs)).toISOString(), itemId],
    );
    if (updated.rowCount === 0) {
      return this.get(itemId);
    }
    return mapQueueRow(updated.rows[0]);
  }

  async markSucceeded(itemId: string, context: AgentContext): Promise<RunQueueItem> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await this.requireRow(client, itemId);
      if (row.status === 'canceled') {
        await client.query('COMMIT');
        return mapQueueRow(row);
      }

      const nowIso = new Date().toISOString();
      const updated = await client.query(
        `UPDATE ${this.tableSql}
         SET status = 'succeeded',
             updated_at = $1,
             run_id = $2,
             result_status = $3,
             last_error = NULL,
             lease_owner = NULL,
             lease_expires_at = NULL,
             timeout_at = NULL,
             finished_at = $1
         WHERE id = $4
         RETURNING *`,
        [nowIso, context.runId, context.status, itemId],
      );
      await client.query('COMMIT');
      return mapQueueRow(updated.rows[0]);
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async markFailed(itemId: string, error: string, backoff: QueueBackoffConfig): Promise<RunQueueItem> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await this.requireRow(client, itemId);
      const now = new Date();
      const updated = await this.applyFailureWithClient(client, row, now, error, backoff);
      await client.query('COMMIT');
      return updated;
    } catch (failure) {
      await safeRollback(client);
      throw failure;
    } finally {
      client.release();
    }
  }

  async cancel(itemId: string, reason = 'canceled by operator'): Promise<RunQueueItem> {
    await this.ready;
    const nowIso = new Date().toISOString();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await this.requireRow(client, itemId);
      if (isTerminalStatus(row.status as QueueItemStatus)) {
        await client.query('COMMIT');
        return mapQueueRow(row);
      }

      const updated = await client.query(
        `UPDATE ${this.tableSql}
         SET status = 'canceled',
             cancel_requested = true,
             cancellation_reason = $2,
             updated_at = $1,
             finished_at = $1,
             lease_owner = NULL,
             lease_expires_at = NULL,
             timeout_at = NULL
         WHERE id = $3
         RETURNING *`,
        [nowIso, reason, itemId],
      );
      await client.query('COMMIT');
      return mapQueueRow(updated.rows[0]);
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async retry(itemId: string): Promise<RunQueueItem> {
    await this.ready;
    const nowIso = new Date().toISOString();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await this.requireRow(client, itemId);
      if (row.status === 'running') {
        throw new Error(`Queue item ${itemId} is running and cannot be retried`);
      }

      const updated = await client.query(
        `UPDATE ${this.tableSql}
         SET status = 'queued',
             attempts = 0,
             next_attempt_at = $1,
             updated_at = $1,
             run_id = NULL,
             result_status = NULL,
             last_error = NULL,
             cancel_requested = false,
             cancellation_reason = NULL,
             lease_owner = NULL,
             lease_expires_at = NULL,
             timeout_at = NULL,
             finished_at = NULL
         WHERE id = $2
         RETURNING *`,
        [nowIso, itemId],
      );
      await client.query('COMMIT');
      return mapQueueRow(updated.rows[0]);
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async forceTimeout(itemId: string, reason: string, backoff: QueueBackoffConfig): Promise<RunQueueItem> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = await this.requireRow(client, itemId);
      const updated = await this.applyFailureWithClient(client, row, new Date(), reason, backoff);
      await client.query('COMMIT');
      return updated;
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async reapExpiredRunning(options: ReapOptions): Promise<RunQueueItem[]> {
    await this.ready;
    const now = options.now ?? new Date();
    const nowIso = now.toISOString();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const rows = await client.query(
        `SELECT * FROM ${this.tableSql}
         WHERE status = 'running'
           AND (
             cancel_requested = true
             OR (lease_expires_at IS NOT NULL AND lease_expires_at <= $1)
             OR (timeout_at IS NOT NULL AND timeout_at <= $1)
           )
         FOR UPDATE SKIP LOCKED`,
        [nowIso],
      );

      const updates: RunQueueItem[] = [];
      for (const row of rows.rows) {
        if (row.cancel_requested) {
          const canceled = await client.query(
            `UPDATE ${this.tableSql}
             SET status = 'canceled',
                 updated_at = $1,
                 finished_at = $1,
                 cancellation_reason = COALESCE(cancellation_reason, 'canceled while running'),
                 lease_owner = NULL,
                 lease_expires_at = NULL,
                 timeout_at = NULL
             WHERE id = $2
             RETURNING *`,
            [nowIso, row.id],
          );
          updates.push(mapQueueRow(canceled.rows[0]));
          continue;
        }

        const reason = row.timeout_at
          ? `Run timed out at ${toIso(row.timeout_at) ?? nowIso}`
          : `Worker lease expired at ${toIso(row.lease_expires_at) ?? nowIso}`;
        const updated = await this.applyFailureWithClient(client, row, now, reason, options.backoff);
        updates.push(updated);
      }

      await client.query('COMMIT');
      return updates;
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  private async initialize(schemaSql: string): Promise<void> {
    await this.pool.query(`CREATE SCHEMA IF NOT EXISTS ${schemaSql}`);
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.tableSql} (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        issue_id TEXT,
        repo TEXT,
        pr_number TEXT,
        service_now_record_id TEXT,
        approval_override BOOLEAN,
        approval_request_id TEXT,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        max_attempts INTEGER NOT NULL,
        next_attempt_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        run_id TEXT,
        result_status TEXT,
        last_error TEXT,
        lease_owner TEXT,
        lease_expires_at TIMESTAMPTZ,
        timeout_at TIMESTAMPTZ,
        cancel_requested BOOLEAN NOT NULL DEFAULT FALSE,
        cancellation_reason TEXT,
        started_at TIMESTAMPTZ,
        finished_at TIMESTAMPTZ
      )`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS run_queue_status_next_attempt_idx
       ON ${this.tableSql} (status, next_attempt_at)`,
    );
  }

  private async enqueue(input: {
    type: QueueItemType;
    issueId?: string;
    repo?: string;
    prNumber?: string;
    serviceNowRecordId?: string;
    approvalOverride?: boolean;
    approvalRequestId?: string;
    maxAttempts: number;
  }): Promise<RunQueueItem> {
    await this.ready;
    const nowIso = new Date().toISOString();
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
      nextAttemptAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
      cancelRequested: false,
    };

    await this.pool.query(
      `INSERT INTO ${this.tableSql} (
        id, type, issue_id, repo, pr_number, service_now_record_id, approval_override, approval_request_id,
        status, attempts, max_attempts, next_attempt_at, created_at, updated_at, cancel_requested
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8,
        $9, $10, $11, $12, $13, $14, $15
      )`,
      [
        item.id,
        item.type,
        item.issueId ?? null,
        item.repo ?? null,
        item.prNumber ?? null,
        item.serviceNowRecordId ?? null,
        item.approvalOverride ?? false,
        item.approvalRequestId ?? null,
        item.status,
        item.attempts,
        item.maxAttempts,
        item.nextAttemptAt,
        item.createdAt,
        item.updatedAt,
        item.cancelRequested ?? false,
      ],
    );

    return item;
  }

  private async requireRow(client: PoolClient, itemId: string): Promise<Record<string, unknown>> {
    const row = await client.query(`SELECT * FROM ${this.tableSql} WHERE id = $1 FOR UPDATE`, [itemId]);
    if (row.rowCount === 0) {
      throw new Error(`Queue item not found: ${itemId}`);
    }
    return row.rows[0] as Record<string, unknown>;
  }

  private async applyFailureWithClient(
    client: PoolClient,
    row: Record<string, unknown>,
    now: Date,
    error: string,
    backoff: QueueBackoffConfig,
  ): Promise<RunQueueItem> {
    if (row.status === 'canceled') {
      return mapQueueRow(row);
    }

    const attempts = Number(row.attempts);
    const maxAttempts = Number(row.max_attempts);
    const nowIso = now.toISOString();
    const shouldFail = attempts >= maxAttempts;
    const retryAfterMs = Math.min(
      backoff.maxBackoffMs,
      backoff.initialBackoffMs * Math.max(1, 2 ** (attempts - 1)),
    );
    const nextAttemptAt = shouldFail ? nowIso : new Date(now.getTime() + retryAfterMs).toISOString();
    const status = shouldFail ? 'failed' : 'retryable';
    const finishedAt = shouldFail ? nowIso : null;

    const updated = await client.query(
      `UPDATE ${this.tableSql}
       SET status = $2,
           last_error = $3,
           updated_at = $1,
           next_attempt_at = $4,
           lease_owner = NULL,
           lease_expires_at = NULL,
           timeout_at = NULL,
           finished_at = $5
       WHERE id = $6
       RETURNING *`,
      [nowIso, status, error, nextAttemptAt, finishedAt, row.id],
    );

    return mapQueueRow(updated.rows[0]);
  }
}

function applyFailureTransition(
  item: RunQueueItem,
  now: Date,
  error: string,
  backoff: QueueBackoffConfig,
): RunQueueItem {
  if (item.status === 'canceled') {
    return item;
  }

  item.lastError = error;
  item.updatedAt = now.toISOString();
  item.leaseOwner = undefined;
  item.leaseExpiresAt = undefined;
  item.timeoutAt = undefined;

  if (item.attempts >= item.maxAttempts) {
    item.status = 'failed';
    item.nextAttemptAt = now.toISOString();
    item.finishedAt = now.toISOString();
  } else {
    const retryAfterMs = Math.min(
      backoff.maxBackoffMs,
      backoff.initialBackoffMs * Math.max(1, 2 ** (item.attempts - 1)),
    );
    item.status = 'retryable';
    item.nextAttemptAt = new Date(now.getTime() + retryAfterMs).toISOString();
    item.finishedAt = undefined;
  }

  return item;
}

function isTerminalStatus(status: QueueItemStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled';
}

function mapQueueRow(row: Record<string, unknown>): RunQueueItem {
  return {
    id: String(row.id),
    type: String(row.type) as QueueItemType,
    issueId: asString(row.issue_id),
    repo: asString(row.repo),
    prNumber: asString(row.pr_number),
    serviceNowRecordId: asString(row.service_now_record_id),
    approvalOverride: asBoolean(row.approval_override),
    approvalRequestId: asString(row.approval_request_id),
    status: String(row.status) as QueueItemStatus,
    attempts: asInteger(row.attempts),
    maxAttempts: asInteger(row.max_attempts),
    nextAttemptAt: toIso(row.next_attempt_at) ?? new Date().toISOString(),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
    runId: asString(row.run_id),
    resultStatus: asString(row.result_status),
    lastError: asString(row.last_error),
    leaseOwner: asString(row.lease_owner),
    leaseExpiresAt: toIso(row.lease_expires_at),
    timeoutAt: toIso(row.timeout_at),
    cancelRequested: asBoolean(row.cancel_requested),
    cancellationReason: asString(row.cancellation_reason),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
  };
}

function normalizeClaimOptions(options: ClaimNextOptions | Date): Required<ClaimNextOptions> {
  if (options instanceof Date) {
    return {
      now: options,
      workerId: '',
      leaseMs: 0,
      runTimeoutMs: 0,
    };
  }

  return {
    now: options.now ?? new Date(),
    workerId: options.workerId ?? '',
    leaseMs: options.leaseMs ?? 0,
    runTimeoutMs: options.runTimeoutMs ?? 0,
  };
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return value;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === null || value === undefined) {
    return undefined;
  }
  return String(value) === 'true' || String(value) === '1';
}

function asInteger(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.floor(value);
  }
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // ignore rollback failures
  }
}
