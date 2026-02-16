import { readRuntimeConfig } from './config.js';
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
  const schedules = stores.schedules;

  process.stdout.write(
    `Scheduler started. driver=${config.storage.driver} schedules=${config.schedule.storePath} queue=${config.queue.storePath} poll=${config.schedule.pollIntervalMs}ms\n`,
  );

  while (!shouldStop) {
    const dueSchedules = await schedules.claimDue(new Date());

    for (const schedule of dueSchedules) {
      try {
        if (schedule.target.type === 'jira') {
          const issueId = schedule.target.issueId;
          if (!issueId) {
            throw new Error(`Schedule ${schedule.id} missing issueId`);
          }

          await queue.enqueueJira(issueId, {
            maxAttempts: schedule.target.maxAttempts ?? config.queue.maxAttempts,
            serviceNowRecordId: schedule.target.serviceNowRecordId,
          });
        } else {
          const repo = schedule.target.repo;
          const prNumber = schedule.target.prNumber;
          if (!repo || !prNumber) {
            throw new Error(`Schedule ${schedule.id} missing repo/prNumber`);
          }

          await queue.enqueuePullRequest(repo, prNumber, {
            maxAttempts: schedule.target.maxAttempts ?? config.queue.maxAttempts,
            serviceNowRecordId: schedule.target.serviceNowRecordId,
          });
        }

        process.stdout.write(
          `[schedule] triggered id=${schedule.id} name=${schedule.name} next=${schedule.nextRunAt}\n`,
        );
      } catch (error) {
        process.stdout.write(
          `[schedule] failed id=${schedule.id} name=${schedule.name} error=${formatError(error)}\n`,
        );
      }
    }

    await sleep(config.schedule.pollIntervalMs);
  }

  process.stdout.write('Scheduler stopped.\n');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return 'unknown error';
}

main().catch((error) => {
  process.stderr.write(`scheduler startup error: ${formatError(error)}\n`);
  process.exitCode = 1;
});
