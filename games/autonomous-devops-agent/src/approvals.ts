import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { createSharedPgPool, quoteIdentifier, toIso } from './pg.js';
import type { AgentContext } from './types.js';
import type { RunQueueItem } from './queue.js';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface ApprovalRequest {
  id: string;
  status: ApprovalStatus;
  runId: string;
  queueItemId: string;
  queuedRunId?: string;
  type: 'jira' | 'pull_request';
  issueId?: string;
  repo?: string;
  prNumber?: string;
  serviceNowRecordId?: string;
  reason: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  rejectionReason?: string;
}

interface ApprovalStoreState {
  approvals: ApprovalRequest[];
}

export interface ApprovalStoreApi {
  list(status?: ApprovalStatus): ApprovalRequest[] | Promise<ApprovalRequest[]>;
  get(id: string): ApprovalRequest | undefined | Promise<ApprovalRequest | undefined>;
  createFromRun(
    queueItem: RunQueueItem,
    context: AgentContext,
    reason: string,
  ): ApprovalRequest | Promise<ApprovalRequest>;
  markApproved(
    id: string,
    options?: { approvedBy?: string; queuedRunId?: string },
  ): ApprovalRequest | Promise<ApprovalRequest>;
  markRejected(
    id: string,
    options?: { rejectedBy?: string; reason?: string },
  ): ApprovalRequest | Promise<ApprovalRequest>;
}

export class FileApprovalStore implements ApprovalStoreApi {
  private readonly filePath: string;

  constructor(path: string) {
    this.filePath = isAbsolute(path) ? path : resolve(process.cwd(), path);
  }

  list(status?: ApprovalStatus): ApprovalRequest[] {
    const state = this.readState();
    return state.approvals
      .filter((item) => (status ? item.status === status : true))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  get(id: string): ApprovalRequest | undefined {
    const state = this.readState();
    const approval = state.approvals.find((entry) => entry.id === id);
    return approval ? { ...approval } : undefined;
  }

  createFromRun(queueItem: RunQueueItem, context: AgentContext, reason: string): ApprovalRequest {
    const state = this.readState();
    const existing = state.approvals.find((entry) => entry.runId === context.runId && entry.status === 'pending');
    if (existing) {
      return { ...existing };
    }

    const now = new Date().toISOString();
    const request: ApprovalRequest = {
      id: `apr-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      status: 'pending',
      runId: context.runId,
      queueItemId: queueItem.id,
      type: queueItem.type,
      issueId: queueItem.issueId,
      repo: queueItem.repo,
      prNumber: queueItem.prNumber,
      serviceNowRecordId: queueItem.serviceNowRecordId,
      reason,
      createdAt: now,
      updatedAt: now,
    };

    state.approvals.push(request);
    this.writeState(state);
    return request;
  }

  markApproved(id: string, options?: { approvedBy?: string; queuedRunId?: string }): ApprovalRequest {
    const state = this.readState();
    const request = this.requireRequest(state, id);
    if (request.status !== 'pending') {
      throw new Error(`Approval ${id} is not pending`);
    }

    const now = new Date().toISOString();
    request.status = 'approved';
    request.approvedAt = now;
    request.updatedAt = now;
    request.approvedBy = options?.approvedBy;
    request.queuedRunId = options?.queuedRunId;

    this.writeState(state);
    return { ...request };
  }

  markRejected(id: string, options?: { rejectedBy?: string; reason?: string }): ApprovalRequest {
    const state = this.readState();
    const request = this.requireRequest(state, id);
    if (request.status !== 'pending') {
      throw new Error(`Approval ${id} is not pending`);
    }

    const now = new Date().toISOString();
    request.status = 'rejected';
    request.rejectedAt = now;
    request.updatedAt = now;
    request.rejectedBy = options?.rejectedBy;
    request.rejectionReason = options?.reason;

    this.writeState(state);
    return { ...request };
  }

  private requireRequest(state: ApprovalStoreState, id: string): ApprovalRequest {
    const request = state.approvals.find((entry) => entry.id === id);
    if (!request) {
      throw new Error(`Approval not found: ${id}`);
    }
    return request;
  }

  private readState(): ApprovalStoreState {
    if (!existsSync(this.filePath)) {
      return { approvals: [] };
    }

    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as ApprovalStoreState;
      if (!parsed || !Array.isArray(parsed.approvals)) {
        return { approvals: [] };
      }
      return { approvals: parsed.approvals };
    } catch {
      return { approvals: [] };
    }
  }

  private writeState(state: ApprovalStoreState): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.tmp`;
    writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    renameSync(temp, this.filePath);
  }
}

export class PostgresApprovalStore implements ApprovalStoreApi {
  private readonly pool;

  private readonly tableSql: string;

  private readonly ready: Promise<void>;

  constructor(
    databaseUrl: string,
    schema = 'public',
  ) {
    this.pool = createSharedPgPool(databaseUrl);
    const schemaSql = quoteIdentifier(schema);
    this.tableSql = `${schemaSql}.${quoteIdentifier('approvals')}`;
    this.ready = this.initialize(schemaSql);
  }

  async list(status?: ApprovalStatus): Promise<ApprovalRequest[]> {
    await this.ready;
    const result = status
      ? await this.pool.query(
        `SELECT * FROM ${this.tableSql} WHERE status = $1 ORDER BY created_at ASC`,
        [status],
      )
      : await this.pool.query(`SELECT * FROM ${this.tableSql} ORDER BY created_at ASC`);
    return result.rows.map((row) => mapApprovalRow(row));
  }

  async get(id: string): Promise<ApprovalRequest | undefined> {
    await this.ready;
    const result = await this.pool.query(`SELECT * FROM ${this.tableSql} WHERE id = $1 LIMIT 1`, [id]);
    if (result.rowCount === 0) {
      return undefined;
    }
    return mapApprovalRow(result.rows[0]);
  }

  async createFromRun(queueItem: RunQueueItem, context: AgentContext, reason: string): Promise<ApprovalRequest> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT * FROM ${this.tableSql}
         WHERE run_id = $1
           AND status = 'pending'
         LIMIT 1
         FOR UPDATE`,
        [context.runId],
      );
      if (existing.rowCount && existing.rows[0]) {
        await client.query('COMMIT');
        return mapApprovalRow(existing.rows[0]);
      }

      const nowIso = new Date().toISOString();
      const request: ApprovalRequest = {
        id: `apr-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        status: 'pending',
        runId: context.runId,
        queueItemId: queueItem.id,
        type: queueItem.type,
        issueId: queueItem.issueId,
        repo: queueItem.repo,
        prNumber: queueItem.prNumber,
        serviceNowRecordId: queueItem.serviceNowRecordId,
        reason,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      await client.query(
        `INSERT INTO ${this.tableSql} (
          id, status, run_id, queue_item_id, queued_run_id, type,
          issue_id, repo, pr_number, service_now_record_id, reason,
          created_at, updated_at, approved_at, approved_by,
          rejected_at, rejected_by, rejection_reason
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11,
          $12, $13, $14, $15,
          $16, $17, $18
        )`,
        [
          request.id,
          request.status,
          request.runId,
          request.queueItemId,
          request.queuedRunId ?? null,
          request.type,
          request.issueId ?? null,
          request.repo ?? null,
          request.prNumber ?? null,
          request.serviceNowRecordId ?? null,
          request.reason,
          request.createdAt,
          request.updatedAt,
          request.approvedAt ?? null,
          request.approvedBy ?? null,
          request.rejectedAt ?? null,
          request.rejectedBy ?? null,
          request.rejectionReason ?? null,
        ],
      );

      await client.query('COMMIT');
      return request;
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async markApproved(id: string, options?: { approvedBy?: string; queuedRunId?: string }): Promise<ApprovalRequest> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const request = await this.requireRequest(client, id);
      if (request.status !== 'pending') {
        throw new Error(`Approval ${id} is not pending`);
      }

      const nowIso = new Date().toISOString();
      const updated = await client.query(
        `UPDATE ${this.tableSql}
         SET status = 'approved',
             approved_at = $1,
             updated_at = $1,
             approved_by = $2,
             queued_run_id = $3
         WHERE id = $4
         RETURNING *`,
        [nowIso, options?.approvedBy ?? null, options?.queuedRunId ?? null, id],
      );

      await client.query('COMMIT');
      return mapApprovalRow(updated.rows[0]);
    } catch (error) {
      await safeRollback(client);
      throw error;
    } finally {
      client.release();
    }
  }

  async markRejected(id: string, options?: { rejectedBy?: string; reason?: string }): Promise<ApprovalRequest> {
    await this.ready;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const request = await this.requireRequest(client, id);
      if (request.status !== 'pending') {
        throw new Error(`Approval ${id} is not pending`);
      }

      const nowIso = new Date().toISOString();
      const updated = await client.query(
        `UPDATE ${this.tableSql}
         SET status = 'rejected',
             rejected_at = $1,
             updated_at = $1,
             rejected_by = $2,
             rejection_reason = $3
         WHERE id = $4
         RETURNING *`,
        [nowIso, options?.rejectedBy ?? null, options?.reason ?? null, id],
      );

      await client.query('COMMIT');
      return mapApprovalRow(updated.rows[0]);
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
        status TEXT NOT NULL,
        run_id TEXT NOT NULL,
        queue_item_id TEXT NOT NULL,
        queued_run_id TEXT,
        type TEXT NOT NULL,
        issue_id TEXT,
        repo TEXT,
        pr_number TEXT,
        service_now_record_id TEXT,
        reason TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        approved_at TIMESTAMPTZ,
        approved_by TEXT,
        rejected_at TIMESTAMPTZ,
        rejected_by TEXT,
        rejection_reason TEXT
      )`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS approvals_status_created_idx
       ON ${this.tableSql} (status, created_at)`,
    );
    await this.pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS approvals_pending_run_id_idx
       ON ${this.tableSql} (run_id)
       WHERE status = 'pending'`,
    );
  }

  private async requireRequest(client: PoolClient, id: string): Promise<ApprovalRequest> {
    const result = await client.query(`SELECT * FROM ${this.tableSql} WHERE id = $1 FOR UPDATE`, [id]);
    if (result.rowCount === 0 || !result.rows[0]) {
      throw new Error(`Approval not found: ${id}`);
    }
    return mapApprovalRow(result.rows[0]);
  }
}

function mapApprovalRow(row: Record<string, unknown>): ApprovalRequest {
  return {
    id: String(row.id),
    status: asApprovalStatus(row.status),
    runId: String(row.run_id),
    queueItemId: String(row.queue_item_id),
    queuedRunId: asString(row.queued_run_id),
    type: asQueueType(row.type),
    issueId: asString(row.issue_id),
    repo: asString(row.repo),
    prNumber: asString(row.pr_number),
    serviceNowRecordId: asString(row.service_now_record_id),
    reason: asString(row.reason) ?? '',
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
    approvedAt: toIso(row.approved_at),
    approvedBy: asString(row.approved_by),
    rejectedAt: toIso(row.rejected_at),
    rejectedBy: asString(row.rejected_by),
    rejectionReason: asString(row.rejection_reason),
  };
}

function asString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return value;
}

function asQueueType(value: unknown): 'jira' | 'pull_request' {
  const normalized = String(value);
  return normalized === 'pull_request' ? 'pull_request' : 'jira';
}

function asApprovalStatus(value: unknown): ApprovalStatus {
  const normalized = String(value);
  if (normalized === 'approved' || normalized === 'rejected') {
    return normalized;
  }
  return 'pending';
}

async function safeRollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK');
  } catch {
    // ignore rollback failures
  }
}
