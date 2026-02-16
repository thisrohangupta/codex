import { DevOpsAgent, type DevOpsAgentDependencies } from './agent.js';
import { describeRuntimeConfig, readRuntimeConfig, type AgentRuntimeConfig, validateLiveConfig } from './config.js';
import { EventBus } from './event-bus.js';
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
  const missing = validateLiveConfig(config);
  if (missing.length > 0) {
    throw new Error(`Live mode is missing required configuration: ${missing.join(', ')}`);
  }

  const eventBus = new EventBus();

  if (config.mode === 'live') {
    const serviceNow = hasServiceNowConfig(config)
      ? new ServiceNowHttpApi({
          baseUrl: config.serviceNow.baseUrl ?? '',
          username: config.serviceNow.username,
          password: config.serviceNow.password,
          bearerToken: config.serviceNow.bearerToken,
          table: config.serviceNow.table,
        })
      : undefined;

    const deps: DevOpsAgentDependencies = {
      jira: new JiraHttpApi({
        baseUrl: config.jira.baseUrl ?? '',
        email: config.jira.email,
        apiToken: config.jira.apiToken,
        bearerToken: config.jira.bearerToken,
        defaultRepo: config.defaultRepo,
        defaultBranch: config.defaultBranch,
        defaultServiceNowRecordId: config.serviceNow.defaultRecordId,
      }),
      repo: new GitHubHttpApi({
        baseUrl: config.github.baseUrl,
        token: config.github.token ?? '',
        defaultBaseBranch: config.github.defaultBaseBranch,
      }),
      harness: new HarnessHttpApi({
        publishUrl: config.harness.publishUrl ?? '',
        deployUrl: config.harness.deployUrl ?? '',
        scanUrl: config.harness.scanUrl ?? '',
        apiKey: config.harness.apiKey ?? '',
      }),
      llm: createLlmProvider(config.llm),
      serviceNow,
      eventBus,
    };

    return new DefaultAgentRuntime(config, eventBus, deps);
  }

  const seedIssue: WorkItem = {
    id: 'DEV-101',
    kind: 'jira',
    title: 'Add progressive delivery strategy',
    body: 'Implement canary and rollback support',
    repo: config.defaultRepo,
    branch: config.defaultBranch,
    serviceNowRecordId: config.serviceNow.defaultRecordId,
  };

  return new DefaultAgentRuntime(config, eventBus, {
    jira: new InMemoryJiraApi({ [seedIssue.id]: seedIssue }),
    repo: new InMemoryRepoApi(),
    harness: new InMemoryHarnessApi(),
    llm: createLlmProvider({ provider: 'oss' }),
    serviceNow: new InMemoryServiceNowApi(),
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
