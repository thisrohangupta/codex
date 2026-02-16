import { hostname } from 'node:os';
import { MANUAL_APPROVAL_NOTE } from './policy.js';
import { readRuntimeConfig } from './config.js';
import { createAgentRuntime } from './runtime.js';
import type { AgentRuntime } from './runtime.js';
import type { RunQueueItem } from './queue.js';
import type { AgentContext } from './types.js';
import type { ApprovalStoreApi } from './approvals.js';
import { createRuntimeStores } from './stores.js';

async function main(): Promise<void> {
  let shouldStop = false;

  process.on('SIGINT', () => {
    shouldStop = true;
  });
  process.on('SIGTERM', () => {
    shouldStop = true;
  });

  const config = readRuntimeConfig();
  const stores = createRuntimeStores(config);
  const queue = stores.queue;
  const approvals = stores.approvals;
  const runtimeState = initializeRuntime(config);
  const runtime = runtimeState.runtime;
  const workerId = process.env.QUEUE_WORKER_ID?.trim() || `${hostname()}-${process.pid}`;

  process.stdout.write(
    `Worker started. driver=${config.storage.driver} queue=${config.queue.storePath} poll=${config.queue.pollIntervalMs}ms maxAttempts=${config.queue.maxAttempts} workerId=${workerId}\n`,
  );
  if (runtimeState.warning) {
    process.stdout.write(`warning=${runtimeState.warning}\n`);
  }

  let lastReapAt = 0;

  while (!shouldStop) {
    const nowMs = Date.now();
    if (nowMs - lastReapAt >= config.queue.reapIntervalMs) {
      const reaped = await queue.reapExpiredRunning({
        now: new Date(nowMs),
        backoff: {
          initialBackoffMs: config.queue.initialBackoffMs,
          maxBackoffMs: config.queue.maxBackoffMs,
        },
      });
      for (const item of reaped) {
        process.stdout.write(
          `[queue] reaped id=${item.id} status=${item.status} reason=${item.lastError ?? item.cancellationReason ?? 'n/a'}\n`,
        );
      }
      lastReapAt = nowMs;
    }

    const item = await queue.claimNext({
      now: new Date(),
      workerId,
      leaseMs: config.queue.leaseMs,
      runTimeoutMs: config.queue.runTimeoutMs,
    });

    if (!item) {
      await sleep(config.queue.pollIntervalMs);
      continue;
    }

    process.stdout.write(
      `[queue] claimed id=${item.id} type=${item.type} attempts=${item.attempts}/${item.maxAttempts} leaseMs=${config.queue.leaseMs} timeoutMs=${config.queue.runTimeoutMs}\n`,
    );

    const heartbeat = setInterval(() => {
      void Promise.resolve(queue.heartbeat(item.id, workerId, config.queue.leaseMs)).catch((error: unknown) => {
        process.stderr.write(`[queue] heartbeat failed id=${item.id} error=${formatError(error)}\n`);
      });
    }, config.queue.heartbeatIntervalMs);
    heartbeat.unref();

    try {
      if (item.type === 'jira') {
        const issueId = item.issueId;
        if (!issueId) {
          throw new Error(`Queue item ${item.id} is missing issueId`);
        }

        const result = await runtime.runFromJira(issueId, {
          serviceNowRecordId: item.serviceNowRecordId,
          approvalOverride: item.approvalOverride,
          approvalRequestId: item.approvalRequestId,
        });
        await queue.markSucceeded(item.id, result);
        await maybeCreateApproval(item, result, approvals);
      } else {
        const repo = item.repo;
        const prNumber = item.prNumber;
        if (!repo || !prNumber) {
          throw new Error(`Queue item ${item.id} is missing repo/prNumber`);
        }

        const result = await runtime.runFromPullRequest(repo, prNumber, {
          serviceNowRecordId: item.serviceNowRecordId,
          approvalOverride: item.approvalOverride,
          approvalRequestId: item.approvalRequestId,
        });
        await queue.markSucceeded(item.id, result);
        await maybeCreateApproval(item, result, approvals);
      }

      process.stdout.write(`[queue] succeeded id=${item.id}\n`);
    } catch (error) {
      const message = formatError(error);
      const updated = await queue.markFailed(item.id, message, {
        initialBackoffMs: config.queue.initialBackoffMs,
        maxBackoffMs: config.queue.maxBackoffMs,
      });

      process.stdout.write(
        `[queue] ${updated.status} id=${item.id} error=${message} nextAttemptAt=${updated.nextAttemptAt}\n`,
      );
    } finally {
      clearInterval(heartbeat);
    }
  }

  process.stdout.write('Worker stopped.\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function initializeRuntime(config: ReturnType<typeof readRuntimeConfig>): { runtime: AgentRuntime; warning?: string } {
  try {
    return { runtime: createAgentRuntime(config) };
  } catch (error) {
    const message = formatError(error);
    return {
      runtime: createAgentRuntime({ ...config, mode: 'dry-run' }),
      warning: `Live runtime unavailable: ${message}. Running in dry-run mode until configuration is complete.`,
    };
  }
}

async function maybeCreateApproval(
  item: RunQueueItem,
  result: AgentContext,
  approvals: ApprovalStoreApi,
): Promise<void> {
  if (item.approvalOverride) {
    return;
  }

  if (result.status !== 'needs_review') {
    return;
  }

  if (!result.reviewNotes.some((note: string) => note.includes(MANUAL_APPROVAL_NOTE))) {
    return;
  }

  const approval = await approvals.createFromRun(item, result, MANUAL_APPROVAL_NOTE);
  process.stdout.write(`[approval] pending id=${approval.id} runId=${approval.runId}\n`);
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'unknown error';
}

main().catch((error) => {
  process.stderr.write(`worker startup error: ${formatError(error)}\n`);
  process.exitCode = 1;
});
