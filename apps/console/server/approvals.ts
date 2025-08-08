import { nanoid, nowISO } from './util';
import { upsert, get as dbGet, list as dbList } from './store';
import { record } from './audit';

export type Approval = {
  id: string;
  planId: string;
  status: 'requested' | 'approved' | 'denied';
  requestedBy: string;
  decidedBy?: string;
  createdAt: string;
  decidedAt?: string;
};

export function requestApproval(planId: string, user: string): Approval {
  const a: Approval = { id: nanoid(), planId, status: 'requested', requestedBy: user, createdAt: nowISO() };
  upsert('approvals', a.id, a);
  record(user, 'APPROVAL_REQUESTED', planId, { approvalId: a.id });
  return a;
}

export function approve(approvalId: string, user: string): Approval | undefined {
  const a = dbGet<Approval>('approvals', approvalId);
  if (!a) return undefined;
  const updated: Approval = { ...a, status: 'approved', decidedBy: user, decidedAt: nowISO() };
  upsert('approvals', approvalId, updated);
  record(user, 'APPROVED', a.planId, { approvalId });
  return updated;
}

export function deny(approvalId: string, user: string): Approval | undefined {
  const a = dbGet<Approval>('approvals', approvalId);
  if (!a) return undefined;
  const updated: Approval = { ...a, status: 'denied', decidedBy: user, decidedAt: nowISO() };
  upsert('approvals', approvalId, updated);
  record(user, 'DENIED', a.planId, { approvalId });
  return updated;
}

export function listApprovals() {
  return dbList<Approval>('approvals').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

