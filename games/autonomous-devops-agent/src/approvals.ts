import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
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

export class FileApprovalStore {
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
    return state.approvals.find((entry) => entry.id === id);
  }

  createFromRun(queueItem: RunQueueItem, context: AgentContext, reason: string): ApprovalRequest {
    const state = this.readState();
    const existing = state.approvals.find((entry) => entry.runId === context.runId && entry.status === 'pending');
    if (existing) {
      return existing;
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
