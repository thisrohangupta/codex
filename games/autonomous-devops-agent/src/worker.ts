import { FileApprovalStore } from './approvals.js';
import { MANUAL_APPROVAL_NOTE } from './policy.js';
import { readRuntimeConfig } from './config.js';
import { FileRunQueue } from './queue.js';
import { createAgentRuntime } from './runtime.js';
import type { AgentRuntime } from './runtime.js';
import type { RunQueueItem } from './queue.js';
import type { AgentContext } from './types.js';

async function main(): Promise<void> {
  let shouldStop = false;

  process.on('SIGINT', () => {
    shouldStop = true;
  });
  process.on('SIGTERM', () => {
    shouldStop = true;
  });

  const config = readRuntimeConfig();
  const queue = new FileRunQueue(config.queue.storePath);
  const approvals = new FileApprovalStore(config.policy.approvalStorePath);
  const runtimeState = initializeRuntime(config);
  const runtime = runtimeState.runtime;

  process.stdout.write(
    `Worker started. queue=${config.queue.storePath} poll=${config.queue.pollIntervalMs}ms maxAttempts=${config.queue.maxAttempts}\n`,
  );
  if (runtimeState.warning) {
    process.stdout.write(`warning=${runtimeState.warning}\n`);
  }

  while (!shouldStop) {
    const item = queue.claimNext();
    if (!item) {
      await sleep(config.queue.pollIntervalMs);
      continue;
    }

    process.stdout.write(
      `[queue] claimed id=${item.id} type=${item.type} attempts=${item.attempts}/${item.maxAttempts}\n`,
    );

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
        queue.markSucceeded(item.id, result);
        maybeCreateApproval(item, result, approvals);
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
        queue.markSucceeded(item.id, result);
        maybeCreateApproval(item, result, approvals);
      }

      process.stdout.write(`[queue] succeeded id=${item.id}\n`);
    } catch (error) {
      const message = formatError(error);
      const updated = queue.markFailed(item.id, message, {
        initialBackoffMs: config.queue.initialBackoffMs,
        maxBackoffMs: config.queue.maxBackoffMs,
      });

      process.stdout.write(
        `[queue] ${updated.status} id=${item.id} error=${message} nextAttemptAt=${updated.nextAttemptAt}\n`,
      );
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

function maybeCreateApproval(
  item: RunQueueItem,
  result: AgentContext,
  approvals: FileApprovalStore,
): void {
  if (item.approvalOverride) {
    return;
  }

  if (result.status !== 'needs_review') {
    return;
  }

  if (!result.reviewNotes.some((note: string) => note.includes(MANUAL_APPROVAL_NOTE))) {
    return;
  }

  const approval = approvals.createFromRun(item, result, MANUAL_APPROVAL_NOTE);
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
