import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileScheduleStore, nextRunAfter } from '../src/schedule.js';
import { assertEqual, assertTrue } from './test-helpers.js';

export async function runScheduleTests(): Promise<void> {
  testNextRunComputation();
  testScheduleStoreLifecycle();
}

function testNextRunComputation(): void {
  const from = new Date('2026-02-16T10:03:45.000Z');
  const next = nextRunAfter('*/5 * * * *', from);
  assertEqual(next.toISOString(), '2026-02-16T10:05:00.000Z', '5-minute cron should align to next interval');

  const nextHour = nextRunAfter('0 * * * *', from);
  assertEqual(nextHour.toISOString(), '2026-02-16T11:00:00.000Z', 'hourly cron should schedule next hour');
}

function testScheduleStoreLifecycle(): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-schedule-'));
  const storePath = join(tempDir, 'schedules.json');
  const store = new FileScheduleStore(storePath);

  const created = store.create({
    name: 'nightly jira sync',
    cron: '*/10 * * * *',
    target: {
      type: 'jira',
      issueId: 'DEV-321',
      serviceNowRecordId: 'INC00321',
      maxAttempts: 2,
    },
  });

  assertEqual(store.list().length, 1, 'schedule should be persisted');
  assertEqual(created.target.issueId, 'DEV-321', 'jira issue id should be retained');

  const due = store.claimDue(new Date(new Date(created.nextRunAt).getTime() + 1000));
  assertEqual(due.length, 1, 'due schedule should be claimable');
  assertTrue(Boolean(due[0].lastRunAt), 'due schedule should record lastRunAt');

  const updated = store.update(created.id, { enabled: false });
  assertEqual(updated.enabled, false, 'schedule update should modify enabled state');

  const deleted = store.delete(created.id);
  assertEqual(deleted, true, 'schedule should be deletable');

  rmSync(tempDir, { recursive: true, force: true });
}
