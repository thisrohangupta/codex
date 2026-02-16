import type { ApiKeyConfig } from './types.js';
import { parseDeploymentTargets, type DeploymentTarget } from './deployment-targets.js';
import type { DeploymentPolicyMode } from './policy.js';

export type RuntimeMode = 'dry-run' | 'live';

export interface JiraRuntimeConfig {
  baseUrl?: string;
  email?: string;
  apiToken?: string;
  bearerToken?: string;
}

export interface GitHubRuntimeConfig {
  baseUrl: string;
  token?: string;
  defaultBaseBranch: string;
}

export interface HarnessRuntimeConfig {
  publishUrl?: string;
  deployUrl?: string;
  scanUrl?: string;
  apiKey?: string;
}

export interface ServiceNowRuntimeConfig {
  baseUrl?: string;
  username?: string;
  password?: string;
  bearerToken?: string;
  table: string;
  defaultRecordId?: string;
}

export interface OAuthProviderRuntimeConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
  audience?: string;
}

export interface OAuthRuntimeConfig {
  tokenStorePath: string;
  github: OAuthProviderRuntimeConfig;
  jira: OAuthProviderRuntimeConfig;
}

export interface ExecutionRuntimeConfig {
  enabled: boolean;
  workdir: string;
  buildCommand: string;
  testCommand: string;
  deployDevCommand: string;
  deployProdCommand: string;
  validateDevCommand: string;
  validateProdCommand: string;
  cloneSourceEnabled: boolean;
  sourceRoot: string;
  sourceRepoUrl?: string;
  sourceRepoRef?: string;
  sourceRepoToken?: string;
  cloneDeploymentConfigEnabled: boolean;
  deploymentConfigRepoUrl?: string;
  deploymentConfigRepoRef?: string;
  deploymentConfigPath: string;
  binaryDownloadUrl?: string;
  binaryDownloadCommand?: string;
  binarySha256?: string;
  deploymentTargets: DeploymentTarget[];
  autoDetectTargets: boolean;
  preflightEnabled: boolean;
  preflightAuthChecks: boolean;
}

export interface QueueRuntimeConfig {
  storePath: string;
  pollIntervalMs: number;
  maxAttempts: number;
  initialBackoffMs: number;
  maxBackoffMs: number;
}

export interface PolicyRuntimeConfig {
  mode: DeploymentPolicyMode;
  approvalStorePath: string;
}

export interface ScheduleRuntimeConfig {
  storePath: string;
  pollIntervalMs: number;
}

export interface AgentRuntimeConfig {
  mode: RuntimeMode;
  defaultRepo: string;
  defaultBranch: string;
  jira: JiraRuntimeConfig;
  github: GitHubRuntimeConfig;
  harness: HarnessRuntimeConfig;
  serviceNow: ServiceNowRuntimeConfig;
  oauth: OAuthRuntimeConfig;
  execution: ExecutionRuntimeConfig;
  queue: QueueRuntimeConfig;
  policy: PolicyRuntimeConfig;
  schedule: ScheduleRuntimeConfig;
  llm: ApiKeyConfig;
}

export function readRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): AgentRuntimeConfig {
  const mode: RuntimeMode = env.AGENT_MODE === 'live' ? 'live' : 'dry-run';

  return {
    mode,
    defaultRepo: env.DEFAULT_REPO ?? 'acme/platform-service',
    defaultBranch: env.DEFAULT_BRANCH ?? 'main',
    jira: {
      baseUrl: env.JIRA_BASE_URL,
      email: env.JIRA_EMAIL,
      apiToken: env.JIRA_API_TOKEN,
      bearerToken: env.JIRA_BEARER_TOKEN,
    },
    github: {
      baseUrl: env.GITHUB_BASE_URL ?? 'https://api.github.com',
      token: env.GITHUB_TOKEN,
      defaultBaseBranch: env.GITHUB_BASE_BRANCH ?? 'main',
    },
    harness: {
      publishUrl: env.HARNESS_PUBLISH_URL,
      deployUrl: env.HARNESS_DEPLOY_URL,
      scanUrl: env.HARNESS_SCAN_URL,
      apiKey: env.HARNESS_API_KEY,
    },
    serviceNow: {
      baseUrl: env.SERVICENOW_BASE_URL,
      username: env.SERVICENOW_USERNAME,
      password: env.SERVICENOW_PASSWORD,
      bearerToken: env.SERVICENOW_BEARER_TOKEN,
      table: env.SERVICENOW_TABLE ?? 'incident',
      defaultRecordId: env.SERVICENOW_RECORD_ID,
    },
    oauth: {
      tokenStorePath: env.OAUTH_TOKEN_STORE_PATH ?? '.agent/oauth-tokens.json',
      github: {
        clientId: env.GITHUB_OAUTH_CLIENT_ID,
        clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
        redirectUri: env.GITHUB_OAUTH_REDIRECT_URI ?? 'http://localhost:8787/callback',
        scopes: parseScopes(env.GITHUB_OAUTH_SCOPES, ['repo', 'read:user']),
        authorizeUrl: env.GITHUB_OAUTH_AUTHORIZE_URL ?? 'https://github.com/login/oauth/authorize',
        tokenUrl: env.GITHUB_OAUTH_TOKEN_URL ?? 'https://github.com/login/oauth/access_token',
      },
      jira: {
        clientId: env.JIRA_OAUTH_CLIENT_ID,
        clientSecret: env.JIRA_OAUTH_CLIENT_SECRET,
        redirectUri: env.JIRA_OAUTH_REDIRECT_URI ?? 'http://localhost:8787/callback',
        scopes: parseScopes(env.JIRA_OAUTH_SCOPES, [
          'read:jira-work',
          'write:jira-work',
          'offline_access',
          'read:me',
        ]),
        authorizeUrl: env.JIRA_OAUTH_AUTHORIZE_URL ?? 'https://auth.atlassian.com/authorize',
        tokenUrl: env.JIRA_OAUTH_TOKEN_URL ?? 'https://auth.atlassian.com/oauth/token',
        audience: env.JIRA_OAUTH_AUDIENCE ?? 'api.atlassian.com',
      },
    },
    execution: {
      enabled: parseBoolean(env.EXECUTOR_ENABLED),
      workdir: env.EXECUTOR_WORKDIR ?? process.cwd(),
      buildCommand: env.BUILD_COMMAND ?? 'npm run build',
      testCommand: env.TEST_COMMAND ?? 'npm test',
      deployDevCommand: env.DEPLOY_DEV_COMMAND ?? 'kubectl apply -f k8s/',
      deployProdCommand:
        env.DEPLOY_PROD_COMMAND ?? 'kubectl apply -f k8s/',
      validateDevCommand:
        env.VALIDATE_DEV_COMMAND ??
        'kubectl rollout status deployment/${K8S_DEPLOYMENT:-app} -n ${K8S_DEV_NAMESPACE:-default} --timeout=180s',
      validateProdCommand:
        env.VALIDATE_PROD_COMMAND ??
        'kubectl rollout status deployment/${K8S_DEPLOYMENT:-app} -n ${K8S_PROD_NAMESPACE:-prod} --timeout=180s',
      cloneSourceEnabled: parseBoolean(env.EXECUTOR_CLONE_SOURCE),
      sourceRoot: env.EXECUTOR_SOURCE_ROOT ?? '.agent/workspaces',
      sourceRepoUrl: env.EXECUTOR_SOURCE_REPO_URL,
      sourceRepoRef: env.EXECUTOR_SOURCE_REPO_REF,
      sourceRepoToken: env.EXECUTOR_SOURCE_REPO_TOKEN ?? env.GITHUB_TOKEN,
      cloneDeploymentConfigEnabled: parseBoolean(env.EXECUTOR_CLONE_DEPLOY_CONFIG),
      deploymentConfigRepoUrl: env.EXECUTOR_DEPLOY_CONFIG_REPO_URL,
      deploymentConfigRepoRef: env.EXECUTOR_DEPLOY_CONFIG_REPO_REF,
      deploymentConfigPath: env.EXECUTOR_DEPLOY_CONFIG_PATH ?? '.',
      binaryDownloadUrl: env.EXECUTOR_BINARY_URL,
      binaryDownloadCommand: env.EXECUTOR_BINARY_DOWNLOAD_COMMAND,
      binarySha256: normalizeSha(env.EXECUTOR_BINARY_SHA256),
      deploymentTargets: parseDeploymentTargets(env.EXECUTOR_DEPLOYMENT_TARGETS_JSON),
      autoDetectTargets: parseBooleanWithFallback(env.EXECUTOR_AUTO_DETECT_TARGETS, true),
      preflightEnabled: parseBooleanWithFallback(env.EXECUTOR_PREFLIGHT_ENABLED, true),
      preflightAuthChecks: parseBooleanWithFallback(env.EXECUTOR_PREFLIGHT_AUTH_CHECKS, true),
    },
    queue: {
      storePath: env.QUEUE_STORE_PATH ?? '.agent/run-queue.json',
      pollIntervalMs: parseInteger(env.QUEUE_POLL_INTERVAL_MS, 2000),
      maxAttempts: parseInteger(env.QUEUE_MAX_ATTEMPTS, 3),
      initialBackoffMs: parseInteger(env.QUEUE_INITIAL_BACKOFF_MS, 2000),
      maxBackoffMs: parseInteger(env.QUEUE_MAX_BACKOFF_MS, 60000),
    },
    policy: {
      mode: asPolicyMode(env.DEPLOYMENT_POLICY_MODE),
      approvalStorePath: env.APPROVAL_STORE_PATH ?? '.agent/approvals.json',
    },
    schedule: {
      storePath: env.SCHEDULE_STORE_PATH ?? '.agent/schedules.json',
      pollIntervalMs: parseInteger(env.SCHEDULE_POLL_INTERVAL_MS, 30000),
    },
    llm: {
      provider: asProvider(env.LLM_PROVIDER),
      apiKey: env.LLM_API_KEY,
      model: env.LLM_MODEL,
    },
  };
}

export function validateLiveConfig(config: AgentRuntimeConfig): string[] {
  if (config.mode !== 'live') {
    return [];
  }

  const missing: string[] = [];

  if (!config.jira.baseUrl) {
    missing.push('JIRA_BASE_URL');
  }

  const hasJiraAuth = Boolean(config.jira.bearerToken) ||
    Boolean(config.jira.email && config.jira.apiToken);
  if (!hasJiraAuth) {
    missing.push('JIRA_BEARER_TOKEN or JIRA_EMAIL+JIRA_API_TOKEN');
  }

  if (!config.github.token) {
    missing.push('GITHUB_TOKEN');
  }

  if (!config.execution.enabled) {
    if (!config.harness.apiKey) {
      missing.push('HARNESS_API_KEY');
    }
    if (!config.harness.publishUrl) {
      missing.push('HARNESS_PUBLISH_URL');
    }
    if (!config.harness.deployUrl) {
      missing.push('HARNESS_DEPLOY_URL');
    }
    if (!config.harness.scanUrl) {
      missing.push('HARNESS_SCAN_URL');
    }
  }

  if (config.execution.enabled && !config.execution.workdir) {
    missing.push('EXECUTOR_WORKDIR');
  }

  return missing;
}

export function describeRuntimeConfig(config: AgentRuntimeConfig): string[] {
  const lines = [`mode=${config.mode}`];
  lines.push(`defaultRepo=${config.defaultRepo}`);
  lines.push(`defaultBranch=${config.defaultBranch}`);

  lines.push(`jira=${config.jira.baseUrl ? 'configured' : 'not configured'}`);
  lines.push(`github=${config.github.token ? 'configured' : 'not configured'}`);
  lines.push(`harness=${config.harness.apiKey ? 'configured' : 'not configured'}`);

  const hasServiceNowAuth = Boolean(config.serviceNow.bearerToken) ||
    Boolean(config.serviceNow.username && config.serviceNow.password);
  lines.push(
    `servicenow=${config.serviceNow.baseUrl && hasServiceNowAuth ? 'configured' : 'not configured'}`,
  );

  const hasGithubOAuth = Boolean(config.oauth.github.clientId && config.oauth.github.clientSecret);
  const hasJiraOAuth = Boolean(config.oauth.jira.clientId && config.oauth.jira.clientSecret);
  lines.push(`oauth.github=${hasGithubOAuth ? 'configured' : 'not configured'}`);
  lines.push(`oauth.jira=${hasJiraOAuth ? 'configured' : 'not configured'}`);
  lines.push(`executor=${config.execution.enabled ? `enabled (${config.execution.workdir})` : 'disabled'}`);
  lines.push(
    `executor.targets=${config.execution.deploymentTargets.length} configured, autoDetect=${config.execution.autoDetectTargets}`,
  );
  lines.push(`executor.cloneSource=${config.execution.cloneSourceEnabled ? 'enabled' : 'disabled'}`);
  lines.push(
    `executor.cloneDeployConfig=${config.execution.cloneDeploymentConfigEnabled ? 'enabled' : 'disabled'}`,
  );
  lines.push(
    `executor.binary=${config.execution.binaryDownloadUrl || config.execution.binaryDownloadCommand ? 'enabled' : 'disabled'}`,
  );
  lines.push(
    `executor.preflight=${config.execution.preflightEnabled ? 'enabled' : 'disabled'} (authChecks=${config.execution.preflightAuthChecks ? 'enabled' : 'disabled'})`,
  );
  lines.push(`queue=${config.queue.storePath} (poll=${config.queue.pollIntervalMs}ms)`);
  lines.push(`policy=${config.policy.mode} (approvals=${config.policy.approvalStorePath})`);
  lines.push(`schedule=${config.schedule.storePath} (poll=${config.schedule.pollIntervalMs}ms)`);

  lines.push(`llm=${config.llm.provider}${config.llm.model ? ` (${config.llm.model})` : ''}`);
  return lines;
}

function asProvider(value: string | undefined): ApiKeyConfig['provider'] {
  if (value === 'openai' || value === 'anthropic' || value === 'oss') {
    return value;
  }
  return 'oss';
}

function parseScopes(value: string | undefined, fallback: string[]): string[] {
  if (!value?.trim()) {
    return fallback;
  }

  return value
    .split(',')
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parseBooleanWithFallback(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return parseBoolean(value);
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function normalizeSha(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  return value.trim().toLowerCase();
}

function asPolicyMode(value: string | undefined): DeploymentPolicyMode {
  if (value === 'approval') {
    return 'approval';
  }
  return 'auto';
}
