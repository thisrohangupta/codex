import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentRuntime } from '../src/runtime.js';
import { readRuntimeConfig, validateLiveConfig } from '../src/config.js';
import { assertEqual, assertTrue } from './test-helpers.js';

export async function runRuntimeTests(): Promise<void> {
  await testDryRunRuntime();
  testLiveValidation();
  testLiveRuntimeWithStoredOAuthTokens();
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

function testLiveRuntimeWithStoredOAuthTokens(): void {
  const tempDir = mkdtempSync(join(tmpdir(), 'agent-oauth-'));
  const tokenStorePath = join(tempDir, 'oauth-tokens.json');

  writeFileSync(
    tokenStorePath,
    JSON.stringify(
      {
        github: {
          accessToken: 'gho_example_token',
          obtainedAt: new Date().toISOString(),
        },
        jira: {
          accessToken: 'jira_example_token',
          obtainedAt: new Date().toISOString(),
          siteUrl: 'https://example.atlassian.net',
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const runtime = createAgentRuntime(
    readRuntimeConfig({
      AGENT_MODE: 'live',
      OAUTH_TOKEN_STORE_PATH: tokenStorePath,
      JIRA_BASE_URL: 'https://example.atlassian.net',
      EXECUTOR_ENABLED: 'true',
      EXECUTOR_WORKDIR: process.cwd(),
    }),
  );

  assertTrue(
    runtime.describe().some((line) => line === 'github=configured'),
    'runtime should hydrate GitHub token from OAuth token store',
  );
  assertTrue(
    runtime.describe().some((line) => line === 'jira=configured'),
    'runtime should hydrate Jira token from OAuth token store',
  );

  rmSync(tempDir, { recursive: true, force: true });
}
