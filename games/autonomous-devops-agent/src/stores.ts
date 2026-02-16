import type { AgentRuntimeConfig } from './config.js';
import { FileApprovalStore, PostgresApprovalStore, type ApprovalStoreApi } from './approvals.js';
import { FileRunQueue, PostgresRunQueue, type RunQueueApi } from './queue.js';
import { FileScheduleStore, PostgresScheduleStore, type ScheduleStoreApi } from './schedule.js';

export interface RuntimeStores {
  queue: RunQueueApi;
  approvals: ApprovalStoreApi;
  schedules: ScheduleStoreApi;
}

export function createRuntimeStores(config: AgentRuntimeConfig): RuntimeStores {
  if (config.storage.driver === 'postgres') {
    if (!config.storage.databaseUrl) {
      throw new Error('DATABASE_URL is required when DATASTORE_DRIVER=postgres');
    }

    return {
      queue: new PostgresRunQueue(config.storage.databaseUrl, config.storage.schema),
      approvals: new PostgresApprovalStore(config.storage.databaseUrl, config.storage.schema),
      schedules: new PostgresScheduleStore(config.storage.databaseUrl, config.storage.schema),
    };
  }

  return {
    queue: new FileRunQueue(config.queue.storePath),
    approvals: new FileApprovalStore(config.policy.approvalStorePath),
    schedules: new FileScheduleStore(config.schedule.storePath),
  };
}
