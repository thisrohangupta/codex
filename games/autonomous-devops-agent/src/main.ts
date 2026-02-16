import { DevOpsAgent } from './agent.js';
import { EventBus } from './event-bus.js';
import { InMemoryHarnessApi, InMemoryJiraApi, InMemoryRepoApi } from './integrations.js';
import { createLlmProvider } from './llm.js';
import type { WorkItem } from './types.js';

export * from './agent.js';
export * from './approvals.js';
export * from './chat.js';
export * from './config.js';
export * from './executor.js';
export * from './event-bus.js';
export * from './integrations.js';
export * from './llm.js';
export * from './oauth.js';
export * from './policy.js';
export * from './queue.js';
export * from './runtime.js';
export * from './schedule.js';
export * from './tasks.js';
export * from './types.js';

/**
 * Builds a fully wired autonomous DevOps agent suitable for local development/testing.
 */
export function createDefaultAgent(): DevOpsAgent {
  const seedIssue: WorkItem = {
    id: 'DEV-101',
    kind: 'jira',
    title: 'Add progressive delivery strategy',
    body: 'Implement canary and rollback support',
    repo: 'acme/platform-service',
    branch: 'feature/canary-rollout',
  };

  return new DevOpsAgent({
    jira: new InMemoryJiraApi({ [seedIssue.id]: seedIssue }),
    repo: new InMemoryRepoApi(),
    harness: new InMemoryHarnessApi(),
    llm: createLlmProvider({ provider: 'oss' }),
    eventBus: new EventBus(),
  });
}
