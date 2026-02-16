import type { ApiKeyConfig } from './types.js';

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

export interface AgentRuntimeConfig {
  mode: RuntimeMode;
  defaultRepo: string;
  defaultBranch: string;
  jira: JiraRuntimeConfig;
  github: GitHubRuntimeConfig;
  harness: HarnessRuntimeConfig;
  serviceNow: ServiceNowRuntimeConfig;
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

  lines.push(`llm=${config.llm.provider}${config.llm.model ? ` (${config.llm.model})` : ''}`);
  return lines;
}

function asProvider(value: string | undefined): ApiKeyConfig['provider'] {
  if (value === 'openai' || value === 'anthropic' || value === 'oss') {
    return value;
  }
  return 'oss';
}
