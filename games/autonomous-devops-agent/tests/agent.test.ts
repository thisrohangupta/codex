import { DevOpsAgent } from '../src/agent.js';
import { EventBus } from '../src/event-bus.js';
import { InMemoryJiraApi, InMemoryRepoApi } from '../src/integrations.js';
import { createLlmProvider } from '../src/llm.js';
import type { DeploymentResult, HarnessApi, SecurityScanResult, WorkItem } from '../src/types.js';
import { assertEqual, assertRejects, assertTrue } from './test-helpers.js';

const workItem: WorkItem = {
  id: 'DEV-1',
  kind: 'jira',
  title: 'Implement feature flag support',
  body: 'Allow rollout by percentage',
  repo: 'acme/service',
  branch: 'feature/flag-rollout',
};

class StubHarnessApi implements HarnessApi {
  constructor(
    private readonly scanResult: SecurityScanResult,
    private readonly failPublish = false,
  ) {}

  async publishArtifact(repo: string, buildOutput: string): Promise<string> {
    if (this.failPublish) {
      throw new Error('publish failed');
    }
    return `registry/${repo.replace('/', '-')}:${buildOutput.length}`;
  }

  async deploy(environment: 'dev' | 'prod', artifact: string): Promise<DeploymentResult> {
    return {
      environment,
      releaseId: `${environment}-${artifact.length}`,
      deployedAt: '2024-01-01T00:00:00.000Z',
    };
  }

  async scanImage(): Promise<SecurityScanResult> {
    return this.scanResult;
  }
}

export async function runAgentTests(): Promise<void> {
  await testSuccessPath();
  await testReviewPath();
  await testFailurePath();
}

async function testSuccessPath(): Promise<void> {
  const bus = new EventBus();
  const agent = new DevOpsAgent({
    jira: new InMemoryJiraApi({ [workItem.id]: workItem }),
    repo: new InMemoryRepoApi(),
    harness: new StubHarnessApi({ critical: 0, high: 0, medium: 0, low: 0 }),
    llm: createLlmProvider({ provider: 'oss' }),
    eventBus: bus,
  });

  const result = await agent.run(workItem);
  assertEqual(result.status, 'succeeded', 'clean scan should allow prod deployment');
  assertEqual(result.deployments.length, 2, 'success path should deploy to dev and prod');
  assertTrue(Boolean(result.pullRequestId), 'jira work item should create a pull request');
  assertTrue(bus.list().some((event) => event.type === 'run.completed'), 'agent should emit completion event');
}

async function testReviewPath(): Promise<void> {
  const bus = new EventBus();
  const agent = new DevOpsAgent({
    jira: new InMemoryJiraApi({ [workItem.id]: workItem }),
    repo: new InMemoryRepoApi(),
    harness: new StubHarnessApi({ critical: 1, high: 1, medium: 0, low: 0 }),
    llm: createLlmProvider({ provider: 'oss' }),
    eventBus: bus,
  });

  const result = await agent.run(workItem);
  assertEqual(result.status, 'needs_review', 'findings should trigger human review state');
  assertEqual(result.deployments.length, 1, 'review path should stop before prod deployment');
  assertTrue(
    bus.list().some((event) => event.type === 'review.requested'),
    'review path should emit review.requested event',
  );
}

async function testFailurePath(): Promise<void> {
  const badProvider = {
    name: 'broken-provider',
    generateFeatureImplementation: async () => 'const x = 1;',
  };

  const brokenPublishAgent = new DevOpsAgent({
    jira: new InMemoryJiraApi({ [workItem.id]: workItem }),
    repo: new InMemoryRepoApi(),
    harness: new StubHarnessApi({ critical: 0, high: 0, medium: 0, low: 0 }, true),
    llm: createLlmProvider({ provider: 'oss' }),
    eventBus: new EventBus(),
  });

  await assertRejects(
    brokenPublishAgent.run(workItem),
    'publish failed',
    'publish failures should bubble with failure context',
  );

  const badGenerationAgent = new DevOpsAgent({
    jira: new InMemoryJiraApi({ [workItem.id]: workItem }),
    repo: new InMemoryRepoApi(),
    harness: new StubHarnessApi({ critical: 0, high: 0, medium: 0, low: 0 }),
    llm: badProvider,
    eventBus: new EventBus(),
  });

  await assertRejects(
    badGenerationAgent.run(workItem),
    'Generated code failed baseline tests',
    'baseline test gate should fail invalid generation output',
  );
}
