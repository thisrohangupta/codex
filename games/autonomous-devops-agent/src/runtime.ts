import { DevOpsAgent, type DevOpsAgentDependencies } from './agent.js';
import { describeRuntimeConfig, readRuntimeConfig, type AgentRuntimeConfig, validateLiveConfig } from './config.js';
import { EventBus } from './event-bus.js';
import { ShellDeliveryExecutor } from './executor.js';
import {
  GitHubHttpApi,
  HarnessHttpApi,
  InMemoryHarnessApi,
  InMemoryJiraApi,
  InMemoryRepoApi,
  InMemoryServiceNowApi,
  JiraHttpApi,
  ServiceNowHttpApi,
} from './integrations.js';
import { createLlmProvider } from './llm.js';
import { hasValidToken, readOAuthTokenStore } from './oauth.js';
import type { AgentContext, WorkItem } from './types.js';

export interface AgentRuntime {
  readonly config: AgentRuntimeConfig;
  readonly agent: DevOpsAgent;
  readonly eventBus: EventBus;
  runFromJira(issueId: string, options?: RunOptions): Promise<AgentContext>;
  runFromPullRequest(repo: string, prNumber: string, options?: RunOptions): Promise<AgentContext>;
  describe(): string[];
}

export interface RunOptions {
  serviceNowRecordId?: string;
}

class DefaultAgentRuntime implements AgentRuntime {
  readonly agent: DevOpsAgent;

  constructor(
    readonly config: AgentRuntimeConfig,
    readonly eventBus: EventBus,
    private readonly deps: DevOpsAgentDependencies,
  ) {
    this.agent = new DevOpsAgent(deps);
  }

  async runFromJira(issueId: string, options?: RunOptions): Promise<AgentContext> {
    const workItem =
      this.config.mode === 'live'
        ? await this.deps.jira.fetchWorkItem(issueId)
        : this.createDryRunJiraItem(issueId);

    if (options?.serviceNowRecordId) {
      workItem.serviceNowRecordId = options.serviceNowRecordId;
    }

    return this.agent.run(workItem);
  }

  async runFromPullRequest(repo: string, prNumber: string, options?: RunOptions): Promise<AgentContext> {
    const workItem =
      this.config.mode === 'live'
        ? await this.deps.repo.fetchPullRequestWorkItem(repo, prNumber)
        : this.createDryRunPullRequestItem(repo, prNumber);

    if (options?.serviceNowRecordId) {
      workItem.serviceNowRecordId = options.serviceNowRecordId;
    }

    return this.agent.run(workItem);
  }

  describe(): string[] {
    return describeRuntimeConfig(this.config);
  }

  private createDryRunJiraItem(issueId: string): WorkItem {
    return {
      id: issueId,
      kind: 'jira',
      title: `[dry-run] Execute work for ${issueId}`,
      body: 'Simulated Jira issue body for local orchestration tests.',
      repo: this.config.defaultRepo,
      branch: this.config.defaultBranch,
      serviceNowRecordId: this.config.serviceNow.defaultRecordId,
    };
  }

  private createDryRunPullRequestItem(repo: string, prNumber: string): WorkItem {
    return {
      id: prNumber,
      kind: 'pull_request',
      title: `[dry-run] Execute work for ${repo}#${prNumber}`,
      body: 'Simulated pull request body for local orchestration tests.',
      repo,
      branch: `pr-${prNumber}`,
      serviceNowRecordId: this.config.serviceNow.defaultRecordId,
    };
  }
}

export function createAgentRuntime(
  config: AgentRuntimeConfig = readRuntimeConfig(),
): AgentRuntime {
  const effectiveConfig = resolveConfigWithOAuthTokens(config);
  const missing = validateLiveConfig(effectiveConfig);
  if (missing.length > 0) {
    throw new Error(`Live mode is missing required configuration: ${missing.join(', ')}`);
  }

  const eventBus = new EventBus();
  const executor = createExecutor(effectiveConfig);

  if (effectiveConfig.mode === 'live') {
    const serviceNow = hasServiceNowConfig(effectiveConfig)
      ? new ServiceNowHttpApi({
          baseUrl: effectiveConfig.serviceNow.baseUrl ?? '',
          username: effectiveConfig.serviceNow.username,
          password: effectiveConfig.serviceNow.password,
          bearerToken: effectiveConfig.serviceNow.bearerToken,
          table: effectiveConfig.serviceNow.table,
        })
      : undefined;

    const harness = hasHarnessConfig(effectiveConfig)
      ? new HarnessHttpApi({
          publishUrl: effectiveConfig.harness.publishUrl ?? '',
          deployUrl: effectiveConfig.harness.deployUrl ?? '',
          scanUrl: effectiveConfig.harness.scanUrl ?? '',
          apiKey: effectiveConfig.harness.apiKey ?? '',
        })
      : new InMemoryHarnessApi();

    const deps: DevOpsAgentDependencies = {
      jira: new JiraHttpApi({
        baseUrl: effectiveConfig.jira.baseUrl ?? '',
        email: effectiveConfig.jira.email,
        apiToken: effectiveConfig.jira.apiToken,
        bearerToken: effectiveConfig.jira.bearerToken,
        defaultRepo: effectiveConfig.defaultRepo,
        defaultBranch: effectiveConfig.defaultBranch,
        defaultServiceNowRecordId: effectiveConfig.serviceNow.defaultRecordId,
      }),
      repo: new GitHubHttpApi({
        baseUrl: effectiveConfig.github.baseUrl,
        token: effectiveConfig.github.token ?? '',
        defaultBaseBranch: effectiveConfig.github.defaultBaseBranch,
      }),
      harness,
      llm: createLlmProvider(effectiveConfig.llm),
      serviceNow,
      executor,
      eventBus,
    };

    return new DefaultAgentRuntime(effectiveConfig, eventBus, deps);
  }

  const seedIssue: WorkItem = {
    id: 'DEV-101',
    kind: 'jira',
    title: 'Add progressive delivery strategy',
    body: 'Implement canary and rollback support',
    repo: effectiveConfig.defaultRepo,
    branch: effectiveConfig.defaultBranch,
    serviceNowRecordId: effectiveConfig.serviceNow.defaultRecordId,
  };

  return new DefaultAgentRuntime(effectiveConfig, eventBus, {
    jira: new InMemoryJiraApi({ [seedIssue.id]: seedIssue }),
    repo: new InMemoryRepoApi(),
    harness: new InMemoryHarnessApi(),
    llm: createLlmProvider({ provider: 'oss' }),
    serviceNow: new InMemoryServiceNowApi(),
    executor,
    eventBus,
  });
}

function hasServiceNowConfig(config: AgentRuntimeConfig): boolean {
  if (!config.serviceNow.baseUrl) {
    return false;
  }

  const hasBearer = Boolean(config.serviceNow.bearerToken);
  const hasBasic = Boolean(config.serviceNow.username && config.serviceNow.password);
  return hasBearer || hasBasic;
}

function hasHarnessConfig(config: AgentRuntimeConfig): boolean {
  return Boolean(
    config.harness.apiKey &&
      config.harness.publishUrl &&
      config.harness.deployUrl &&
      config.harness.scanUrl,
  );
}

function createExecutor(config: AgentRuntimeConfig): ShellDeliveryExecutor | undefined {
  if (!config.execution.enabled) {
    return undefined;
  }

  return new ShellDeliveryExecutor({
    workdir: config.execution.workdir,
    buildCommand: config.execution.buildCommand,
    testCommand: config.execution.testCommand,
    deployDevCommand: config.execution.deployDevCommand,
    deployProdCommand: config.execution.deployProdCommand,
    validateDevCommand: config.execution.validateDevCommand,
    validateProdCommand: config.execution.validateProdCommand,
  });
}

function resolveConfigWithOAuthTokens(config: AgentRuntimeConfig): AgentRuntimeConfig {
  const store = readOAuthTokenStore(config);
  const merged: AgentRuntimeConfig = {
    ...config,
    jira: { ...config.jira },
    github: { ...config.github },
  };

  if (!merged.github.token && hasValidToken(store.github)) {
    merged.github.token = store.github?.accessToken;
  }

  if (!merged.jira.bearerToken && hasValidToken(store.jira)) {
    merged.jira.bearerToken = store.jira?.accessToken;
  }

  if (!merged.jira.baseUrl && store.jira?.siteUrl) {
    merged.jira.baseUrl = store.jira.siteUrl;
  }

  return merged;
}
