import type {
  DeploymentResult,
  HarnessApi,
  JiraApi,
  RepoApi,
  SecurityScanResult,
  ServiceNowApi,
  WorkItem,
} from './types.js';

export class InMemoryJiraApi implements JiraApi {
  constructor(private readonly issues: Record<string, WorkItem>) {}

  async fetchWorkItem(issueId: string): Promise<WorkItem> {
    const issue = this.issues[issueId];
    if (!issue) {
      throw new Error(`Issue ${issueId} not found`);
    }
    return issue;
  }

  async comment(): Promise<void> {
    // no-op in in-memory implementation
  }
}

export class InMemoryRepoApi implements RepoApi {
  private nextPrNumber = 1;

  async fetchPullRequestWorkItem(repo: string, prNumber: string): Promise<WorkItem> {
    if (!repo || !prNumber) {
      throw new Error('Repository and pull request number are required');
    }
    return {
      id: prNumber,
      kind: 'pull_request',
      title: `Work from pull request #${prNumber}`,
      body: `Automatically generated work item for ${repo}#${prNumber}`,
      repo,
      branch: `pr-${prNumber}`,
    };
  }

  async openPullRequest(repo: string, branch: string, title: string, body: string): Promise<string> {
    if (!repo || !branch || !title || !body) {
      throw new Error('Missing pull request metadata');
    }
    const value = String(this.nextPrNumber);
    this.nextPrNumber += 1;
    return value;
  }

  async postPullRequestComment(): Promise<void> {
    // no-op in in-memory implementation
  }
}

export class InMemoryHarnessApi implements HarnessApi {
  constructor(
    private readonly scanResult: SecurityScanResult = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
  ) {}

  async publishArtifact(repo: string, buildOutput: string): Promise<string> {
    if (!buildOutput) {
      throw new Error('Cannot publish empty build output');
    }
    return `registry.local/${repo.replace('/', '-')}:sha-${buildOutput.length}`;
  }

  async deploy(environment: 'dev' | 'prod', artifact: string): Promise<DeploymentResult> {
    if (!artifact) {
      throw new Error('Artifact is required');
    }
    return {
      environment,
      releaseId: `${environment}-${Math.abs(hashCode(artifact)).toString(16)}`,
      deployedAt: new Date().toISOString(),
    };
  }

  async scanImage(_artifact: string): Promise<SecurityScanResult> {
    return { ...this.scanResult };
  }
}

export class InMemoryServiceNowApi implements ServiceNowApi {
  readonly notes = new Map<string, string[]>();

  async appendWorkNote(recordId: string, message: string): Promise<void> {
    const values = this.notes.get(recordId) ?? [];
    values.push(message);
    this.notes.set(recordId, values);
  }
}

export interface JiraHttpConfig {
  baseUrl: string;
  email?: string;
  apiToken?: string;
  bearerToken?: string;
  defaultRepo: string;
  defaultBranch: string;
  defaultServiceNowRecordId?: string;
}

export class JiraHttpApi implements JiraApi {
  constructor(private readonly config: JiraHttpConfig) {}

  async fetchWorkItem(issueId: string): Promise<WorkItem> {
    const response = await requestJson<{ fields?: Record<string, unknown> }>(
      `${this.config.baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${encodeURIComponent(issueId)}`,
      {
        method: 'GET',
        headers: this.createHeaders(),
      },
    );

    const fields = response.fields ?? {};
    const summary = asString(fields.summary) ?? issueId;
    const description = extractJiraDescription(fields.description);
    const repo = extractTaggedValue(description, 'repo') ?? this.config.defaultRepo;
    const branch = extractTaggedValue(description, 'branch') ?? this.config.defaultBranch;
    const serviceNowRecordId =
      extractTaggedValue(description, 'snow') ?? this.config.defaultServiceNowRecordId;

    return {
      id: issueId,
      kind: 'jira',
      title: summary,
      body: description || summary,
      repo,
      branch,
      serviceNowRecordId,
    };
  }

  async comment(issueId: string, message: string): Promise<void> {
    await requestJson(
      `${this.config.baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${encodeURIComponent(issueId)}/comment`,
      {
        method: 'POST',
        headers: this.createHeaders(),
        body: JSON.stringify({
          body: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: message }],
              },
            ],
          },
        }),
      },
    );
  }

  private createHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: createAuthorizationHeader({
        email: this.config.email,
        apiToken: this.config.apiToken,
        bearerToken: this.config.bearerToken,
      }),
    };
  }
}

export interface GitHubHttpConfig {
  baseUrl: string;
  token: string;
  defaultBaseBranch: string;
}

export class GitHubHttpApi implements RepoApi {
  constructor(private readonly config: GitHubHttpConfig) {}

  async fetchPullRequestWorkItem(repo: string, prNumber: string): Promise<WorkItem> {
    const [owner, name] = splitRepo(repo);
    const payload = await requestJson<Record<string, unknown>>(
      `${this.config.baseUrl.replace(/\/$/, '')}/repos/${owner}/${name}/pulls/${encodeURIComponent(prNumber)}`,
      {
        method: 'GET',
        headers: this.createHeaders(),
      },
    );

    const title = asString(payload.title) ?? `Pull request ${prNumber}`;
    const body = asString(payload.body) ?? '';
    const head = asRecord(payload.head);
    const ref = asString(head?.ref) ?? `pr-${prNumber}`;

    return {
      id: prNumber,
      kind: 'pull_request',
      title,
      body,
      repo,
      branch: ref,
    };
  }

  async openPullRequest(repo: string, branch: string, title: string, body: string): Promise<string> {
    const [owner, name] = splitRepo(repo);
    const payload = await requestJson<Record<string, unknown>>(
      `${this.config.baseUrl.replace(/\/$/, '')}/repos/${owner}/${name}/pulls`,
      {
        method: 'POST',
        headers: this.createHeaders(),
        body: JSON.stringify({
          title,
          body,
          head: branch,
          base: this.config.defaultBaseBranch,
        }),
      },
    );

    const number = asNumber(payload.number);
    if (number === undefined) {
      throw new Error('GitHub did not return a pull request number');
    }
    return String(number);
  }

  async postPullRequestComment(repo: string, prNumber: string, message: string): Promise<void> {
    const [owner, name] = splitRepo(repo);
    await requestJson(
      `${this.config.baseUrl.replace(/\/$/, '')}/repos/${owner}/${name}/issues/${encodeURIComponent(prNumber)}/comments`,
      {
        method: 'POST',
        headers: this.createHeaders(),
        body: JSON.stringify({ body: message }),
      },
    );
  }

  private createHeaders(): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }
}

export interface HarnessHttpConfig {
  publishUrl: string;
  deployUrl: string;
  scanUrl: string;
  apiKey: string;
}

export class HarnessHttpApi implements HarnessApi {
  constructor(private readonly config: HarnessHttpConfig) {}

  async publishArtifact(repo: string, buildOutput: string): Promise<string> {
    const payload = await this.post(this.config.publishUrl, {
      repo,
      buildOutput,
      action: 'publish',
    });

    const artifact = asString(payload.artifact);
    if (artifact) {
      return artifact;
    }

    const executionId = extractExecutionId(payload);
    return `harness://artifact/${repo.replace('/', '-')}/${executionId}`;
  }

  async deploy(environment: 'dev' | 'prod', artifact: string): Promise<DeploymentResult> {
    const payload = await this.post(this.config.deployUrl, {
      artifact,
      environment,
      action: 'deploy',
    });

    return {
      environment,
      releaseId: extractExecutionId(payload),
      deployedAt: new Date().toISOString(),
    };
  }

  async scanImage(artifact: string): Promise<SecurityScanResult> {
    const payload = await this.post(this.config.scanUrl, {
      artifact,
      action: 'scan',
    });

    const findings = asRecord(payload.findings) ?? payload;
    return {
      critical: asNumber(findings.critical) ?? 0,
      high: asNumber(findings.high) ?? 0,
      medium: asNumber(findings.medium) ?? 0,
      low: asNumber(findings.low) ?? 0,
    };
  }

  private async post(url: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await requestJson<Record<string, unknown>>(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
      },
      body: JSON.stringify(payload),
    });

    return response;
  }
}

export interface ServiceNowHttpConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  bearerToken?: string;
  table: string;
}

export class ServiceNowHttpApi implements ServiceNowApi {
  constructor(private readonly config: ServiceNowHttpConfig) {}

  async appendWorkNote(recordId: string, message: string): Promise<void> {
    const sysId = await this.resolveSysId(recordId);
    await requestJson(
      `${this.config.baseUrl.replace(/\/$/, '')}/api/now/table/${encodeURIComponent(this.config.table)}/${encodeURIComponent(sysId)}`,
      {
        method: 'PATCH',
        headers: this.createHeaders(),
        body: JSON.stringify({ work_notes: message }),
      },
    );
  }

  private async resolveSysId(recordId: string): Promise<string> {
    if (/^[a-f0-9]{32}$/i.test(recordId)) {
      return recordId;
    }

    const result = await requestJson<{ result?: Array<Record<string, unknown>> }>(
      `${this.config.baseUrl.replace(/\/$/, '')}/api/now/table/${encodeURIComponent(this.config.table)}?sysparm_query=number=${encodeURIComponent(recordId)}&sysparm_fields=sys_id,number&sysparm_limit=1`,
      {
        method: 'GET',
        headers: this.createHeaders(),
      },
    );

    const first = result.result?.[0];
    const sysId = asString(first?.sys_id);
    if (!sysId) {
      throw new Error(`ServiceNow record ${recordId} not found in table ${this.config.table}`);
    }
    return sysId;
  }

  private createHeaders(): Record<string, string> {
    return {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: createAuthorizationHeader({
        bearerToken: this.config.bearerToken,
        username: this.config.username,
        password: this.config.password,
      }),
    };
  }
}

function hashCode(input: string): number {
  let value = 0;
  for (let i = 0; i < input.length; i += 1) {
    value = (value * 31 + input.charCodeAt(i)) | 0;
  }
  return value;
}

function extractJiraDescription(value: unknown): string {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  const root = asRecord(value);
  const content = asArray(root?.content);
  if (!content) {
    return '';
  }

  const lines: string[] = [];
  for (const block of content) {
    const blockRecord = asRecord(block);
    const blockContent = asArray(blockRecord?.content);
    if (!blockContent) {
      continue;
    }

    const text = blockContent
      .map((node) => asString(asRecord(node)?.text))
      .filter((nodeText): nodeText is string => Boolean(nodeText))
      .join('');

    if (text) {
      lines.push(text);
    }
  }

  return lines.join('\n');
}

function extractTaggedValue(text: string, key: string): string | undefined {
  const match = new RegExp(`(?:^|\\n)\\s*${key}\\s*:\\s*(.+)`, 'i').exec(text);
  return match?.[1]?.trim();
}

function splitRepo(repo: string): [string, string] {
  const segments = repo.split('/');
  if (segments.length !== 2 || !segments[0] || !segments[1]) {
    throw new Error(`Repository must be in owner/name format. Received: ${repo}`);
  }
  return [encodeURIComponent(segments[0]), encodeURIComponent(segments[1])];
}

function extractExecutionId(payload: Record<string, unknown>): string {
  const keys = ['pipelineExecutionId', 'executionId', 'runId', 'id'];
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return `exec-${Date.now()}`;
}

interface AuthorizationConfig {
  bearerToken?: string;
  apiToken?: string;
  email?: string;
  username?: string;
  password?: string;
}

function createAuthorizationHeader(config: AuthorizationConfig): string {
  if (config.bearerToken) {
    return `Bearer ${config.bearerToken}`;
  }

  if (config.email && config.apiToken) {
    return `Basic ${toBase64(`${config.email}:${config.apiToken}`)}`;
  }

  if (config.username && config.password) {
    return `Basic ${toBase64(`${config.username}:${config.password}`)}`;
  }

  throw new Error('Missing authentication credentials for integration');
}

function toBase64(value: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value).toString('base64');
  }

  throw new Error('Base64 encoding is not available in this runtime');
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const payload = parseJson(text);

  if (!response.ok) {
    const details = payload ? JSON.stringify(payload) : text;
    throw new Error(`HTTP ${response.status} calling ${url}: ${details}`);
  }

  return (payload ?? ({} as T)) as T;
}

function parseJson(text: string): Record<string, unknown> | undefined {
  if (!text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
