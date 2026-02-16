import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileApprovalStore } from '../src/approvals.js';
import type { AgentContext } from '../src/types.js';
import type { RunQueueItem } from '../src/queue.js';
import { assertEqual, assertTrue } from './test-helpers.js';

export async function runApprovalTests(): Promise<void> {
  testApprovalLifecycle();
}

function testApprovalLifecycle(): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-approval-'));
  const storePath = join(tempDir, 'approvals.json');
  const store = new FileApprovalStore(storePath);

  const queueItem: RunQueueItem = {
    id: 'q-1',
    type: 'jira',
    issueId: 'DEV-900',
    serviceNowRecordId: 'INC00900',
    status: 'succeeded',
    attempts: 1,
    maxAttempts: 3,
    nextAttemptAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const context: AgentContext = {
    runId: 'run-approval-1',
    workItem: {
      id: 'DEV-900',
      kind: 'jira',
      title: 'Title',
      body: 'Body',
      repo: 'acme/repo',
      branch: 'main',
    },
    status: 'needs_review',
    plan: [],
    deployments: [],
    reviewNotes: ['Manual approval required for production deployment'],
  };

  const created = store.createFromRun(queueItem, context, 'Manual approval required for production deployment');
  assertEqual(created.status, 'pending', 'new approval should be pending');

  const approved = store.markApproved(created.id, { approvedBy: 'architect', queuedRunId: 'q-2' });
  assertEqual(approved.status, 'approved', 'approval should transition to approved');
  assertEqual(approved.approvedBy, 'architect', 'approval should store approver');

  const listedApproved = store.list('approved');
  assertEqual(listedApproved.length, 1, 'approved filter should return updated approval');

  const second = store.createFromRun({ ...queueItem, id: 'q-3' }, { ...context, runId: 'run-approval-2' }, 'manual');
  const rejected = store.markRejected(second.id, { rejectedBy: 'architect', reason: 'not ready' });
  assertEqual(rejected.status, 'rejected', 'approval should transition to rejected');
  assertTrue(Boolean(rejected.rejectionReason), 'rejected approval should include reason');

  rmSync(tempDir, { recursive: true, force: true });
}
