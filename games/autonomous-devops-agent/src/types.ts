export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'needs_review';

export type AgentEventType =
  | 'run.started'
  | 'run.completed'
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'review.requested';

export interface AgentEvent {
  type: AgentEventType;
  runId: string;
  taskId?: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export interface WorkItem {
  id: string;
  kind: 'jira' | 'pull_request';
  title: string;
  body: string;
  repo: string;
  branch: string;
  serviceNowRecordId?: string;
  metadata?: Record<string, string>;
}

export interface SecurityScanResult {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface DeploymentResult {
  environment: 'dev' | 'prod';
  releaseId: string;
  deployedAt: string;
}

export interface AgentContext {
  runId: string;
  workItem: WorkItem;
  status: RunStatus;
  plan: string[];
  generatedCode?: string;
  testReport?: string;
  pullRequestId?: string;
  artifact?: string;
  scanResult?: SecurityScanResult;
  deployments: DeploymentResult[];
  reviewNotes: string[];
}

export interface LlmProvider {
  readonly name: string;
  generateFeatureImplementation(input: WorkItem): Promise<string>;
}

export interface JiraApi {
  fetchWorkItem(issueId: string): Promise<WorkItem>;
  comment(issueId: string, message: string): Promise<void>;
}

export interface RepoApi {
  fetchPullRequestWorkItem(repo: string, prNumber: string): Promise<WorkItem>;
  openPullRequest(repo: string, branch: string, title: string, body: string): Promise<string>;
  postPullRequestComment(repo: string, prNumber: string, message: string): Promise<void>;
}

export interface HarnessApi {
  publishArtifact(repo: string, buildOutput: string): Promise<string>;
  deploy(environment: 'dev' | 'prod', artifact: string): Promise<DeploymentResult>;
  scanImage(artifact: string): Promise<SecurityScanResult>;
}

export interface ServiceNowApi {
  appendWorkNote(recordId: string, message: string): Promise<void>;
}

export interface ApiKeyConfig {
  provider: 'openai' | 'anthropic' | 'oss';
  apiKey?: string;
  model?: string;
}
