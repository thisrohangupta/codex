import { EventBus } from '../src/event-bus.js';
import { InMemoryHarnessApi, InMemoryJiraApi, InMemoryRepoApi } from '../src/integrations.js';
import { createLlmProvider } from '../src/llm.js';
import { TaskGraph, type AgentTask } from '../src/tasks.js';
import type { AgentContext } from '../src/types.js';
import { assertEqual, assertRejects, assertTrue } from './test-helpers.js';

export async function runUtilityTests(): Promise<void> {
  await testLlmProviderSelection();
  await testEventBusFeatures();
  await testIntegrations();
  await testTaskGraph();
}

async function testLlmProviderSelection(): Promise<void> {
  const provider = createLlmProvider({ provider: 'openai', apiKey: 'key-123456', model: 'gpt-custom' });
  const generated = await provider.generateFeatureImplementation({
    id: '1',
    kind: 'jira',
    title: 'Title',
    body: 'Body',
    repo: 'acme/repo',
    branch: 'feature/test',
  });

  assertTrue(provider.name.includes('openai'), 'provider should include configured provider name');
  assertTrue(generated.includes('3456'), 'provider output should include api key suffix');

  const fallback = createLlmProvider({ provider: 'oss' });
  assertEqual(fallback.name, 'open-source-llm', 'OSS provider should be selected without API key');
}

async function testEventBusFeatures(): Promise<void> {
  const bus = new EventBus();
  const seen: string[] = [];
  const unsubscribe = bus.subscribe((event) => seen.push(event.type));

  bus.emit({
    type: 'task.started',
    runId: 'run-1',
    taskId: 'prepare',
    timestamp: new Date().toISOString(),
    details: {},
  });
  unsubscribe();
  bus.emit({
    type: 'task.completed',
    runId: 'run-1',
    taskId: 'prepare',
    timestamp: new Date().toISOString(),
    details: {},
  });

  assertEqual(seen.length, 1, 'unsubscribe should stop delivery to removed listeners');
  assertEqual(bus.list().length, 2, 'history should retain all emitted events');
}

async function testIntegrations(): Promise<void> {
  const jiraIssue = {
    id: 'DEV-100',
    kind: 'jira' as const,
    title: 'Feature',
    body: 'Details',
    repo: 'acme/repo',
    branch: 'feature/x',
  };

  const jira = new InMemoryJiraApi({ [jiraIssue.id]: jiraIssue });
  const fetched = await jira.fetchWorkItem('DEV-100');
  assertEqual(fetched.title, 'Feature', 'jira api should fetch existing issue');
  await assertRejects(jira.fetchWorkItem('DEV-404'), 'not found', 'jira api should reject unknown issue');

  const repo = new InMemoryRepoApi();
  const pr = await repo.openPullRequest('acme/repo', 'feature/x', 'Title', 'Body');
  assertEqual(pr, '1', 'repo api should allocate sequential PR IDs');
  await assertRejects(
    repo.openPullRequest('', 'feature/x', 'Title', 'Body'),
    'Missing pull request metadata',
    'repo api should validate pull request metadata',
  );

  const harness = new InMemoryHarnessApi();
  const artifact = await harness.publishArtifact('acme/repo', 'export const ready = true;');
  const dev = await harness.deploy('dev', artifact);
  const scan = await harness.scanImage(artifact);

  assertTrue(artifact.includes('registry.local'), 'artifact should use local registry naming scheme');
  assertEqual(dev.environment, 'dev', 'harness deploy should preserve target environment');
  assertTrue(scan.high >= 0, 'scan output should include numeric findings');
  await assertRejects(
    harness.publishArtifact('acme/repo', ''),
    'Cannot publish empty build output',
    'publishArtifact should reject empty outputs',
  );
}

async function testTaskGraph(): Promise<void> {
  const noOpTask: AgentTask = {
    id: 'noop',
    description: 'No operation',
    run: async (_context: AgentContext) => {
      return;
    },
  };

  const graph = new TaskGraph([noOpTask]);
  assertEqual(graph.size(), 1, 'task graph should track task count');
  assertEqual(graph.get('noop')?.description, 'No operation', 'task graph should retrieve task by id');

  await assertRejects(
    Promise.resolve().then(() => new TaskGraph([noOpTask, noOpTask])),
    'Duplicate task id',
    'task graph should reject duplicate task ids',
  );
}
