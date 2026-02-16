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
import { createDeploymentPolicy } from './policy.js';
import type { AgentContext, TargetProbeResult, WorkItem } from './types.js';

export interface AgentRuntime {
  readonly config: AgentRuntimeConfig;
  readonly agent: DevOpsAgent;
  readonly eventBus: EventBus;
  runFromJira(issueId: string, options?: RunOptions): Promise<AgentContext>;
  runFromPullRequest(repo: string, prNumber: string, options?: RunOptions): Promise<AgentContext>;
  probeTargetsFromJira(issueId: string, options?: RunOptions): Promise<TargetProbeResult>;
  probeTargetsFromPullRequest(repo: string, prNumber: string, options?: RunOptions): Promise<TargetProbeResult>;
  describe(): string[];
}

export interface RunOptions {
  serviceNowRecordId?: string;
  approvalOverride?: boolean;
  approvalRequestId?: string;
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

    this.applyRunOptions(workItem, options);

    return this.agent.run(workItem);
  }

  async runFromPullRequest(repo: string, prNumber: string, options?: RunOptions): Promise<AgentContext> {
    const workItem =
      this.config.mode === 'live'
        ? await this.deps.repo.fetchPullRequestWorkItem(repo, prNumber)
        : this.createDryRunPullRequestItem(repo, prNumber);

    this.applyRunOptions(workItem, options);

    return this.agent.run(workItem);
  }

  async probeTargetsFromJira(issueId: string, options?: RunOptions): Promise<TargetProbeResult> {
    const workItem =
      this.config.mode === 'live'
        ? await this.deps.jira.fetchWorkItem(issueId)
        : this.createDryRunJiraItem(issueId);

    this.applyRunOptions(workItem, options);
    return this.probeTargetsForWorkItem(workItem);
  }

  async probeTargetsFromPullRequest(
    repo: string,
    prNumber: string,
    options?: RunOptions,
  ): Promise<TargetProbeResult> {
    const workItem =
      this.config.mode === 'live'
        ? await this.deps.repo.fetchPullRequestWorkItem(repo, prNumber)
        : this.createDryRunPullRequestItem(repo, prNumber);

    this.applyRunOptions(workItem, options);
    return this.probeTargetsForWorkItem(workItem);
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

  private applyRunOptions(workItem: WorkItem, options?: RunOptions): void {
    if (!options) {
      return;
    }

    if (options.serviceNowRecordId) {
      workItem.serviceNowRecordId = options.serviceNowRecordId;
    }

    if (options.approvalOverride || options.approvalRequestId) {
      workItem.metadata = {
        ...(workItem.metadata ?? {}),
        ...(options.approvalOverride ? { approvalOverride: 'true' } : {}),
        ...(options.approvalRequestId ? { approvalRequestId: options.approvalRequestId } : {}),
      };
    }
  }

  private async probeTargetsForWorkItem(workItem: WorkItem): Promise<TargetProbeResult> {
    const executor = this.deps.executor;
    if (!executor) {
      throw new Error('Executor is disabled. Set EXECUTOR_ENABLED=true to use target probe.');
    }

    const context: AgentContext = {
      runId: `probe-${workItem.kind}-${workItem.id}-${Date.now()}`,
      workItem,
      status: 'pending',
      plan: [],
      deployments: [],
      reviewNotes: [],
    };

    if (executor.prepareWorkspace) {
      context.workspacePreparationReport = await executor.prepareWorkspace(context);
    }

    if (executor.probeTargets) {
      return executor.probeTargets(context);
    }

    return {
      runId: context.runId,
      workItem: context.workItem,
      workspacePath: context.workspacePath,
      deploymentConfigPath: context.deploymentConfigPath,
      binaryPath: context.binaryPath,
      workspacePreparationReport: context.workspacePreparationReport,
      preflightReport: context.preflightReport,
      environments: [
        {
          environment: 'dev',
          source: 'legacy',
          targets: [
            {
              name: 'legacy-dev',
              type: 'legacy',
              source: 'legacy',
              deployCommand: this.config.execution.deployDevCommand,
              validateCommand: this.config.execution.validateDevCommand,
            },
          ],
        },
        {
          environment: 'prod',
          source: 'legacy',
          targets: [
            {
              name: 'legacy-prod',
              type: 'legacy',
              source: 'legacy',
              deployCommand: this.config.execution.deployProdCommand,
              validateCommand: this.config.execution.validateProdCommand,
            },
          ],
        },
      ],
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
  const deploymentPolicy = createDeploymentPolicy(effectiveConfig.policy.mode);

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
      deploymentPolicy,
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
    deploymentPolicy,
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
    cloneSourceEnabled: config.execution.cloneSourceEnabled,
    sourceRoot: config.execution.sourceRoot,
    sourceRepoUrl: config.execution.sourceRepoUrl,
    sourceRepoRef: config.execution.sourceRepoRef,
    sourceRepoToken: config.execution.sourceRepoToken,
    cloneDeploymentConfigEnabled: config.execution.cloneDeploymentConfigEnabled,
    deploymentConfigRepoUrl: config.execution.deploymentConfigRepoUrl,
    deploymentConfigRepoRef: config.execution.deploymentConfigRepoRef,
    deploymentConfigPath: config.execution.deploymentConfigPath,
    binaryDownloadUrl: config.execution.binaryDownloadUrl,
    binaryDownloadCommand: config.execution.binaryDownloadCommand,
    binarySha256: config.execution.binarySha256,
    deploymentTargets: config.execution.deploymentTargets,
    autoDetectTargets: config.execution.autoDetectTargets,
    preflightEnabled: config.execution.preflightEnabled,
    preflightAuthChecks: config.execution.preflightAuthChecks,
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
