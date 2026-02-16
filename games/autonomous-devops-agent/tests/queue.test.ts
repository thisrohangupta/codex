import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileRunQueue } from '../src/queue.js';
import { assertEqual, assertTrue } from './test-helpers.js';

export async function runQueueTests(): Promise<void> {
  testQueueLifecycle();
  testQueueFailureTerminalState();
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
