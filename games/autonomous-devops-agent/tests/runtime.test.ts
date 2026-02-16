import { createAgentRuntime } from '../src/runtime.js';
import { readRuntimeConfig, validateLiveConfig } from '../src/config.js';
import { assertEqual, assertTrue } from './test-helpers.js';

export async function runRuntimeTests(): Promise<void> {
  await testDryRunRuntime();
  testLiveValidation();
}

async function testDryRunRuntime(): Promise<void> {
  const runtime = createAgentRuntime(
    readRuntimeConfig({
      AGENT_MODE: 'dry-run',
      DEFAULT_REPO: 'acme/platform-service',
      DEFAULT_BRANCH: 'main',
    }),
  );

  const jiraRun = await runtime.runFromJira('DEV-777');
  assertTrue(jiraRun.runId.includes('jira-DEV-777'), 'jira run id should include issue id');

  const prRun = await runtime.runFromPullRequest('acme/platform-service', '88');
  assertTrue(
    prRun.runId.includes('pull_request-88'),
    'pull request run id should include pull request id',
  );

  assertTrue(runtime.eventBus.list().length > 0, 'runtime should emit events during runs');
}

function testLiveValidation(): void {
  const config = readRuntimeConfig({ AGENT_MODE: 'live' });
  const missing = validateLiveConfig(config);

  assertTrue(missing.length > 0, 'live mode should require integration configuration');
  assertEqual(missing.includes('JIRA_BASE_URL'), true, 'live mode should require Jira URL');
  assertEqual(missing.includes('GITHUB_TOKEN'), true, 'live mode should require GitHub token');
}
