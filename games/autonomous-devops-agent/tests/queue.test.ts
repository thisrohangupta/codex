import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileRunQueue } from '../src/queue.js';
import { assertEqual, assertTrue } from './test-helpers.js';

export async function runQueueTests(): Promise<void> {
  testQueueLifecycle();
  testQueueFailureTerminalState();
  testQueueCancelRetryTimeoutControls();
  testQueueReaperLeaseExpiry();
}

function testQueueLifecycle(): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-queue-'));
  const queuePath = join(tempDir, 'run-queue.json');
  const queue = new FileRunQueue(queuePath);

  const queued = queue.enqueueJira('DEV-500', {
    maxAttempts: 2,
    serviceNowRecordId: 'INC0015000',
  });

  assertEqual(queued.status, 'queued', 'new queue item should be queued');
  assertEqual(queue.list().length, 1, 'queue should contain one item');

  const claimed = queue.claimNext(new Date(queued.nextAttemptAt));
  assertTrue(Boolean(claimed), 'claimNext should return queued item');
  assertEqual(claimed?.status, 'running', 'claimed queue item should be running');
  assertEqual(claimed?.attempts, 1, 'claim should increment attempt count');

  const retryable = queue.markFailed(queued.id, 'transient failure', {
    initialBackoffMs: 10,
    maxBackoffMs: 100,
  });
  assertEqual(retryable.status, 'retryable', 'first failure should be retryable');

  const reclaimed = queue.claimNext(new Date(Date.now() + 1000));
  assertTrue(Boolean(reclaimed), 'retryable item should be claimable after backoff');
  assertEqual(reclaimed?.attempts, 2, 'second claim should increment attempts');

  const succeeded = queue.markSucceeded(queued.id, {
    runId: 'run-1',
    workItem: {
      id: 'DEV-500',
      kind: 'jira',
      title: 'Title',
      body: 'Body',
      repo: 'acme/repo',
      branch: 'main',
    },
    status: 'succeeded',
    plan: [],
    deployments: [],
    reviewNotes: [],
  });

  assertEqual(succeeded.status, 'succeeded', 'markSucceeded should mark terminal status');
  assertEqual(succeeded.runId, 'run-1', 'markSucceeded should attach run id');

  rmSync(tempDir, { recursive: true, force: true });
}

function testQueueFailureTerminalState(): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-queue-fail-'));
  const queuePath = join(tempDir, 'run-queue.json');
  const queue = new FileRunQueue(queuePath);

  const queued = queue.enqueuePullRequest('acme/repo', '12', {
    maxAttempts: 1,
  });

  const claimed = queue.claimNext(new Date(queued.nextAttemptAt));
  assertTrue(Boolean(claimed), 'queue item should be claimable');

  const failed = queue.markFailed(queued.id, 'permanent failure', {
    initialBackoffMs: 10,
    maxBackoffMs: 100,
  });
  assertEqual(failed.status, 'failed', 'max-attempt breach should mark failed');

  const none = queue.claimNext(new Date(Date.now() + 5000));
  assertEqual(none, undefined, 'failed item should not be reclaimed');

  rmSync(tempDir, { recursive: true, force: true });
}

function testQueueCancelRetryTimeoutControls(): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-queue-controls-'));
  const queuePath = join(tempDir, 'run-queue.json');
  const queue = new FileRunQueue(queuePath);

  const queued = queue.enqueueJira('DEV-501', {
    maxAttempts: 3,
  });

  const canceled = queue.cancel(queued.id, 'manual stop');
  assertEqual(canceled.status, 'canceled', 'cancel should move item to canceled state');
  assertEqual(canceled.cancellationReason, 'manual stop', 'cancel should persist reason');

  const retried = queue.retry(queued.id);
  assertEqual(retried.status, 'queued', 'retry should move item back to queued');
  assertEqual(retried.attempts, 0, 'retry should reset attempts');

  const claimed = queue.claimNext({
    now: new Date(),
    workerId: 'worker-a',
    leaseMs: 1000,
    runTimeoutMs: 1000,
  });
  assertTrue(Boolean(claimed), 'retried item should be claimable');

  const timedOut = queue.forceTimeout(queued.id, 'force timeout', {
    initialBackoffMs: 10,
    maxBackoffMs: 100,
  });
  assertEqual(timedOut.status, 'retryable', 'forced timeout should follow retry policy when attempts remain');

  rmSync(tempDir, { recursive: true, force: true });
}

function testQueueReaperLeaseExpiry(): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-queue-reaper-'));
  const queuePath = join(tempDir, 'run-queue.json');
  const queue = new FileRunQueue(queuePath);

  const queued = queue.enqueuePullRequest('acme/repo', '99', {
    maxAttempts: 2,
  });

  const claimTime = new Date(Date.now() + 1000);
  queue.claimNext({
    now: claimTime,
    workerId: 'worker-b',
    leaseMs: 1,
    runTimeoutMs: 0,
  });

  const reaped = queue.reapExpiredRunning({
    now: new Date(claimTime.getTime() + 1000),
    backoff: {
      initialBackoffMs: 10,
      maxBackoffMs: 100,
    },
  });

  assertEqual(reaped.length, 1, 'reaper should reclaim expired running item');
  assertEqual(reaped[0].status, 'retryable', 'reaped item should become retryable when attempts remain');

  rmSync(tempDir, { recursive: true, force: true });
}
